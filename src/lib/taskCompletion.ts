import type { CalendarEvent, TaskOccurrencePlan } from '@/types'
import { safeCalDAVUpdate } from '@/lib/caldavHelpers'

interface TaskCompletionDeps {
  completeTask: (id: string, completed: boolean) => CalendarEvent[]
  completeTaskOccurrence: (
    masterId: string,
    occurrenceStart: string,
    completed: boolean
  ) => TaskOccurrencePlan | null
  updateCalDAVEvent: (calendarId: string, event: CalendarEvent) => Promise<void>
  saveRecurrenceOverride: (
    calendarId: string,
    master: CalendarEvent,
    exception: CalendarEvent | null,
    removedExceptionIds?: string[]
  ) => Promise<void>
}

/** Complete one visible task or occurrence and sync every affected record. */
export async function completeTaskAndSync(
  task: CalendarEvent,
  completed: boolean,
  deps: TaskCompletionDeps
): Promise<void> {
  const occurrenceTarget = task.occurrenceMasterId
    ? { masterId: task.occurrenceMasterId, occurrenceStart: task.start }
    : task.recurrenceId && task.recurrenceMasterId && task.type === 'task'
      ? { masterId: task.recurrenceMasterId, occurrenceStart: task.recurrenceId }
      : null

  if (occurrenceTarget) {
    const plan = deps.completeTaskOccurrence(
      occurrenceTarget.masterId,
      occurrenceTarget.occurrenceStart,
      completed
    )
    if (!plan) return
    await deps.saveRecurrenceOverride(
      plan.master.calendarId,
      plan.master,
      plan.override,
      plan.removedOverrideIds
    )
    return
  }

  const updatedTasks = deps.completeTask(task.id, completed)
  await Promise.all(
    updatedTasks.map((updatedTask) =>
      safeCalDAVUpdate(deps.updateCalDAVEvent, updatedTask.calendarId, updatedTask, {
        completed: updatedTask.completed,
        taskStatus: updatedTask.taskStatus,
        percentComplete: updatedTask.percentComplete,
        completedAt: updatedTask.completedAt,
      })
    )
  )
}
