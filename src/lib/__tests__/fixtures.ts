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
