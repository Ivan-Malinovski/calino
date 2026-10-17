import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type { CollisionDetection, UniqueIdentifier } from '@dnd-kit/core'
import { useCalendarStore, getTasksForDay, isCalendarReadOnly } from '@/store/calendarStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { safeCalDAVUpdate } from '@/lib/caldavHelpers'
import { hasDueTime } from '@/lib/events'
import { hapticIfEnabled } from '@/lib/haptics'
import { compareTaskSortOrder } from '@/lib/taskSortOrder'
import { planReorder, stepIndex, type ReorderItem, type SortOrderWrite } from '@/lib/taskReorder'
import type { CalendarEvent } from '@/types'

/**
 * The stored task a row's order lives on. A repeating task is ordered as a
 * series, so an occurrence -- generated, or TodoView's collapsed row -- writes
 * to its master, never to an override.
 */
export function sortOrderOwnerId(task: CalendarEvent): string {
  if (task.occurrenceMasterId) return task.occurrenceMasterId
  if (task.recurrenceId && task.recurrenceMasterId) return task.recurrenceMasterId
  return task.id
}

/** Can this row be put in a manual position at all? Timed and done tasks sort by other rules. */
export function isReorderable(task: CalendarEvent): boolean {
  return (
    task.type === 'task' && !task.completed && task.taskStatus !== 'CANCELLED' && !hasDueTime(task)
  )
}

/** The reorder group as `planReorder` wants it: owner ids and current values. */
export function toReorderItems(group: readonly CalendarEvent[]): ReorderItem[] {
  return group.map((task) => ({ id: sortOrderOwnerId(task), sortOrder: task.sortOrder }))
}

/**
 * The tasks a menu's Move up / Move down steps through: open, untimed tasks on
 * the same day with the same parent, on visible calendars, in the order the
 * day views show them. Undated tasks form one group of their own.
 */
export function dayReorderGroup(
  events: CalendarEvent[],
  task: CalendarEvent,
  visibleCalendarIds: ReadonlySet<string>
): CalendarEvent[] {
  if (!isReorderable(task)) return []
  const parent = task.parentTaskId ?? null
  const candidates = task.dueDate
    ? getTasksForDay(events, task.dueDate.split('T')[0])
    : events.filter((event) => event.type === 'task' && !event.dueDate && !event.recurrenceId)
  const seen = new Set<string>()
  return candidates
    .filter(
      (candidate) =>
        isReorderable(candidate) &&
        (candidate.parentTaskId ?? null) === parent &&
        visibleCalendarIds.has(candidate.calendarId)
    )
    .filter((candidate) => {
      const owner = sortOrderOwnerId(candidate)
      if (seen.has(owner)) return false
      seen.add(owner)
      return true
    })
    .sort(compareTaskSortOrder)
}

function visibleCalendarIds(): Set<string> {
  return new Set(
    useCalendarStore
      .getState()
      .calendars.filter((calendar) => calendar.isVisible)
      .map((calendar) => calendar.id)
  )
}

/** Where a menu step would send the task, or null when it cannot move that way. */
export function planStep(task: CalendarEvent, direction: -1 | 1): SortOrderWrite[] | null {
  const items = toReorderItems(
    dayReorderGroup(useCalendarStore.getState().events, task, visibleCalendarIds())
  )
  const owner = sortOrderOwnerId(task)
  const index = stepIndex(items, owner, direction)
  return index === null ? null : planReorder(items, owner, index)
}

function isRecurringRow(task: CalendarEvent): boolean {
  return Boolean(
    task.rruleString || task.recurrence || task.recurrenceId || task.occurrenceMasterId
  )
}

function dayOf(task: CalendarEvent): string | null {
  return task.dueDate?.split('T')[0] ?? null
}

/**
 * What dropping `dragged` on the `zone` edge of `targetId` would write, or
 * null when that is not a reorder: different days, a timed or done task, a
 * read-only calendar, a move that would nest a task inside itself, or a
 * repeating task changing parent. `rows` are the tasks as the view lists them,
 * so the result matches what the person sees; `allTasks` is the whole task
 * graph, for the cycle check.
 */
