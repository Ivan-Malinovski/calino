import type { JSX } from 'react'
import { useMemo, useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  pointerWithin,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { format, parseISO, startOfDay } from 'date-fns'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { DUR_FAST, EASE_POP } from '@/lib/motion'
import { useCalendarStore, isCalendarReadOnly } from '@/store/calendarStore'
import { nextOpenOccurrence, materializeOccurrence } from '@/lib/occurrenceExpansion'
import { describeRecurrence } from '@/lib/recurrence'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { useContextMenuStore } from '@/store/contextMenuStore'
import { hapticIfEnabled } from '@/lib/haptics'
import { useTaskContextMenuItems } from '../hooks/useTaskContextMenuItems'
import { TaskContextMenu } from './TaskContextMenu'
import type { CalendarEvent } from '@/types'
import styles from './TodoView.module.css'

type FilterType = 'all' | 'active' | 'completed'

interface TaskWithColor extends CalendarEvent {
  calendarColor: string
  /**
   * R2.7 — Set only on the single collapsed row that stands in for a recurring
   * series. It is the DTSTART of the occurrence the row currently shows, and
   * therefore the RECURRENCE-ID to write when the row is ticked. Its presence
   * is what routes completion through the override path instead of mutating
   * the master.
   */
  occurrenceStart?: string
  /**
   * R2.7 — The synthetic `${masterId}-${occurrenceKey}` id for the occurrence
   * this row shows. The row itself keeps the MASTER's id, because the subtask
   * tree and drag/re-parent logic key off task ids — but opening the modal
   * must use this one, or "this occurrence" edits and deletes resolve to the
   * series' anchor date instead of the date the user is looking at.
   */
  occurrenceEventId?: string
  /**
   * R2.7 — Human-readable summary of the series, shown on the repeat glyph.
   * Built in the `tasks` memo because that is the only place with both the
   * master's rule and its overrides in hand.
   */
  recurrenceLabel?: string
}

interface TaskGroup {
  key: string
  label: string
  isOverdue?: boolean
  tasks: TaskWithColor[]
}

const PRIORITY_LABELS: Record<number, string> = {
  1: 'High',
  2: 'Medium',
  3: 'Low',
}

// Sentinel used internally by handleTaskDragEnd for "not dropped onto a
// task row" — either released over blank space (no droppable underneath)
// or, in principle, a dedicated root zone if one is ever reintroduced.
// Dropping a task under this condition clears parentTaskId, turning it
// back into a top-level (root) task.
const ROOT_DROPPABLE_ID = '__todoRoot__'

function getPriorityClass(priority?: number): string {
  if (priority === 1) return styles.priorityHigh
  if (priority === 2) return styles.priorityMed
  if (priority === 3) return styles.priorityLow
  return ''
}

function getDueLabel(task: TaskWithColor): { text: string; className: string } {
  if (!task.dueDate) return { text: '—', className: '' }

  const today = startOfDay(new Date())
  const dueDate = startOfDay(parseISO(task.dueDate))
  const diffMs = dueDate.getTime() - today.getTime()
  const diffDays = Math.round(diffMs / 86400000)

  if (diffDays < 0) {
    return { text: format(parseISO(task.dueDate), 'MMM d'), className: styles.dueOverdue }
  }
  if (diffDays === 0) return { text: 'Today', className: styles.dueToday }
  if (diffDays === 1) return { text: 'Tomorrow', className: '' }
  if (diffDays <= 6) {
    return { text: format(parseISO(task.dueDate), 'EEE'), className: '' }
  }
  return { text: format(parseISO(task.dueDate), 'MMM d'), className: '' }
}

/**
 * R2.7 — Render an occurrence's DTSTART for the repeat tooltip. All-day
 * occurrences are floating dates (RFC 5545 §3.3.4) and must not show a time;
 * timed ones do, since that is what distinguishes them.
 */
function formatOccurrenceDate(iso: string, isAllDay: boolean | undefined): string {
  try {
    return format(parseISO(iso), isAllDay ? 'EEE, d MMM yyyy' : 'EEE, d MMM yyyy, HH:mm')
  } catch {
    return iso
  }
}

function getTaskGroup(task: TaskWithColor): string {
  if (!task.dueDate) return 'nodate'

  const today = startOfDay(new Date())
  const dueDate = startOfDay(parseISO(task.dueDate))
  const diffMs = dueDate.getTime() - today.getTime()
  const diffDays = Math.round(diffMs / 86400000)

  if (diffDays < 0) return 'overdue'
  if (diffDays === 0) return 'today'
  if (diffDays <= 6) return 'week'
  return 'later'
}

const GROUP_ORDER = ['overdue', 'today', 'week', 'later', 'nodate']

const GROUP_LABELS: Record<string, string> = {
  overdue: 'Overdue',
  today: 'Today',
  week: 'This week',
  later: 'Later',
  nodate: 'No due date',
}

type VirtualItem =
  | { type: 'header'; key: string; label: string; count: number; isOverdue?: boolean }
  | { type: 'task'; key: string; task: TaskWithColor; depth: number }

export function TodoView(): JSX.Element {
  const events = useCalendarStore((state) => state.events)
  const calendars = useCalendarStore((state) => state.calendars)
  const openModal = useCalendarStore((state) => state.openModal)
  const updateEvent = useCalendarStore((state) => state.updateEvent)
  const { updateEvent: updateCalDAVEvent } = useCalDAV()
  const isMobile = useIsMobile()
  const prefersReducedMotion = useReducedMotion()

  const [filter, setFilter] = useState<FilterType>('active')
  const [projectFilter, setProjectFilter] = useState('')
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false)
  const [composing, setComposing] = useState(false)
  const [unstriking, setUnstriking] = useState<Set<string>>(new Set())
  const [recentlyCompleted, setRecentlyCompleted] = useState<Set<string>>(new Set())
  const [fadingOut, setFadingOut] = useState<Set<string>>(new Set())
  // Set of task ids that a reparent should be skipped for. The drag handlers
  // flip this on briefly (one tick) for the source task itself when it's
  // being dragged, so the keyboard/mouse focus ring on its row doesn't fight
  // the DragOverlay visual.
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  // Tracks whether the pointer is currently over blank space (no task row
  // underneath) during a drag. Drives the ambient "drop here to promote to
  // root" hint on the list container, since there's no dedicated drop zone.
  const [isOverBlankSpace, setIsOverBlankSpace] = useState(false)
  // R2.7 — Hover detail for the repeat glyph. Rendered into a portal at fixed
  // coordinates rather than positioned next to the badge: task rows live in a
  // virtualizer with its own scroll clipping, which would crop an absolutely
  // positioned tooltip. Same approach the sidebar's task tooltip uses.
  const [recurrenceTip, setRecurrenceTip] = useState<{
    text: string
    x: number
    y: number
  } | null>(null)
  // The row the context menu is open for, with the coordinates it was summoned
  // at. One at a time — rows are virtualized, so the menu is rendered once at
  // this level rather than per row.
  const [taskMenu, setTaskMenu] = useState<{ task: TaskWithColor; x: number; y: number } | null>(
    null
  )
  const openMenu = useContextMenuStore((state) => state.openMenu)
  const closeMenu = useContextMenuStore((state) => state.closeMenu)
  const { toggleComplete } = useTaskContextMenuItems(null)
  const longPressRef = useRef<{
    timer: ReturnType<typeof setTimeout>
    x: number
    y: number
  } | null>(null)
  // A long-press that opened the menu is followed by a click on the row; without
  // this the task modal would open behind the menu.
  const suppressClickRef = useRef(false)
  const composerRef = useRef<HTMLInputElement>(null)
  const segmentedRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number }>({
    left: 0,
    width: 0,
  })
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const projectMenuRef = useRef<HTMLDivElement>(null)
  const [scrollReady, setScrollReady] = useState(false)

  // Pointer sensor with the same 8px activation distance as CalendarGrid /
  // DayView so a stray click never starts a drag accidentally. We rely on the
  // body's pointer events (not a Keyboard sensor) because all our callers
  // operate via mouse / touch.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  )

  // Prefer the pointer location over the rect intersection for our row
  // geometry — two task rows stacked vertically share a full width, and the
  // pointer is closer to the intended drop target than the rect centroid.
  const collisionDetection: CollisionDetection = useCallback((args) => pointerWithin(args), [])

  useEffect(() => {
    if (composing && composerRef.current) {
      composerRef.current.focus()
    }
  }, [composing])

  // Detect when scroll container is ready (has a height)
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return

    // Check immediately
    if (el.clientHeight > 0) {
      setScrollReady(true)
      return
    }

    // Poll briefly for layout
    const timer = setTimeout(() => {
      if (el.clientHeight > 0) {
        setScrollReady(true)
      }
    }, 50)

    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!isProjectMenuOpen) return
    const closeMenu = (event: MouseEvent): void => {
      if (!projectMenuRef.current?.contains(event.target as Node)) setIsProjectMenuOpen(false)
    }
    document.addEventListener('mousedown', closeMenu)
    return () => document.removeEventListener('mousedown', closeMenu)
  }, [isProjectMenuOpen])

  // CalendarHeader renders an empty #task-header-slot div (only while the
  // todo view is active) so the project filter can live on the same line as
  // the "Tasks" title, right-aligned, instead of TodoView's own sub-bar. It
  // doesn't exist yet on first render, so look it up after mount.
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setHeaderSlot(document.getElementById('task-header-slot'))
  }, [])

  const tasks: TaskWithColor[] = useMemo(() => {
    const calendarMap = new Map(calendars.map((c) => [c.id, c.color]))
    const visibleCalendarIds = new Set(calendars.filter((c) => c.isVisible).map((c) => c.id))
    const allTasks = events.filter(
      (e) =>
        e.type === 'task' &&
        visibleCalendarIds.has(e.calendarId) &&
        // R2.7 — A cancelled override only exists to suppress one occurrence of
        // a series; it is not a task the user still has to do.
        e.taskStatus !== 'CANCELLED'
    )

    // R2.7 — Group a recurring series' components by their shared UID so the
    // list can collapse them to one row. Overrides stay in the array in their
    // own right: a completed occurrence is a real, dated task and belongs under
    // the Completed filter, it just must not also appear as an open row.
    const overridesByMaster = new Map<string, Map<string, CalendarEvent>>()
    for (const task of allTasks) {
      if (!task.recurrenceId) continue
      const key = task.recurrenceMasterId || task.uid || ''
      let group = overridesByMaster.get(key)
      if (!group) {
        group = new Map()
        overridesByMaster.set(key, group)
      }
      group.set(task.recurrenceId, task)
    }

    const withColor = (task: CalendarEvent): TaskWithColor => ({
      ...task,
      calendarColor: calendarMap.get(task.calendarId) || '#888',
    })

    // An override carries no RRULE of its own (RFC 5545 §3.8.5.3), so the
    // series it belongs to has to be read off its master.
    const mastersById = new Map<string, CalendarEvent>()
    for (const task of allTasks) {
      if (task.recurrenceId) continue
      mastersById.set(task.id, task)
      if (task.uid) mastersById.set(task.uid, task)
    }

    return allTasks.map((task) => {
      const isRecurringMaster = Boolean((task.rruleString || task.recurrence) && !task.recurrenceId)

      if (!isRecurringMaster) {
        if (!task.recurrenceId) return withColor(task)
        // A detached occurrence — describe the series it came out of.
        const master = mastersById.get(task.recurrenceMasterId || task.uid || '')
        return {
          ...withColor(task),
          recurrenceLabel: [
            master ? describeRecurrence(master) : 'Repeating task',
            `This occurrence: ${formatOccurrenceDate(task.recurrenceId, task.isAllDay)}`,
          ].join('\n'),
        }
      }

      const overrides =
        overridesByMaster.get(task.id) ??
        overridesByMaster.get(task.uid || '') ??
        new Map<string, CalendarEvent>()
      const completedCount = [...overrides.values()].filter((o) => o.completed).length
      const next = nextOpenOccurrence(task, overrides)
      if (!next) {
        // Series exhausted — every occurrence has been dealt with. Show the row
        // as completed rather than stranding an undated master in the list.
        return {
          ...withColor({ ...task, completed: true, taskStatus: 'COMPLETED' }),
          recurrenceLabel: [describeRecurrence(task), 'No occurrences left'].join('\n'),
        }
      }
      // Keep the master's own id so the subtask tree and drag/re-parent logic,
      // which key off task ids, keep resolving. `materializeOccurrence` owns the
      // dueDate derivation so this row buckets the same way the grid does.
      const occurrence = materializeOccurrence(task, next)
      return {
        ...withColor(occurrence),
        id: task.id,
        occurrenceEventId: occurrence.id,
        completed: false,
        taskStatus: 'NEEDS-ACTION',
        occurrenceStart: next.occStartStr,
        recurrenceLabel: [
          describeRecurrence(task),
          `Next: ${formatOccurrenceDate(next.occStartStr, task.isAllDay)}`,
          completedCount > 0
            ? `${completedCount} completed so far`
            : 'None completed yet — tick to advance',
        ].join('\n'),
      }
    })
  }, [events, calendars])

  const taskCalendars = useMemo(
    () =>
      calendars.filter(
        (calendar) =>
          calendar.isVisible &&
          (!calendar.supportedComponents || calendar.supportedComponents.includes('VTODO'))
      ),
    [calendars]
  )
  const filteredTasks = useMemo(
    () => (projectFilter ? tasks.filter((task) => task.calendarId === projectFilter) : tasks),
    [projectFilter, tasks]
  )
  const activeCount = useMemo(
    () => filteredTasks.filter((task) => !task.completed).length,
    [filteredTasks]
  )
  const completedCount = useMemo(
    () => filteredTasks.filter((task) => task.completed).length,
    [filteredTasks]
  )
  const selectedProject = taskCalendars.find((calendar) => calendar.id === projectFilter)

  // Sliding indicator for filter tabs
  useLayoutEffect(() => {
    const container = segmentedRef.current
    const activeTab = tabRefs.current.get(filter)
    if (container && activeTab) {
      const containerRect = container.getBoundingClientRect()
      const tabRect = activeTab.getBoundingClientRect()
      setIndicatorStyle({
        left: tabRect.left - containerRect.left,
        width: tabRect.width,
      })
    }
    // Mobile tab labels embed the live counts (e.g. "Active (3)"), so the
    // indicator must re-measure whenever those counts change tab width, not
    // just when the selected filter changes.
  }, [filter, activeCount, completedCount])

  const projectMenuContent = (
    <>
      <button
        type="button"
        className={styles.projectFilter}
        onClick={() => setIsProjectMenuOpen(!isProjectMenuOpen)}
        aria-expanded={isProjectMenuOpen}
        aria-haspopup="menu"
        aria-label="Filter tasks by project"
        data-component="task-project-filter"
      >
        {selectedProject && (
          <span
            className={styles.projectColor}
            style={{ backgroundColor: selectedProject.color }}
          />
        )}
        {selectedProject?.name ?? 'All projects'}
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none">
          <path
            d="M4 6l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {isProjectMenuOpen && (
        <div className={styles.projectMenuList} role="menu" data-component="task-project-menu">
          <button
            type="button"
            role="menuitem"
            className={
              projectFilter
                ? styles.projectMenuItem
                : `${styles.projectMenuItem} ${styles.projectMenuItemSelected}`
            }
            onClick={() => {
              setProjectFilter('')
              setIsProjectMenuOpen(false)
            }}
          >
            All projects
          </button>
          {taskCalendars.map((calendar) => (
            <button
              key={calendar.id}
              type="button"
              role="menuitem"
              className={
                projectFilter === calendar.id
                  ? `${styles.projectMenuItem} ${styles.projectMenuItemSelected}`
                  : styles.projectMenuItem
              }
              onClick={() => {
                setProjectFilter(calendar.id)
                setIsProjectMenuOpen(false)
              }}
            >
              <span className={styles.projectColor} style={{ backgroundColor: calendar.color }} />
              {calendar.name}
            </button>
          ))}
        </div>
      )}
    </>
  )

  // Only worth hinting "drop here to promote to root" when the dragged task
  // actually has a parent — dropping an already-root task on blank space is
  // a no-op, so showing the hint there would be misleading.
  const draggedTaskHasParent = useMemo(
    () => !!activeTaskId && !!tasks.find((task) => task.id === activeTaskId)?.parentTaskId,
    [activeTaskId, tasks]
  )
  const showRootDropHint = draggedTaskHasParent && isOverBlankSpace

  const groupedTasks = useMemo((): TaskGroup[] => {
    const active = filteredTasks.filter((t) => !t.completed || recentlyCompleted.has(t.id))
    const done = filteredTasks.filter((t) => t.completed && !recentlyCompleted.has(t.id))

    const result: TaskGroup[] = []

    if (filter !== 'completed') {
      // Sort active tasks: due date ascending (earliest first), no-date last
      const sorted = [...active].sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0
        if (!a.dueDate) return 1
        if (!b.dueDate) return -1
        return parseISO(a.dueDate).getTime() - parseISO(b.dueDate).getTime()
      })

      // Group a complete branch by its root task so children with a different
      // due date still remain under their parent.
      const grouped = new Map<string, TaskWithColor[]>()
      const taskIds = new Set(sorted.map((task) => task.id))
      const children = new Map<string, TaskWithColor[]>()
      for (const task of sorted) {
        if (!task.parentTaskId || !taskIds.has(task.parentTaskId)) continue
        const siblings = children.get(task.parentTaskId) ?? []
        siblings.push(task)
        children.set(task.parentTaskId, siblings)
      }
      const appendBranch = (task: TaskWithColor, branch: TaskWithColor[]): void => {
        branch.push(task)
        for (const child of children.get(task.id) ?? []) appendBranch(child, branch)
      }
      for (const task of sorted) {
        if (task.parentTaskId && taskIds.has(task.parentTaskId)) continue
        const group = getTaskGroup(task)
        if (!grouped.has(group)) grouped.set(group, [])
        appendBranch(task, grouped.get(group)!)
      }

      // Add groups in order
      for (const key of GROUP_ORDER) {
        const groupTasks = grouped.get(key)
        if (groupTasks && groupTasks.length > 0) {
          result.push({
            key,
            label: GROUP_LABELS[key],
            isOverdue: key === 'overdue',
            tasks: groupTasks,
          })
        }
      }
    }

    if (filter !== 'active' && done.length > 0) {
      // Sort completed: most recently done first
      const sortedDone = [...done].sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0
        if (!a.dueDate) return 1
        if (!b.dueDate) return -1
        return parseISO(b.dueDate).getTime() - parseISO(a.dueDate).getTime()
      })

      result.push({
        key: 'done',
        label: 'Done',
        tasks: sortedDone,
      })
    }

    return result
  }, [filteredTasks, filter, recentlyCompleted])

  const handleToggleComplete = useCallback(
    async (task: TaskWithColor): Promise<void> => {
      if (isCalendarReadOnly(task.calendarId)) return
      const newCompleted = !task.completed
      // If uncompleting, trigger unstrike animation
      if (task.completed && !newCompleted) {
        setUnstriking((prev) => new Set(prev).add(task.id))
        setTimeout(() => {
          setUnstriking((prev) => {
            const next = new Set(prev)
            next.delete(task.id)
            return next
          })
        }, 300)
      }
      // If completing in active view, keep visible briefly for strike animation
      if (!task.completed && newCompleted && filter === 'active') {
        setRecentlyCompleted((prev) => new Set(prev).add(task.id))
        // Start fade-out after strike animation completes
        setTimeout(() => {
          setFadingOut((prev) => new Set(prev).add(task.id))
        }, 320)
        // Remove from list after fade-out
        setTimeout(() => {
          setRecentlyCompleted((prev) => {
            const next = new Set(prev)
            next.delete(task.id)
            return next
          })
          setFadingOut((prev) => {
            const next = new Set(prev)
            next.delete(task.id)
            return next
          })
        }, 520)
      }
      // Everything above is this view's completion animation; the store and
      // CalDAV writes (including the recurring-occurrence override path) live in
      // useTaskContextMenuItems so the checkbox and the menu item can't drift.
      await toggleComplete(task)
    },
    [filter, toggleComplete]
  )

  const handleTaskContextMenu = useCallback(
    (e: React.MouseEvent, task: TaskWithColor): void => {
      // Suppress the native menu unconditionally — including the one Android's
      // WebView synthesizes from a long-press on its own — but only open ours for
      // a real right-click; touch long-presses come through the timer below.
      e.preventDefault()
      e.stopPropagation()
      if (e.button !== 2) return
      const menuId = `task-${task.id}`
      openMenu(menuId)
      setTaskMenu({ task, x: e.clientX, y: e.clientY })
    },
    [openMenu]
  )

  const cancelLongPress = useCallback((): void => {
    if (longPressRef.current) clearTimeout(longPressRef.current.timer)
    longPressRef.current = null
  }, [])

  /**
   * Touch long-press, hand-rolled rather than via useGestures: the row already
   * carries dnd-kit's pointer listeners, and a second library claiming
   * `onPointerDown` on the same element breaks drag-to-nest. dnd-kit's sensor
   * needs 8px of movement to activate, so a stationary press is ours alone.
   */
  const handleRowPointerDown = useCallback(
    (e: React.PointerEvent, task: TaskWithColor): void => {
      if (e.pointerType === 'mouse') return
      cancelLongPress()
      // Strictly per-gesture: only the long-press below arms it, and a press
      // that never reaches the body's onClick (started on the checkbox, or
      // dismissed via the backdrop) must not leave it armed for the next tap.
      suppressClickRef.current = false
      const { clientX: x, clientY: y } = e
      const timer = setTimeout(() => {
        longPressRef.current = null
        suppressClickRef.current = true
        hapticIfEnabled('medium')
        openMenu(`task-${task.id}`)
        setTaskMenu({ task, x, y })
      }, 400)
      longPressRef.current = { timer, x, y }
    },
    [cancelLongPress, openMenu]
  )

  const handleRowPointerMove = useCallback(
    (e: React.PointerEvent): void => {
      const pending = longPressRef.current
      if (!pending) return
      if (Math.abs(e.clientX - pending.x) > 10 || Math.abs(e.clientY - pending.y) > 10) {
        cancelLongPress()
      }
    },
    [cancelLongPress]
  )

  useEffect(() => cancelLongPress, [cancelLongPress])

  const closeTaskMenu = (): void => {
    closeMenu()
    setTaskMenu(null)
  }

  const handleTaskClick = useCallback(
    (task: TaskWithColor): void => {
      // R2.7 — Open a recurring row on the occurrence it is showing, not on the
      // master. The modal derives "which occurrence did the user act on" from the
      // id it was given; handed the master's, "this occurrence" edits and deletes
      // silently target the series' anchor date instead.
      openModal(undefined, undefined, task.occurrenceEventId ?? task.id, 'task')
    },
    [openModal]
  )

  const handleCreateTask = (): void => {
    setComposing(true)
    if (filter === 'completed') setFilter('active')
  }

  // Shared by the Enter keydown handler and the new checkmark submit button.
  // Only opens the task modal when there's typed text — same gating as before.
  const submitComposer = (): void => {
    const value = composerRef.current?.value.trim()
    if (!value) return
    openModal(
      format(new Date(), 'yyyy-MM-dd'),
      undefined,
      undefined,
      'task',
      value,
      undefined,
      projectFilter || undefined
    )
    if (composerRef.current) composerRef.current.value = ''
    setComposing(false)
  }

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      submitComposer()
    } else if (e.key === 'Escape') {
      setComposing(false)
    }
  }

  const handleComposerSubmitClick = (e: React.MouseEvent<HTMLButtonElement>): void => {
    // Keep focus on the input — clicking the checkmark must not steal focus
    // (otherwise the composer's `onBlur` handler would tear the row down
    // before the modal opens).
    e.preventDefault()
    submitComposer()
  }

  // ─── Drag-and-drop ──────────────────────────────────────────────────────
  // Drag a task onto another task to make it a child. Drop on the empty
  // "root" surface at the bottom of the list to clear parentTaskId (turns
  // a subtask back into a top-level task). Drops onto self or any descendant
  // are silently rejected to prevent cycles in the task tree.

  // Precomputed set of every descendant id for `rootId`. Walks the children
  // map once and returns true if `descendantId` appears anywhere below
  // `rootId` — used to forbid dropping a parent onto one of its own
  // grandchildren.
  const buildDescendantSet = useCallback(
    (rootId: string, childMap: Map<string, TaskWithColor[]>): Set<string> => {
      const result = new Set<string>()
      const stack = [rootId]
      while (stack.length > 0) {
        const id = stack.pop()!
        for (const child of childMap.get(id) ?? []) {
          if (result.has(child.id)) continue
          result.add(child.id)
          stack.push(child.id)
        }
      }
      return result
    },
    []
  )

  const handleTaskDragStart = (event: DragStartEvent): void => {
    setActiveTaskId(String(event.active.id))
    setIsOverBlankSpace(false)
  }

  const handleTaskDragOver = (event: DragOverEvent): void => {
    setIsOverBlankSpace(!event.over)
  }

  const handleTaskDragEnd = async (event: DragEndEvent): Promise<void> => {
    const { active, over } = event
    setActiveTaskId(null)
    setIsOverBlankSpace(false)

    const draggedId = String(active.id)
    // Any drop that isn't over another task row — blank space, with no
    // droppable underneath the release point — promotes the task to top
    // level, so there's no dedicated root drop zone to aim for.
    const targetId = over ? String(over.id) : ROOT_DROPPABLE_ID

    if (targetId !== ROOT_DROPPABLE_ID) {
      const draggedTask = tasks.find((task) => task.id === draggedId)
      if (!draggedTask || draggedTask.type !== 'task') return

      // No-op drops (self / no-change) — cheap to short-circuit before any
      // history / CalDAV traffic.
      if (draggedId === targetId) return
      if (draggedTask.parentTaskId === targetId) return

      // Build the children map for the *currently filtered* subtree. This
      // matches the listing, but we have to walk the broader event list to
      // find children whose immediate parent was filtered out (the tree can
      // span across filters via the project dropdown). For correctness we
      // use the global tasks array — cycle detection must see the full
      // graph, not just what's on screen.
      const globalChildMap = new Map<string, TaskWithColor[]>()
      for (const task of tasks) {
        if (!task.parentTaskId) continue
        const siblings = globalChildMap.get(task.parentTaskId) ?? []
        siblings.push(task)
        globalChildMap.set(task.parentTaskId, siblings)
      }
      const descendants = buildDescendantSet(draggedId, globalChildMap)
      if (descendants.has(targetId)) return

      updateEvent(draggedId, { parentTaskId: targetId })
      const updated = { ...draggedTask, parentTaskId: targetId }
      try {
        await updateCalDAVEvent(updated.calendarId, updated)
      } catch {
        // Surface through toast if CalDAV surface ever gets one; for now,
        // the store update already applied locally and will reconcile on
        // the next sync.
      }
      return
    }

    // Dropped onto empty space — promote to root by clearing parentTaskId.
    const draggedTask = tasks.find((task) => task.id === draggedId)
    if (!draggedTask || !draggedTask.parentTaskId) return
    updateEvent(draggedId, { parentTaskId: undefined })
    const updated = { ...draggedTask, parentTaskId: undefined }
    try {
      await updateCalDAVEvent(updated.calendarId, updated)
    } catch {
      // See note above.
    }
  }

  const flatItems: VirtualItem[] = useMemo(() => {
    const items: VirtualItem[] = []
    for (const group of groupedTasks) {
      items.push({
        type: 'header',
        key: `header-${group.key}`,
        label: group.label,
        count: group.tasks.length,
        isOverdue: group.isOverdue,
      })
      const taskIds = new Set(group.tasks.map((task) => task.id))
      const children = new Map<string, TaskWithColor[]>()
      for (const task of group.tasks) {
        if (!task.parentTaskId || !taskIds.has(task.parentTaskId)) continue
        const siblings = children.get(task.parentTaskId) ?? []
        siblings.push(task)
        children.set(task.parentTaskId, siblings)
      }
      const appendTask = (task: TaskWithColor, depth: number): void => {
        items.push({ type: 'task', key: `task-${task.id}`, task, depth })
        for (const child of children.get(task.id) ?? []) appendTask(child, depth + 1)
      }
      for (const task of group.tasks) {
        if (!task.parentTaskId || !taskIds.has(task.parentTaskId)) appendTask(task, 0)
      }
    }
    return items
  }, [groupedTasks])

  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: (index) => (flatItems[index].type === 'header' ? 40 : 56),
    overscan: 5,
  })

  const renderHeader = useCallback(
    (item: Extract<VirtualItem, { type: 'header' }>, transform?: string, index?: number) => (
      <div
        key={item.key}
        // data-index and the measure ref are what let the virtualizer replace
        // its size estimate with the row's real height. Only meaningful on the
        // virtualized path; the non-virtualized fallback lays out normally.
        data-index={index ?? 0}
        ref={index === undefined ? undefined : virtualizer.measureElement}
        style={{
          position: transform ? 'absolute' : undefined,
          top: 0,
          left: 0,
          width: '100%',
          transform,
        }}
      >
        <div className={`${styles.taskGroup} ${item.isOverdue ? styles.overdueGroup : ''}`}>
          <div className={styles.groupHeader}>
            <span className={styles.groupTitle}>{item.label}</span>
            <span className={styles.groupCount}>{item.count}</span>
            <span className={styles.groupRule} />
          </div>
        </div>
      </div>
    ),
    [virtualizer]
  )

  const renderTask = useCallback(
    (item: Extract<VirtualItem, { type: 'task' }>, transform?: string, index?: number) => {
      const task = item.task
      const dueInfo = getDueLabel(task)
      const isActive = activeTaskId === task.id
      return (
        <div
          key={item.key}
          // See renderHeader: a task row is not a fixed height — a description
          // adds a second line, and estimateSize alone would let taller rows
          // overlap the one below.
          data-index={index ?? 0}
          ref={index === undefined ? undefined : virtualizer.measureElement}
          style={{
            position: transform ? 'absolute' : undefined,
            top: 0,
            left: 0,
            width: '100%',
            transform,
          }}
        >
          <DraggableTaskRow taskId={task.id} isActive={isActive}>
            {({ dragAttributes, dragListeners, dragStyle, setDropRef, isOver }) => {
              const rowClass = [
                styles.taskRow,
                item.depth > 0 ? styles.taskSubtask : '',
                task.completed ? styles.taskDone : '',
                unstriking.has(task.id) ? styles.unstriking : '',
                fadingOut.has(task.id) ? styles.fadingOut : '',
                isOver ? styles.taskRowDropTarget : '',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <div
                  ref={setDropRef}
                  className={rowClass}
                  style={
                    {
                      ...dragStyle,
                      '--event-color': task.calendarColor,
                      marginLeft: item.depth * 28,
                    } as React.CSSProperties
                  }
                  data-component="task-row"
                  data-task-depth={item.depth}
                  data-task-id={task.id}
                  onContextMenu={(e) => handleTaskContextMenu(e, task)}
                  {...dragAttributes}
                  {...(dragListeners ?? {})}
                  onPointerDown={(e) => {
                    // Compose rather than override: dnd-kit's own
                    // onPointerDown, spread just above, starts the drag.
                    ;(
                      dragListeners?.onPointerDown as ((ev: React.PointerEvent) => void) | undefined
                    )?.(e)
                    handleRowPointerDown(e, task)
                  }}
                  onPointerMove={handleRowPointerMove}
                  onPointerUp={cancelLongPress}
                  onPointerCancel={cancelLongPress}
                >
                  <button
                    className={styles.taskCheck}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleToggleComplete(task)
                    }}
                    // Stop the drag listeners on the parent from receiving
                    // this click — without `stopPropagation` the click would
                    // double-fire as a drag start.
                    onPointerDown={(e) => e.stopPropagation()}
                    aria-label={task.completed ? 'Mark as incomplete' : 'Mark as complete'}
                  >
                    <svg
                      viewBox="0 0 14 14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 7.5l2.5 2.5L11 4" />
                    </svg>
                  </button>
                  <div
                    className={styles.taskBody}
                    onClick={() => {
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false
                        return
                      }
                      handleTaskClick(task)
                    }}
                  >
                    <div className={styles.taskTitle}>{task.title}</div>
                    {task.description && <div className={styles.taskNote}>{task.description}</div>}
                  </div>
                  <div className={styles.taskMeta}>
                    {/* R2.7 — A recurring row stands in for a whole series, and
                        ticking it advances to the next date rather than
                        removing it. Without a marker that reads as the row
                        refusing to go away. */}
                    {(task.occurrenceStart || task.recurrenceId) && (
                      <span
                        className={styles.recurringBadge}
                        aria-label={task.recurrenceLabel || 'Repeating task'}
                        data-component="task-recurring-badge"
                        data-recurrence={task.recurrenceLabel}
                        onMouseEnter={(e) =>
                          task.recurrenceLabel &&
                          setRecurrenceTip({
                            text: task.recurrenceLabel,
                            x: e.clientX,
                            y: e.clientY,
                          })
                        }
                        onMouseLeave={() => setRecurrenceTip(null)}
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 14 14"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M2 6a5 5 0 0 1 8.5-3.2L12 4" />
                          <path d="M12 8a5 5 0 0 1-8.5 3.2L2 10" />
                          <path d="M12 1.5V4H9.5" />
                          <path d="M2 12.5V10h2.5" />
                        </svg>
                      </span>
                    )}
                    {task.priority && task.priority <= 3 && (
                      <span className={`${styles.priority} ${getPriorityClass(task.priority)}`}>
                        {PRIORITY_LABELS[task.priority]}
                      </span>
                    )}
                    <span className={`${styles.dueLabel} ${dueInfo.className}`}>
                      {dueInfo.text}
                    </span>
                  </div>
                </div>
              )
            }}
          </DraggableTaskRow>
        </div>
      )
    },
    [
      activeTaskId,
      unstriking,
      fadingOut,
      handleToggleComplete,
      handleTaskClick,
      handleTaskContextMenu,
      handleRowPointerDown,
      handleRowPointerMove,
      cancelLongPress,
      virtualizer,
    ]
  )

  return (
    <div className={styles.container}>
      <div className={styles.tpInner}>
        {/* Top Bar */}
        <div className={styles.tpBar}>
          <div className={styles.tpMeta}>
            {/* Desktop keeps this to the left of the active/done counts;
                mobile portals it into the header instead (below), where
                there's room on the same line as the "Tasks" title. */}
            {!isMobile && taskCalendars.length > 1 && (
              <div className={styles.projectMenu} ref={projectMenuRef}>
                {projectMenuContent}
              </div>
            )}
            {!isMobile && (
              <div className={styles.tpCount}>
                <span>
                  <b>{activeCount}</b> active
                </span>
                <span className={styles.dim} aria-hidden="true">
                  ·
                </span>
                <span>{completedCount} done</span>
              </div>
            )}
          </div>
          <div className={styles.tpControls}>
            <div
              className={styles.segmentedControl}
              ref={segmentedRef}
              data-component="todo-segmented"
            >
              <div
                className={styles.tabIndicator}
                style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
                data-component="view-switcher-indicator"
              />
              <button
                ref={(el) => {
                  if (el) tabRefs.current.set('all', el)
                }}
                className={`${styles.tab} ${filter === 'all' ? styles.tabActive : ''}`}
                onClick={() => setFilter('all')}
              >
                All
              </button>
              <button
                ref={(el) => {
                  if (el) tabRefs.current.set('active', el)
                }}
                className={`${styles.tab} ${filter === 'active' ? styles.tabActive : ''}`}
                onClick={() => setFilter('active')}
              >
                Active
                {isMobile && activeCount > 0 && (
                  <span className={styles.tabCount}>{activeCount}</span>
                )}
              </button>
              <button
                ref={(el) => {
                  if (el) tabRefs.current.set('completed', el)
                }}
                className={`${styles.tab} ${filter === 'completed' ? styles.tabActive : ''}`}
                onClick={() => setFilter('completed')}
              >
                Done
                {isMobile && completedCount > 0 && (
                  <span className={styles.tabCount}>{completedCount}</span>
                )}
              </button>
            </div>
            <button
              className={styles.addTask}
              onClick={handleCreateTask}
              data-component="add-task-button"
            >
              <svg
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M7 2v10M2 7h10" />
              </svg>
              {isMobile ? 'Add' : 'Add task'}
            </button>
          </div>
        </div>

        {/* Project filter (mobile only) — portaled into CalendarHeader's
            task-header-slot so it sits on the same line as the "Tasks"
            title, right-aligned, animated in the same way as the header's
            own today-button-icon. */}
        {isMobile &&
          headerSlot &&
          taskCalendars.length > 1 &&
          createPortal(
            <motion.div
              className={styles.projectMenu}
              ref={projectMenuRef}
              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: prefersReducedMotion ? 0 : DUR_FAST, ease: EASE_POP }}
            >
              {projectMenuContent}
            </motion.div>,
            headerSlot
          )}

        {/* Task List */}
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleTaskDragStart}
          onDragOver={handleTaskDragOver}
          onDragEnd={handleTaskDragEnd}
        >
          <div
            className={`${styles.taskList} ${showRootDropHint ? styles.taskListRootHint : ''}`}
            ref={scrollContainerRef}
            data-component="todo-task-list"
            data-root-drop-hint={showRootDropHint ? '' : undefined}
          >
            {/* Inline Composer */}
            {composing && (
              <div className={styles.inlineComposer}>
                <button
                  type="button"
                  className={styles.composerCheck}
                  onClick={handleComposerSubmitClick}
                  onMouseDown={(e) => e.preventDefault()}
                  aria-label="Add task"
                  data-component="composer-submit"
                />
                <input
                  ref={composerRef}
                  type="text"
                  className={styles.composerInput}
                  placeholder="What needs doing?"
                  onKeyDown={handleComposerKeyDown}
                  onBlur={() => setComposing(false)}
                />
              </div>
            )}

            {/* Empty State */}
            {groupedTasks.length === 0 && (
              <div className={styles.emptyState}>
                <span className={styles.emptyTitle}>All clear</span>
                <p className={styles.emptyMessage}>Nothing here right now.</p>
                <button
                  className={styles.emptyCreateBtn}
                  onClick={() => {
                    setComposing(true)
                    // Focus the composer input on next tick
                    setTimeout(() => composerRef.current?.focus(), 0)
                  }}
                  data-component="todo-empty-create"
                >
                  + Create task
                </button>
              </div>
            )}

            {/* Virtualized Task List */}
            {flatItems.length > 0 && scrollReady && (
              <div
                style={{
                  height: virtualizer.getTotalSize(),
                  width: '100%',
                  position: 'relative',
                }}
              >
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const item = flatItems[virtualRow.index]
                  if (item.type === 'header') {
                    return renderHeader(item, `translateY(${virtualRow.start}px)`, virtualRow.index)
                  }
                  return renderTask(item, `translateY(${virtualRow.start}px)`, virtualRow.index)
                })}
              </div>
            )}

            {/* Fallback: render all items when scroll container not ready */}
            {flatItems.length > 0 && !scrollReady && (
              <>
                {flatItems.map((item) => {
                  if (item.type === 'header') {
                    return renderHeader(item)
                  }
                  return renderTask(item)
                })}
              </>
            )}
          </div>

          {/* DragOverlay mirrors the active row so the user can see what
              they're dragging even when the source scrolled under the
              virtualizer's overscan window. */}
          <DragOverlay dropAnimation={null}>
            {activeTaskId
              ? (() => {
                  const activeTask = tasks.find((task) => task.id === activeTaskId)
                  if (!activeTask) return null
                  const activeItem = flatItems.find(
                    (item) => item.type === 'task' && item.task.id === activeTaskId
                  )
                  const activeDepth =
                    activeItem && activeItem.type === 'task' ? activeItem.depth : 0
                  return (
                    <div
                      className={styles.taskRow}
                      style={
                        {
                          '--event-color': activeTask.calendarColor,
                          marginLeft: activeDepth * 28,
                          cursor: 'grabbing',
                          boxShadow: '0 6px 16px rgba(0,0,0,0.18)',
                        } as React.CSSProperties
                      }
                      data-component="task-row-active-overlay"
                    >
                      <div className={styles.taskCheck} aria-hidden="true">
                        <svg
                          viewBox="0 0 14 14"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M3 7.5l2.5 2.5L11 4" />
                        </svg>
                      </div>
                      <div className={styles.taskBody}>
                        <div className={styles.taskTitle}>{activeTask.title}</div>
                      </div>
                      <div className={styles.taskMeta} />
                    </div>
                  )
                })()
              : null}
          </DragOverlay>
        </DndContext>
      </div>
      {createPortal(
        recurrenceTip ? (
          <div
            className={styles.recurrenceTooltip}
            role="tooltip"
            style={{ left: recurrenceTip.x + 12, top: recurrenceTip.y + 12 }}
          >
            {recurrenceTip.text.split('\n').map((line, i) => (
              <div key={line} className={i === 0 ? styles.recurrenceTooltipTitle : undefined}>
                {line}
              </div>
            ))}
          </div>
        ) : null,
        document.body
      )}
      {taskMenu && (
        <TaskContextMenu
          task={taskMenu.task}
          x={taskMenu.x}
          y={taskMenu.y}
          menuId={`task-${taskMenu.task.id}`}
          onEdit={() => handleTaskClick(taskMenu.task)}
          onClose={closeTaskMenu}
        />
      )}
    </div>
  )
}

