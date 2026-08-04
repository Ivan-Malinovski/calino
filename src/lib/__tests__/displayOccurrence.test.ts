import { describe, it, expect } from 'vitest'
import { displayOccurrence } from '../occurrenceExpansion'
import type { CalendarEvent } from '@/types'

/**
 * The occurrence that represents a series in a single-row context. Anchored on
 * "now" rather than on the master's DTSTART, which for a long-running weekly is
 * years stale.
 */
const NOW = new Date('2026-08-04T12:00:00Z') // a Tuesday

const series = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'm1',
  calendarId: 'cal1',
  title: 'Standup',
  start: '2024-01-02T09:00:00.000Z',
  end: '2024-01-02T09:15:00.000Z',
  isAllDay: false,
  rruleString: 'FREQ=WEEKLY;BYDAY=TU',
  ...over,
})

describe('displayOccurrence', () => {
  it('returns the next occurrence, not the series start', () => {
    const shape = displayOccurrence(series(), NOW)
    // Today's 09:00 is already past at 12:00, so the next is a week out.
    expect(shape?.occStartStr).toBe('2026-08-11T09:00:00.000Z')
  })

  it('counts an occurrence still to come today', () => {
    const shape = displayOccurrence(series(), new Date('2026-08-04T07:00:00Z'))
    expect(shape?.occStartStr).toBe('2026-08-04T09:00:00.000Z')
  })

  it('preserves the master duration on the occurrence', () => {
    const shape = displayOccurrence(series(), NOW)
    expect(shape?.occEndStr).toBe('2026-08-11T09:15:00.000Z')
  })

  it('falls back to the last occurrence of a finished series', () => {
    const shape = displayOccurrence(series({ rruleString: 'FREQ=WEEKLY;BYDAY=TU;COUNT=3' }), NOW)
    expect(shape?.occStartStr).toBe('2024-01-16T09:00:00.000Z')
  })

  it('skips an EXDATEd occurrence in the forward walk', () => {
    const shape = displayOccurrence(
      series({ excludedDates: ['2026-08-11T09:00:00.000Z'] }),
      new Date('2026-08-05T00:00:00Z')
    )
    expect(shape?.occStartStr).toBe('2026-08-18T09:00:00.000Z')
  })

  it('skips an EXDATEd occurrence in the backward walk', () => {
    const shape = displayOccurrence(
      series({
        rruleString: 'FREQ=WEEKLY;BYDAY=TU;COUNT=3',
        excludedDates: ['2024-01-16T09:00:00.000Z'],
      }),
      NOW
    )
    expect(shape?.occStartStr).toBe('2024-01-09T09:00:00.000Z')
  })

  const allDaySeries = (over: Partial<CalendarEvent> = {}) =>
    series({ start: '2024-01-02', end: '2024-01-02', isAllDay: true, ...over })

  it('treats an all-day occurrence as current for the whole of today', () => {
    // NOW is itself a Tuesday. An all-day item has no time of day to be past,
    // so today's occurrence is the one to show — not next week's.
    const shape = displayOccurrence(allDaySeries(), NOW)
    expect(shape?.occDateStr).toBe('2026-08-04')
    // Floating midnight, not an instant: all-day dates are timezone-less
    // (RFC 5545 §3.3.4) and must land on the named day at any offset.
    expect(shape?.occStartStr).toBe('2026-08-04T00:00:00')
  })

  it('moves to the next all-day occurrence once today has passed', () => {
    const shape = displayOccurrence(allDaySeries(), new Date('2026-08-05T12:00:00Z'))
    expect(shape?.occDateStr).toBe('2026-08-11')
  })

  it('returns null for a non-recurring event', () => {
    expect(displayOccurrence(series({ rruleString: undefined }), NOW)).toBeNull()
  })

  it('returns null for an unparseable rule rather than throwing', () => {
    expect(displayOccurrence(series({ rruleString: 'FREQ=NONSENSE' }), NOW)).toBeNull()
  })
})
