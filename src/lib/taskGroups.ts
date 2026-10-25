import { daysBetween, toEventInstant } from '@/lib/datetime'
import { hasDueTime } from '@/lib/events'
import { homeDayKey, storedDayKey } from '@/lib/homeTimezone'
import type { CalendarEvent } from '@/types'

export type TaskGroupKey = 'overdue' | 'today' | 'week' | 'later' | 'nodate'

/**
 * The task-list group a task falls under, anchored to an explicit `now`.
 *
 * A task due today at a time that has already passed is overdue too, not just
 * one due on an earlier day. A date-only task due today stays under today
 * until the day is over.
 */
export function getTaskGroup(
  task: Partial<Pick<CalendarEvent, 'dueDate' | 'timezone' | 'isAllDay'>>,
  now: Date
): TaskGroupKey {
  if (!task.dueDate) return 'nodate'

  const diffDays = daysBetween(
    homeDayKey(now),
    storedDayKey(task.dueDate, task.timezone, task.isAllDay)
  )

  if (diffDays < 0) return 'overdue'
  if (
    diffDays === 0 &&
    hasDueTime(task) &&
    toEventInstant(task.dueDate, task.timezone).getTime() < now.getTime()
  ) {
    return 'overdue'
  }
  if (diffDays === 0) return 'today'
  if (diffDays <= 6) return 'week'
  return 'later'
}