// ─── Inner drag wrappers ────────────────────────────────────────────────────
// Defined outside the main component so they don't re-instantiate per render
// and so the hooks (`useDraggable`, `useDroppable`) sit at the top of the
// component tree, satisfying the rules-of-hooks rule.

interface DraggableTaskRowProps {
  taskId: string
  /** The active drag id from DndContext; when it matches this row's id, we
      drop the row's opacity so the DragOverlay owns the visual. */
  isActive: boolean
  children: (opts: {
    dragAttributes: Record<string, unknown>
    dragListeners: Record<string, unknown> | undefined
    dragStyle: React.CSSProperties
    setDropRef: (el: HTMLElement | null) => void
    isOver: boolean
  }) => JSX.Element
}

function DraggableTaskRow({ taskId, isActive, children }: DraggableTaskRowProps): JSX.Element {
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    transform,
    isDragging,
  } = useDraggable({ id: taskId })
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: taskId })
  // Combine refs (drag and drop) onto the same row — the row is both the
  // handle that initiates the drag and the target that accepts a drop.
  const setRef = useCallback(
    (el: HTMLElement | null) => {
      setDragRef(el)
      setDropRef(el)
    },
    [setDragRef, setDropRef]
  )
  const dragStyle: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    // While dragged, hide the source row so the DragOverlay is the only
    // visual. Without this we'd see two cards stacked.
    opacity: isDragging ? 0 : 1,
    cursor: 'grab',
  }
  return (
    <>
      {children({
        dragAttributes: attributes as unknown as Record<string, unknown>,
        dragListeners: listeners as unknown as Record<string, unknown> | undefined,
        dragStyle,
        setDropRef: setRef,
        isOver: isOver && !isActive,
      })}
    </>
  )
}
