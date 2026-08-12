import { useCallback } from 'react'
import type { ContextMenuItem } from '@/components/common/ContextMenu'
import { useCalendarStore, isCalendarReadOnly } from '@/store/calendarStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { safeCalDAVUpdate } from '@/lib/caldavHelpers'
import { deleteEventWithUndo } from '@/lib/deleteWithUndo'
import { hapticIfEnabled } from '@/lib/haptics'
import { showToast } from '@/lib/toast'
import {
  TASK_MOVE_LABELS,
  buildTaskMovePatch,
  describeTaskMove,
  taskMoveTargets,
} from '@/lib/taskScheduling'
import type { CalendarEvent } from '@/types'

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
  const {
    updateEvent: updateCalDAVEvent,
    createEvent: createCalDAVEvent,
    deleteEvent: deleteCalDAVEvent,
    saveRecurrenceOverride,
  } = useCalDAV()

  const readOnly = task ? isCalendarReadOnly(task.calendarId) : true

  /**
   * The completion path TodoView has always used, lifted here verbatim so the
   * checkbox and the menu item stay one behaviour. R2.7 — a recurring row
   * completes ONE occurrence via a detached override; the master's RRULE is
   * left alone so the series carries on.
   */
  const toggleComplete = useCallback(
    async (override?: TaskMenuTarget): Promise<void> => {
      const subject = override ?? task
      if (!subject || isCalendarReadOnly(subject.calendarId)) return
      const newCompleted = !subject.completed

      const recurringTarget = subject.occurrenceStart
        ? { masterId: subject.id, occurrenceStart: subject.occurrenceStart }
        : subject.recurrenceId && subject.recurrenceMasterId
          ? { masterId: subject.recurrenceMasterId, occurrenceStart: subject.recurrenceId }
          : null

      if (recurringTarget) {
        const plan = completeTaskOccurrence(
          recurringTarget.masterId,
          recurringTarget.occurrenceStart,
          newCompleted
        )
        if (plan) {
          try {
            await saveRecurrenceOverride(
              plan.master.calendarId,
              plan.master,
              plan.override,
              plan.removedOverrideIds
            )
          } catch {
            // error handled by useCalDAV
          }
        }
        return
      }

      const updatedTasks = completeTask(subject.id, newCompleted)
      try {
        await Promise.all(
          updatedTasks.map((updated) => updateCalDAVEvent(updated.calendarId, updated))
        )
      } catch {
        // error handled by useCalDAV
      }
    },
    [task, completeTask, completeTaskOccurrence, saveRecurrenceOverride, updateCalDAVEvent]
  )

  const items: ContextMenuItem[] = []
  if (!task) return { items, toggleComplete }

  if (onEdit) {
    items.push({
      label: 'Edit',
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
      label: TASK_MOVE_LABELS[target],
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

  items.push({
    label: task.completed ? 'Mark as not done' : 'Mark as done',
    onClick: () => {
      hapticIfEnabled('light')
      void toggleComplete()
      onAfterAction?.()
    },
  })

  if (includeDelete) {
    items.push({
      label: 'Delete',
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
