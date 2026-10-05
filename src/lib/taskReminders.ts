import { isBefore, parseISO, setHours, startOfDay } from 'date-fns'
import { toEventInstant } from '@/lib/datetime'
import { hasDueTime } from '@/lib/events'
import { resolveRecurringTasks } from '@/lib/openTasks'
import { calendarMutesReminders } from '@/store/calendarStore'
import type { Calendar, CalendarEvent } from '@/types'

/** Reminder id carried by the synthetic due-date reminder of a task. */
export const TASK_DUE_REMINDER_ID = 'task-due'

/** Local hour a date-only task is announced at; a timed task is announced at its time. */
export const TASK_ALL_DAY_REMINDER_HOUR = 9

/**
 * The instant a task falls due. A task with a time is due at that time (resolved
 * through its zone, if it has one); one with only a date has no time of its own,
 * so it is announced at `TASK_ALL_DAY_REMINDER_HOUR` local time on its day.
 *
 * "Only a date" follows `hasDueTime`: a bare `yyyy-MM-dd`, an all-day task, or a
 * midnight value all count, since that is how the rest of the app tells them
 * apart. The date is read as a calendar day, never as an instant, so a floating
 * all-day value stored with a trailing `Z` cannot slip a day west of UTC.
 */
export function taskDueInstant(
  task: Partial<Pick<CalendarEvent, 'dueDate' | 'timezone' | 'isAllDay'>>
): Date | null {
  if (!task.dueDate) return null
  const due = hasDueTime(task)
    ? toEventInstant(task.dueDate, task.timezone)
    : setHours(parseISO(task.dueDate.slice(0, 10)), TASK_ALL_DAY_REMINDER_HOUR)
  return Number.isNaN(due.getTime()) ? null : due
}

/**
 * One zero-lead reminder event per open task that falls due inside `[from, to]`,
 * so the existing event-reminder machinery (web polling, native scheduling) can
 * announce task due dates without a second code path.
 *
 * Recurring tasks contribute only their next open occurrence, and tasks on
 * hidden calendars or muted webcal overlays stay quiet, like events do. The
 * synthetic event keeps the task's own id (the master's, for an occurrence) so
 * a tap on the notification opens the task.
 */
export function buildTaskDueReminderEvents(
  events: CalendarEvent[],
  calendars: Calendar[],
  from: Date,
  to: Date
): CalendarEvent[] {
  const calendarById = new Map(calendars.map((calendar) => [calendar.id, calendar]))
  const reminders: CalendarEvent[] = []
  for (const task of resolveRecurringTasks(events)) {
    if (task.type !== 'task' || task.completed || !task.dueDate) continue
    const calendar = calendarById.get(task.calendarId)
    if (!calendar?.isVisible || calendarMutesReminders(calendar)) continue
    const due = taskDueInstant(task)
    if (!due || isBefore(due, from) || isBefore(to, due)) continue
    reminders.push({
      ...task,
      id: task.occurrenceMasterId ?? task.id,
      start: due.toISOString(),
      end: due.toISOString(),
      isAllDay: false,
      reminders: [{ id: TASK_DUE_REMINDER_ID, minutesBefore: 0, method: 'popup' }],
    })
  }
  return reminders
}

/**
 * How many open top-level tasks are past due, counted the way the sidebar lists
 * them: whole days, so a task due earlier today is not overdue until tomorrow.
 */
export function countOverdueTasks(
  events: CalendarEvent[],
  calendars: Calendar[],
  now: Date
): number {
  const visibleCalendarIds = new Set(
    calendars.filter((calendar) => calendar.isVisible).map((calendar) => calendar.id)
  )
  const today = startOfDay(now)
  return resolveRecurringTasks(events).filter(
    (task) =>
      task.type === 'task' &&
      !task.parentTaskId &&
      !task.completed &&
      !!task.dueDate &&
      visibleCalendarIds.has(task.calendarId) &&
      isBefore(startOfDay(parseISO(task.dueDate)), today)
  ).length
}