export function planDropReorder(
  rows: readonly CalendarEvent[],
  dragged: CalendarEvent,
  targetId: string,
  zone: 'before' | 'after',
  allTasks: readonly CalendarEvent[]
): ReorderCommit | null {
  if (dragged.id === targetId) return null
  if (!isReorderable(dragged) || isCalendarReadOnly(dragged.calendarId)) return null
  let anchor = rows.find((task) => task.id === targetId)
  if (!anchor) return null
  let position = zone
  // Below an expanded parent the next row is its first subtask, so the gap
  // there belongs to the subtasks: the task becomes the first of them.
  const below = rows.slice(rows.indexOf(anchor) + 1).find((task) => task.id !== dragged.id)
  if (position === 'after' && below?.parentTaskId === anchor.id) {
    anchor = below
    position = 'before'
  }
  if (!isReorderable(anchor) || dayOf(anchor) !== dayOf(dragged)) return null

  const parent = anchor.parentTaskId
  const reparenting = (dragged.parentTaskId ?? undefined) !== parent
  if (reparenting) {
    if (isRecurringRow(dragged) || parent === dragged.id) return null
    if (parent) {
      const children = new Map<string, string[]>()
      for (const task of allTasks) {
        if (!task.parentTaskId) continue
        children.set(task.parentTaskId, [...(children.get(task.parentTaskId) ?? []), task.id])
      }
      const pending = [dragged.id]
      const descendants = new Set<string>()
      while (pending.length > 0) {
        for (const child of children.get(pending.pop()!) ?? []) {
          if (descendants.has(child)) continue
          descendants.add(child)
          pending.push(child)
        }
      }
      if (descendants.has(parent)) return null
    }
  }

  const group = rows.filter(
    (task) =>
      task.id !== dragged.id &&
      isReorderable(task) &&
      dayOf(task) === dayOf(dragged) &&
      task.parentTaskId === parent
  )
  const at = group.indexOf(anchor)
  if (at < 0) return null
  // The moved task goes in too, so its current value counts as "unchanged".
  const writes = planReorder(
    toReorderItems([...group.slice(0, at), dragged, ...group.slice(at)]),
    sortOrderOwnerId(dragged),
    position === 'before' ? at : at + 1
  )
  const reparent = reparenting ? { id: dragged.id, parentTaskId: parent } : undefined
  if (writes.length === 0 && !reparent) return null
  return { writes, reparent }
}

/** Share of a row's height, at its top and bottom, that reads as "between rows". */
export const REORDER_EDGE = 0.25

/**
 * Which edge of `rect` the pointer at `pointerY` is over, or null for the
 * middle (a drop onto the row). A pointer just outside the row, in the gap to
 * its neighbour, counts as that edge.
 */
export function reorderZone(
  pointerY: number | null,
  rect: { top: number; height: number }
): 'before' | 'after' | null {
  if (pointerY === null) return null
  if (pointerY < rect.top + rect.height * REORDER_EDGE) return 'before'
  if (pointerY > rect.top + rect.height * (1 - REORDER_EDGE)) return 'after'
  return null
}

/**
 * The pointer's real viewport position while `active`. dnd-kit's drag delta
 * folds in any scrolling since the drag began, so "start + delta" drifts away
 * from the cursor once a list scrolls; the edge zones need where it really is.
 */
export function useDragPointer(active: boolean): MutableRefObject<{ x: number; y: number } | null> {
  const pointer = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (!active) {
      pointer.current = null
      return
    }
    const onMove = (event: PointerEvent | MouseEvent | TouchEvent): void => {
      const point = 'touches' in event ? event.touches[0] : event
      if (point) pointer.current = { x: point.clientX, y: point.clientY }
    }
    const options = { capture: true, passive: true }
    window.addEventListener('pointermove', onMove, options)
    window.addEventListener('mousemove', onMove, options)
    window.addEventListener('touchmove', onMove, options)
    return () => {
      window.removeEventListener('pointermove', onMove, options)
      window.removeEventListener('mousemove', onMove, options)
      window.removeEventListener('touchmove', onMove, options)
    }
  }, [active])
  return pointer
}

/** Where a row is on screen right now, falling back to dnd-kit's measurement. */
export function liveRect(
  selector: string,
  fallback: { top: number; height: number }
): { top: number; height: number } {
  const element = document.querySelector(selector)
  return element ? element.getBoundingClientRect() : fallback
}

/** How far outside a row (px) the pointer still counts as on its edge: a row gap and a little more. */
const ROW_GAP_SNAP = 8

