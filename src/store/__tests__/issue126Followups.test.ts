import { describe, it, expect, beforeEach } from 'vitest'
import { useCalendarStore, getTasksForDay } from '../calendarStore'
import { expandZonedOccurrences } from '@/lib/occurrenceExpansion'
import { format } from 'date-fns'
import { deviceTimezone, toEventInstant } from '@/lib/datetime'
import { makeTask } from '@/lib/__tests__/fixtures'
import type { CalendarEvent } from '@/types'

/**
 * Follow-ups to the issue #126 fix. The suite runs twice — TZ=America/New_York
 * (west) and TZ=Europe/Copenhagen (east) — so every assertion here is an
 * invariant that must hold in both, not a hardcoded zone expectation.
 */

const clearStore = (): void => {
  const store = useCalendarStore.getState()
  store.events.forEach((e) => store.deleteEvent(e.id))
}

describe('issue 126 — the shape EventModal now writes', () => {
  beforeEach(clearStore)

  // The write-side half of the fix: a timed event keeps the wall clock the
  // user typed and carries the device TZID, instead of collapsing to a bare
  // UTC instant whose BYDAY is then read on UTC weekdays.
  it('keeps a 23:00 Mon–Fri series on Mon–Fri', () => {
    useCalendarStore.getState().addEvent({
      id: 'late-workweek',
      calendarId: 'default',
      title: 'Late standup',
      start: '2026-08-03T23:00:00',
      end: '2026-08-03T23:30:00',
      isAllDay: false,
      timezone: deviceTimezone(),
      recurrence: { frequency: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] },
      rruleString: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    })

    const week = useCalendarStore
      .getState()
      .getEventsForDateRange('2026-08-03', '2026-08-09')
      .filter((e) => e.id.startsWith('late-workweek'))

    // Mon 3rd through Fri 7th, at 23:00 local, in both projects. An
    // occurrence materializes as a true instant, so the day it *renders* on is
    // its local day — which is the whole point of the bug (west of UTC the UTC
    // day of a 23:00 start is already the next one).
    const localDay = (e: CalendarEvent): string =>
      format(toEventInstant(e.start, e.timezone), 'yyyy-MM-dd')
    expect(week.map(localDay).sort()).toEqual([
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
    ])
    for (const occ of week) {
      expect(toEventInstant(occ.start, occ.timezone).getHours()).toBe(23)
    }
  })
})

describe('issue 126 — the zoned walk preserves sub-second precision', () => {
  // ICAL.Time truncates a fractional `second`, so the walk has to add the
  // remainder back; without it every occurrence lands a fraction before the
  // master's own start and exact-instant EXDATE matching silently misses.
  it('carries the master start milliseconds onto every occurrence', () => {
    const master: CalendarEvent = {
      id: 'sub-second',
      calendarId: 'default',
      title: 'Odd start',
      start: '2026-08-03T12:00:00.500Z',
      end: '2026-08-03T12:30:00.500Z',
      isAllDay: false,
      rruleString: 'FREQ=DAILY',
    }

    const occurrences = expandZonedOccurrences(
      master,
      new Date('2026-08-03T00:00:00Z'),
      new Date('2026-08-06T00:00:00Z')
    )

    expect(occurrences).not.toBeNull()
    expect(occurrences!.length).toBeGreaterThan(0)
    expect(occurrences![0].toISOString()).toBe('2026-08-03T12:00:00.500Z')
    for (const occ of occurrences!) expect(occ.getMilliseconds()).toBe(500)
  })
})

describe('issue 126 — a legacy override suppresses exactly one occurrence', () => {
  beforeEach(clearStore)

  // A legacy override carries only a bare date, and before #126 a timed
  // day-key was the UTC day, so the lookup tries both frames. West of UTC an
  // evening series has an occurrence whose UTC day is the *next* occurrence's
  // wall day — matching both would blank two days for one override.
  it('does not also blank the neighbouring day', () => {
    const store = useCalendarStore.getState()
    // 01:00Z is the previous evening west of UTC: wall day and UTC day differ.
    store.addEvent({
      id: 'nightly',
      uid: 'nightly',
      calendarId: 'default',
      title: 'Nightly',
      start: '2026-08-01T01:00:00.000Z',
      end: '2026-08-01T01:30:00.000Z',
      isAllDay: false,
      rruleString: 'FREQ=DAILY',
      recurrence: { frequency: 'daily', interval: 1 },
    })

    const range = (): CalendarEvent[] =>
      useCalendarStore
        .getState()
        .getEventsForDateRange('2026-08-01', '2026-08-10')
        .filter((e) => e.id.startsWith('nightly-'))

    const before = range().length
    expect(before).toBeGreaterThan(2)

    // A legacy detached instance: a RECURRENCE-ID with no master link, so it
    // is keyed by bare date alone.
    useCalendarStore.getState().addEvent({
      id: 'legacy-override',
      uid: 'nightly',
      calendarId: 'default',
      title: 'Nightly (moved)',
      start: '2026-08-05T03:00:00.000Z',
      end: '2026-08-05T03:30:00.000Z',
      isAllDay: false,
      recurrenceId: '2026-08-05',
    })

    expect(range().length).toBe(before - 1)
  })
})

describe('issue 126 — a TZID task with a naive due date files on its wall day', () => {
  beforeEach(clearStore)

  // `dueDate` arrives from a synced VTODO as a naive wall clock in the task's
  // own zone, not as an instant. Reading it device-locally before converting
  // files an evening task on the wrong day for any device west of that zone.
  it('files a 20:00 Copenhagen task under its Copenhagen day', () => {
    useCalendarStore.getState().addEvent(
      makeTask({
        id: 'cph-task',
        uid: 'cph-task',
        calendarId: 'default',
        title: 'CPH evening task',
        isAllDay: false,
        timezone: 'Europe/Copenhagen',
        start: '2026-08-03T20:00:00',
        end: '2026-08-03T20:30:00',
        dueDate: '2026-08-03T20:00:00',
      })
    )

    const events = useCalendarStore.getState().events
    expect(getTasksForDay(events, '2026-08-03').some((e) => e.id === 'cph-task')).toBe(true)
    expect(getTasksForDay(events, '2026-08-04').some((e) => e.id === 'cph-task')).toBe(false)
  })
})
