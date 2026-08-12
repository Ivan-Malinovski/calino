import { addDays, differenceInCalendarDays, format, parseISO, startOfDay } from 'date-fns'
import type { CalendarEvent } from '@/types'

export type TaskMoveTarget = 'today' | 'tomorrow' | 'nextWeek'

export const TASK_MOVE_LABELS: Record<TaskMoveTarget, string> = {
  today: 'Move to today',
  tomorrow: 'Move to tomorrow',
  nextWeek: 'Move to next week',
}

type TaskLike = Pick<
  CalendarEvent,
  | 'start'
  | 'end'
  | 'dueDate'
  | 'rruleString'
  | 'recurrence'
  | 'recurrenceId'
  | 'recurrenceMasterId'
  | 'occurrenceMasterId'
> & { occurrenceStart?: string }

/**
 * A row that stands in for a whole series — either the master itself or one of
 * its expanded/detached occurrences. Rescheduling one of these would either
 * silently move every future occurrence or need override plumbing, so the
 * reschedule shortcuts are withheld from them entirely.
 */
export function isRepeatingTask(task: TaskLike): boolean {
  return Boolean(
    task.rruleString ||
    task.recurrence ||
    task.recurrenceId ||
    task.recurrenceMasterId ||
    task.occurrenceMasterId ||
    task.occurrenceStart
  )
}

/** The date half of a `yyyy-MM-dd` or `yyyy-MM-ddTHH:mm` string. */
function datePart(value: string): string {
  return value.split('T')[0]
}

/** The `THH:mm…` suffix, or '' when the value carries no time. */
function timeSuffix(value: string): string {
  const index = value.indexOf('T')
  return index === -1 ? '' : value.slice(index)
}

/**
 * Which reschedule options to offer. A task due today can only be pushed
 * forward, everything else (including a task with no due date at all) is
 * offered "today" instead.
 */
export function taskMoveTargets(task: TaskLike, now: Date = new Date()): TaskMoveTarget[] {
  if (isRepeatingTask(task)) return []
  const dueToday =
    Boolean(task.dueDate) &&
    differenceInCalendarDays(startOfDay(parseISO(task.dueDate!)), startOfDay(now)) === 0
  return dueToday ? ['tomorrow', 'nextWeek'] : ['today', 'nextWeek']
}

/** The `yyyy-MM-dd` a target resolves to for this task. */
function resolveTargetDate(task: TaskLike, target: TaskMoveTarget, now: Date): string {
  const today = startOfDay(now)
  if (target === 'today') return format(today, 'yyyy-MM-dd')
  if (target === 'tomorrow') return format(addDays(today, 1), 'yyyy-MM-dd')
  // "Next week" means the same weekday one week on, so it counts from the
  // task's own due date — not from today, which would land on an arbitrary day
  // for anything already scheduled. An overdue task counts from today instead:
  // a week on from a date already past would leave it still overdue.
  const due = task.dueDate ? startOfDay(parseISO(task.dueDate)) : today
  const base = due > today ? due : today
  return format(addDays(base, 7), 'yyyy-MM-dd')
}

/**
 * The patch that moves a task to `target`.
 *
 * `start`/`end` move with the due date: the calendar grid and agenda place a
 * task by its `start`, so writing `dueDate` alone would leave the row sitting
 * on its old day. Times of day and the start→end duration are preserved.
 */
export function buildTaskMovePatch(
  task: TaskLike,
  target: TaskMoveTarget,
  now: Date = new Date()
): Partial<CalendarEvent> {
  const newDate = resolveTargetDate(task, target, now)
  const patch: Partial<CalendarEvent> = {
    dueDate: task.dueDate ? `${newDate}${timeSuffix(task.dueDate)}` : newDate,
  }

  if (task.start) {
    const shift = differenceInCalendarDays(parseISO(newDate), parseISO(datePart(task.start)))
    patch.start = `${newDate}${timeSuffix(task.start)}`
    if (task.end) {
      // Shift by the same number of days rather than pinning to newDate, so a
      // task whose end lands on a later day keeps its span.
      const newEndDate = format(addDays(parseISO(datePart(task.end)), shift), 'yyyy-MM-dd')
      patch.end = `${newEndDate}${timeSuffix(task.end)}`
    }
  }

  return patch
}

/** Short human confirmation for the toast, e.g. "Moved to Tue, 18 Aug". */
export function describeTaskMove(target: TaskMoveTarget, dateISO: string): string {
  if (target === 'today') return 'Moved to today'
  if (target === 'tomorrow') return 'Moved to tomorrow'
  return `Moved to ${format(parseISO(datePart(dateISO)), 'EEE, d MMM')}`
}