/**
 * Collision detection for task rows that reads where each row is *now*.
 *
 * dnd-kit measures droppables once when a drag starts. A list that shifts
 * after that (the agenda opens its between-day zones on drag start) leaves
 * those rects stale, so its idea of "the row under the pointer" is off by the
 * shift, which is most visible right at the edges where reordering happens.
 * Rows are matched against their live rects and the real pointer instead; a
 * pointer in the gap between two rows takes the nearer one. The dragged row
 * itself is skipped, since it travels with the pointer. Anything that is not a
 * row falls through to `fallback`.
 */
export function liveRowCollision(
  rowId: (id: UniqueIdentifier) => string | null,
  pointer: MutableRefObject<{ x: number; y: number } | null>,
  fallback: CollisionDetection
): CollisionDetection {
  return (args) => {
    const at = pointer.current ?? args.pointerCoordinates
    if (at) {
      const activeId = String(args.active.id)
      let best: { container: (typeof args.droppableContainers)[number]; distance: number } | null =
        null
      for (const container of args.droppableContainers) {
        const id = rowId(container.id)
        if (id === null || id === activeId || container.disabled) continue
        const node = container.node.current
        if (!node) continue
        const rect = node.getBoundingClientRect()
        if (at.x < rect.left || at.x > rect.right) continue
        const distance =
          at.y < rect.top ? rect.top - at.y : at.y > rect.bottom ? at.y - rect.bottom : 0
        if (distance <= ROW_GAP_SNAP && (!best || distance < best.distance)) {
          best = { container, distance }
        }
      }
      if (best) {
        return [
          { id: best.container.id, data: { droppableContainer: best.container, value: best.distance } },
        ]
      }
    }
    return fallback(args)
  }
}

export interface ReorderCommit {
  writes: SortOrderWrite[]
  /** A drop between rows can also change the moved task's parent. */
  reparent?: { id: string; parentTaskId: string | undefined }
}

/** Writes a reorder: the store first, then CalDAV, one conditional update per changed task. */
export function useTaskReorder(): {
  commit: (change: ReorderCommit) => Promise<boolean>
  moveStep: (task: CalendarEvent, direction: -1 | 1) => Promise<boolean>
} {
  const updateEvent = useCalendarStore((s) => s.updateEvent)
  const { updateEvent: updateCalDAVEvent } = useCalDAV()

  const commit = useCallback(
    async ({ writes, reparent }: ReorderCommit): Promise<boolean> => {
      const events = useCalendarStore.getState().events
      const updatesById = new Map<string, Partial<CalendarEvent>>()
      for (const write of writes) updatesById.set(write.id, { sortOrder: write.sortOrder })
      if (reparent) {
        updatesById.set(reparent.id, {
          ...updatesById.get(reparent.id),
          parentTaskId: reparent.parentTaskId,
        })
      }
      const targets = [...updatesById].flatMap(([id, updates]) => {
        const event = events.find((candidate) => candidate.id === id)
        return event ? [{ event, updates }] : []
      })
      if (targets.length === 0) return false
      // All or nothing: half a renumber would scramble the group.
      if (targets.some(({ event }) => isCalendarReadOnly(event.calendarId))) return false

      for (const { event, updates } of targets) {
        updateEvent(event.id, updates)
        if (updates.sortOrder === undefined) continue
        // Overrides already in the store carry the master's value from when
        // they were parsed. Move them along locally; nothing is written for
        // them, because their VTODO never had a value of its own.
        for (const override of events) {
          if (
            override.recurrenceId &&
            override.recurrenceMasterId === event.id &&
            override.sortOrder === event.sortOrder
          ) {
            updateEvent(override.id, { sortOrder: updates.sortOrder })
          }
        }
      }
      hapticIfEnabled('light')
      const results = await Promise.all(
        targets.map(({ event, updates }) =>
          safeCalDAVUpdate(updateCalDAVEvent, event.calendarId, event, updates)
        )
      )
      return results.every(Boolean)
    },
    [updateEvent, updateCalDAVEvent]
  )

  const moveStep = useCallback(
    async (task: CalendarEvent, direction: -1 | 1): Promise<boolean> => {
      const writes = planStep(task, direction)
      if (!writes || writes.length === 0) return false
      return commit({ writes })
    },
    [commit]
  )

  return { commit, moveStep }
}
