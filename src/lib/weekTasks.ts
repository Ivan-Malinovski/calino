import { differenceInCalendarDays, format } from 'date-fns'
import type { CalendarEvent } from '@/types'
import { toEventInstant } from '@/lib/datetime'

/** A task whose start→due range covers at least this many calendar days. */
export const WEEK_TASK_MIN_DAYS = 3

function dayOf(iso: string, timezone?: string): Date {
  const instant = toEventInstant(iso, timezone)
  return new Date(instant.getFullYear(), instant.getMonth(), instant.getDate())
}

/**
 * The first and last calendar day (`yyyy-MM-dd`) of a task's DTSTART→DUE
 * range, or null when it has no range (undated, or start on/after due).
 */
export function taskDayRange(task: CalendarEvent): { startKey: string; dueKey: string } | null {
  if (task.type !== 'task' || !task.dueDate || !task.start) return null
  const start = dayOf(task.start, task.timezone)
  const due = dayOf(task.dueDate, task.timezone)
  if (Number.isNaN(start.getTime()) || Number.isNaN(due.getTime())) return null
  if (due.getTime() <= start.getTime()) return null
  return { startKey: format(start, 'yyyy-MM-dd'), dueKey: format(due, 'yyyy-MM-dd') }
}

/**
 * "Sometime this week" tasks: a plain (non-recurring) task whose start→due
 * range spans {@link WEEK_TASK_MIN_DAYS} or more calendar days. Nothing is
 * stored to mark them, so other CalDAV clients just see an ordinary task with
 * a DTSTART and DUE.
 */
export function isWeekScopedTask(task: CalendarEvent): boolean {
  if (task.rruleString || task.recurrence || task.recurrenceId || task.occurrenceMasterId) {
    return false
  }
  const range = taskDayRange(task)
  if (!range) return false
  const span = differenceInCalendarDays(new Date(range.dueKey), new Date(range.startKey)) + 1
  return span >= WEEK_TASK_MIN_DAYS
}

/**
 * Week-scoped tasks overlapping [rangeStartKey, rangeEndKey] (inclusive),
 * ordered by start then due date, then title so the order is stable.
 */
export function weekScopedTasksInRange(
  events: CalendarEvent[],
  rangeStartKey: string,
  rangeEndKey: string,
  visibleCalendarIds: ReadonlySet<string>
): CalendarEvent[] {
  const scoped: Array<{ task: CalendarEvent; startKey: string; dueKey: string }> = []
  for (const task of events) {
    if (!visibleCalendarIds.has(task.calendarId) || !isWeekScopedTask(task)) continue
    const range = taskDayRange(task)
    if (!range || range.dueKey < rangeStartKey || range.startKey > rangeEndKey) continue
    scoped.push({ task, ...range })
  }
  scoped.sort(
    (a, b) =>
      a.startKey.localeCompare(b.startKey) ||
      a.dueKey.localeCompare(b.dueKey) ||
      a.task.title.localeCompare(b.task.title)
  )
  return scoped.map((entry) => entry.task)
}
