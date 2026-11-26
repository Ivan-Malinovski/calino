import type { CalendarEvent, TaskOccurrencePlan } from '@/types'
import { safeCalDAVUpdate } from '@/lib/caldavHelpers'
import { offerRollingCompletion } from '@/lib/rollingCompletionPrompt'

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
  completeTaskOccurrenceRolling: (
    masterId: string,
    occurrenceStart: string
  ) => import('@/types').RollingTaskCompletionPlan | null
  saveRollingTaskCompletion: (calendarId: string, plan: import('@/types').RollingWritePlan) => Promise<void>
  getCalendar: (id: string) => import('@/types').Calendar | undefined
}

/** Complete one visible task or occurrence and sync every affected record. */
export async function completeTaskAndSync(
  task: CalendarEvent & { occurrenceStart?: string },
  completed: boolean,
  deps: TaskCompletionDeps
): Promise<void> {
  const occurrenceTarget = task.occurrenceStart
    ? { masterId: task.id, occurrenceStart: task.occurrenceStart }
    : task.occurrenceMasterId
      ? { masterId: task.occurrenceMasterId, occurrenceStart: task.start }
      : task.recurrenceId && task.recurrenceMasterId && task.type === 'task'
        ? { masterId: task.recurrenceMasterId, occurrenceStart: task.recurrenceId }
        : null

  if (occurrenceTarget) {
    const calendar = deps.getCalendar(task.calendarId)
    const mode = calendar?.taskCompletionMode ?? 'override'

    if (completed && mode === 'rolling') {
      const rollingPlan = deps.completeTaskOccurrenceRolling(
        occurrenceTarget.masterId,
        occurrenceTarget.occurrenceStart
      )
      if (rollingPlan?.kind === 'roll' || rollingPlan?.kind === 'final') {
        await deps.saveRollingTaskCompletion(task.calendarId, rollingPlan)
        return
      }
      if (rollingPlan?.kind === 'noop') return
    }

    const plan = deps.completeTaskOccurrence(
      occurrenceTarget.masterId,
      occurrenceTarget.occurrenceStart,
      completed
    )
    if (!plan) return
    // R2.8: completing a repeat is when the override shape is about to bite a
    // list edited by Tasks.org/OpenTasks, so that is when to offer the other one.
    if (completed && mode === 'override') offerRollingCompletion(task)
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
