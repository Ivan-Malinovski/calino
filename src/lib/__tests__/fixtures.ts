import type { CalendarEvent, RecurrenceRule } from '@/types'

/**
 * Build a {@link CalendarEvent} suitable for unit tests. Pass
 * `overrides` to set or replace any field.
 *
 * Default shape mirrors a typical 1-hour timed event so that callers
 * only need to specify the fields they actually exercise.
 */
export function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'test',
    calendarId: 'cal1',
    title: 'Test',
    start: '2024-03-15T09:00:00Z',
    end: '2024-03-15T10:00:00Z',
    isAllDay: false,
    type: 'event',
    ...overrides,
  }
}

/**
 * Build a {@link RecurrenceRule} suitable for unit tests. Pass
 * `overrides` to set or replace any field.
 */
export function makeRule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return {
    frequency: 'daily',
    interval: 1,
    ...overrides,
  }
}

/**
 * Build an all-day VTODO-shaped {@link CalendarEvent}.
 *
 * Tasks reuse the event fields: `start` is DTSTART, `end` is DUE, and
 * `dueDate` mirrors `end` — see the R2.7 data model.
 */
export function makeTask(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  const start = overrides.start ?? '2026-03-03T00:00:00'
  return {
    id: 'task1',
    uid: 'task1',
    calendarId: 'cal1',
    title: 'Test task',
    start,
    end: start,
    dueDate: start,
    isAllDay: true,
    type: 'task',
    completed: false,
    taskStatus: 'NEEDS-ACTION',
    ...overrides,
  }
}

/**
 * Build a recurring task master.
 *
 * Sets BOTH `rruleString` and a matching structured `recurrence`, because that
 * is what real data looks like: the CalDAV adapter always populates the pair,
 * and so does the event form. A fixture carrying only `rruleString` would be a
 * shape nothing produces — and it hides real defects, since parts of the UI
 * (e.g. the recurrence checkbox in `eventModalState`) read `recurrence` alone.
 */
export function makeRecurringTask(
  rruleString = 'FREQ=WEEKLY;BYDAY=TU',
  overrides: Partial<CalendarEvent> = {}
): CalendarEvent {
  return makeTask({ rruleString, recurrence: parseRRuleForFixture(rruleString), ...overrides })
}

/** Minimal RRULE→RecurrenceRule for fixtures; only the parts tests use. */
function parseRRuleForFixture(rruleString: string): RecurrenceRule {
  const parts = new Map(
    rruleString.split(';').map((p) => {
      const [k, v] = p.split('=')
      return [k, v] as const
    })
  )
  const freqMap: Record<string, RecurrenceRule['frequency']> = {
    DAILY: 'daily',
    WEEKLY: 'weekly',
    MONTHLY: 'monthly',
    YEARLY: 'yearly',
  }
  const dayMap: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }
  const byDay = parts.get('BYDAY')
  const count = parts.get('COUNT')
  return {
    frequency: freqMap[parts.get('FREQ') ?? 'WEEKLY'] ?? 'weekly',
    interval: parts.get('INTERVAL') ? parseInt(parts.get('INTERVAL') as string, 10) : 1,
    byWeekday: byDay ? byDay.split(',').map((d) => dayMap[d] ?? 1) : undefined,
    count: count ? parseInt(count, 10) : undefined,
  }
}

/**
 * Build a `{start, end}` ISO-string pair on a given calendar day
 * (local time). Used by the event-positioning tests which need to
 * place events at specific local times.
 */
export function eventTimeRange(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  durationMs = 60 * 60 * 1000
): { start: string; end: string } {
  const start = new Date(year, month, day, hour, minute)
  const end = new Date(start.getTime() + durationMs)
  return { start: start.toISOString(), end: end.toISOString() }
}
