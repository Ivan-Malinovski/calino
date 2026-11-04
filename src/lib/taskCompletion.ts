import type {
  CalendarEvent,
  RollingTaskCompletionPlan,
  RollingWritePlan,
  TaskCompletionMode,
  TaskOccurrencePlan,
} from '@/types'
import { safeCalDAVUpdate } from '@/lib/caldavHelpers'

interface TaskCompletionDeps {
  completeTask: (id: string, completed: boolean) => CalendarEvent[]
  completeTaskOccurrence: (
    masterId: string,
    occurrenceStart: string,
    completed: boolean
  ) => TaskOccurrencePlan | null
  /** R2.8 — rolling-mode plan: re-anchored master + standalone completed copy. */
  completeTaskOccurrenceRolling: (
    masterId: string,
    occurrenceStart: string
  ) => RollingTaskCompletionPlan | null
  updateCalDAVEvent: (calendarId: string, event: CalendarEvent) => Promise<void>
  saveRecurrenceOverride: (
    calendarId: string,
    master: CalendarEvent,
    exception: CalendarEvent | null,
    removedExceptionIds?: string[]
  ) => Promise<void>
  /** R2.8 — writes the rolling plan as two single-VTODO resources. */
  saveRollingTaskCompletion: (calendarId: string, plan: RollingWritePlan) => Promise<void>
  /**
   * The user's chosen wire shape (Settings → Tasks). Optional so callers that
   * predate rolling mode keep working; absent means the override default.
   */
  taskCompletionMode?: TaskCompletionMode
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
    // R2.8 — Rolling mode only changes how a *completion* is written. Reopening
    // an occurrence goes through the override path, where the stored shape says
    // what to undo; a standalone completed copy has no recurrence fields at all,
    // so it falls through to the plain branch below.
    if (completed && deps.taskCompletionMode === 'rolling') {
      const rollingPlan = deps.completeTaskOccurrenceRolling(
        occurrenceTarget.masterId,
        occurrenceTarget.occurrenceStart
      )
      if (rollingPlan?.kind === 'roll' || rollingPlan?.kind === 'final') {
        await deps.saveRollingTaskCompletion(rollingPlan.master.calendarId, rollingPlan)
        return
      }
      // A stale click names an occurrence the series has already moved past:
      // writing it again would duplicate a finished task, so do nothing.
      if (rollingPlan?.kind === 'noop') return
      // `fallback` (or no plan at all — no RRULE / no due date) leaves the
      // occurrence to the override shape, which describes it correctly.
    }

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
