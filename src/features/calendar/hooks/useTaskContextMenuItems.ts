import { useCallback } from 'react'
import type { ContextMenuItem } from '@/components/common/ContextMenu'
import { useCalendarStore, isCalendarReadOnly } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { safeCalDAVUpdate } from '@/lib/caldavHelpers'
import { completeTaskAndSync } from '@/lib/taskCompletion'
import { deleteEventWithUndo } from '@/lib/deleteWithUndo'
import { hapticIfEnabled } from '@/lib/haptics'
import { showToast } from '@/lib/toast'
import i18n from '@/lib/i18n'
import {
  taskMoveLabel,
  buildTaskMovePatch,
  describeTaskMove,
  taskMoveTargets,
} from '@/lib/taskScheduling'
import type { CalendarEvent } from '@/types'
import { isReorderable, planStep, useTaskReorder } from './useTaskReorder'

/**
 * A task row as the three surfaces know it. `occurrenceStart` is TodoView's
 * marker for the collapsed row standing in for a recurring series (see
 * TodoView's TaskWithColor); the other surfaces leave it undefined.
 */
export type TaskMenuTarget = CalendarEvent & { occurrenceStart?: string }

interface Options {
  /** Opens the task for editing. Omitted → no Edit item. */
  onEdit?: () => void
  /**
   * EventCard keeps its own Delete because it also drives the recurring
   * this/all dialog; the other surfaces take the plain undo-toast delete here.
   */
  includeDelete?: boolean
  /** Run after any action fires — used to dismiss the surface's own popover. */
  onAfterAction?: () => void
}

/**
 * The shared task actions behind every task context menu: reschedule, tick
 * off, delete. One implementation so the tasks list, the sidebar mini list
 * and the calendar's task pills can't drift apart.
 */
export function useTaskContextMenuItems(
  /**
   * Null when no row is targeted — TodoView calls this once at the top level
   * to reuse `toggleComplete` for its checkbox, long before (and after) any
   * menu is open.
   */
  task: TaskMenuTarget | null,
  { onEdit, includeDelete = true, onAfterAction }: Options = {}
): { items: ContextMenuItem[]; toggleComplete: (target?: TaskMenuTarget) => Promise<void> } {
  const updateEvent = useCalendarStore((s) => s.updateEvent)
  const addEvent = useCalendarStore((s) => s.addEvent)
  const deleteEvent = useCalendarStore((s) => s.deleteEvent)
  const completeTask = useCalendarStore((s) => s.completeTask)
  const completeTaskOccurrence = useCalendarStore((s) => s.completeTaskOccurrence)
  const completeTaskOccurrenceRolling = useCalendarStore((s) => s.completeTaskOccurrenceRolling)
  const taskCompletionMode = useSettingsStore((state) => state.taskCompletionMode)
  const {
    updateEvent: updateCalDAVEvent,
    createEvent: createCalDAVEvent,
    deleteEvent: deleteCalDAVEvent,
    saveRecurrenceOverride,
    saveRollingTaskCompletion,
  } = useCalDAV()
  const { moveStep } = useTaskReorder()

  const readOnly = task ? isCalendarReadOnly(task.calendarId) : true

  /**
   * The completion path TodoView has always used, lifted here so the checkbox
   * and the menu item stay one behaviour. Every surface now goes through
   * `completeTaskAndSync`, which picks the wire shape: a detached override
   * (R2.7) or — when the user opted into rolling mode (R2.8) — a re-anchored
   * master plus a standalone completed task.
   */
  const toggleComplete = useCallback(
    async (override?: TaskMenuTarget): Promise<void> => {
      const subject = override ?? task
      if (!subject || isCalendarReadOnly(subject.calendarId)) return
      // TodoView's marker for "this row is one occurrence of a series": the
      // row keeps the master's id, so the occurrence's own master comes from
      // the materialized occurrence rather than the row id.
      const target =
        subject.occurrenceStart && !subject.occurrenceMasterId
          ? { ...subject, occurrenceMasterId: subject.id }
          : subject
      try {
        await completeTaskAndSync(target, !subject.completed, {
          completeTask,
          completeTaskOccurrence,
          completeTaskOccurrenceRolling,
          updateCalDAVEvent,
          saveRecurrenceOverride,
          saveRollingTaskCompletion,
          taskCompletionMode,
        })
      } catch {
        // error handled by useCalDAV
      }
    },
    [
      task,
      completeTask,
      completeTaskOccurrence,
      completeTaskOccurrenceRolling,
      saveRecurrenceOverride,
      saveRollingTaskCompletion,
      taskCompletionMode,
      updateCalDAVEvent,
    ]
  )

  const items: ContextMenuItem[] = []
  if (!task) return { items, toggleComplete }

  if (onEdit) {
    items.push({
      label: i18n.t('common:actions.edit'),
      onClick: () => {
        onEdit()
        onAfterAction?.()
      },
    })
  }

  // Every remaining action writes to the calendar — on a read-only
  // subscription that would be wiped on the next refresh, so they are hidden
  // rather than offered and then quietly undone.
  if (readOnly) return { items, toggleComplete }

  for (const target of taskMoveTargets(task)) {
    items.push({
      label: taskMoveLabel(target),
      onClick: () => {
        const patch = buildTaskMovePatch(task, target)
        updateEvent(task.id, patch)
        hapticIfEnabled('light')
        showToast(describeTaskMove(target, patch.dueDate ?? task.start))
        void safeCalDAVUpdate(updateCalDAVEvent, task.calendarId, task, patch)
        onAfterAction?.()
      },
    })
  }

  // Offered only where the step exists: an untimed open task with a neighbour
  // above (or below) it in its day's list.
  if (isReorderable(task)) {
    const steps = [
      [-1, 'moveUp'],
      [1, 'moveDown'],
    ] as const
    for (const [direction, key] of steps) {
      if (!planStep(task, direction)) continue
      items.push({
        label: i18n.t(`calendar:ui.task.${key}`),
        dataComponent: `task-menu-${key === 'moveUp' ? 'move-up' : 'move-down'}`,
        onClick: () => {
          void moveStep(task, direction)
          onAfterAction?.()
        },
      })
    }
  }

  items.push({
    label: task.completed
      ? i18n.t('calendar:ui.task.markNotDone')
      : i18n.t('calendar:ui.task.markDone'),
    onClick: () => {
      hapticIfEnabled('light')
      void toggleComplete()
      onAfterAction?.()
    },
  })

  if (includeDelete) {
    items.push({
      label: i18n.t('common:actions.delete'),
      danger: true,
      onClick: () => {
        deleteEventWithUndo({
          event: task,
          deleteEvent,
          addEvent,
          createCalDAVEvent,
          deleteCalDAVEvent,
        })
        onAfterAction?.()
      },
    })
  }

  return { items, toggleComplete }
}
