import { describe, it, expect, beforeEach } from 'vitest'
import { useCalendarStore } from '../calendarStore'
import { nextOpenOccurrence } from '@/lib/occurrenceExpansion'
import { makeRecurringTask, makeTask } from '@/lib/__tests__/fixtures'
import type { CalendarEvent } from '@/types'

/**
 * Phase 2 (C1) - timed TZID series expansion must keep the wall clock in
 * the series' own zone across DST, and the materialized occurrences must
 * carry the correct instants regardless of the test's ambient zone.
 *
 * Europe/Copenhagen 2026: CET (+01) until 2026-03-29 02:00, then CEST
 * (+02). Wall 10:00 = 09:00Z before spring-forward, 08:00Z after. Both
 * assertions are instants, so they are zone-independent in the two
 * vitest projects. Today's rrule-on-UTC-anchor code produces 09:00Z
 * everywhere (fixed UTC hour) - which fails the June assertion in both
 * projects and the March assertion west of UTC.
 */
describe('timed TZID series expansion (Phase 2 C1)', () => {
  beforeEach(() => {
    const store = useCalendarStore.getState()
    store.events.forEach((e) => store.deleteEvent(e.id))
  })

  function addCopenhagenDaily(): void {
    useCalendarStore.getState().addEvent({
      id: 'cph',
      calendarId: 'default',
      title: 'Copenhagen Daily',
      start: '2026-03-25T10:00:00',
      end: '2026-03-25T11:00:00',
      isAllDay: false,
      timezone: 'Europe/Copenhagen',
      recurrence: { frequency: 'daily', interval: 1 },
      rruleString: 'FREQ=DAILY',
    })
  }

  it('keeps the 10:00 Copenhagen wall clock across spring-forward', () => {
    addCopenhagenDaily()
    const store = useCalendarStore.getState()
    const march = store.getEventsForDateRange('2026-03-25', '2026-03-31')
    const june = store.getEventsForDateRange('2026-06-01', '2026-06-07')

    const mar25 = march.find((e) => e.id.startsWith('cph-') && e.start.startsWith('2026-03-25'))
    const jun1 = june.find((e) => e.id.startsWith('cph-') && e.start.startsWith('2026-06-01'))
    expect(mar25).toBeDefined()
    expect(jun1).toBeDefined()
    expect(mar25!.start).toBe('2026-03-25T09:00:00.000Z') // CET +01
    expect(jun1!.start).toBe('2026-06-01T08:00:00.000Z') // CEST +02
  })

  it('excludes an EXDATE in the series zone frame, not the device frame', () => {
    addCopenhagenDaily()
    const store = useCalendarStore.getState()
    // The stored EXDATE is a naive wall clock in the series zone (10:00 CPH
    // on Mar 26 = 09:00Z). A device-local parse (14:00Z west of UTC) must
    // NOT be what the exclusion compares against.
    store.updateEvent('cph', { excludedDates: ['2026-03-26T10:00:00'] })
    const march = store.getEventsForDateRange('2026-03-25', '2026-03-28')
    const mar26 = march.find((e) => e.id.startsWith('cph-') && e.start.startsWith('2026-03-26'))
    expect(mar26).toBeUndefined()
    expect(march.some((e) => e.id.startsWith('cph-') && e.start.startsWith('2026-03-25'))).toBe(
      true
    )
  })

  it('matches a detached override by the series zone frame', () => {
    addCopenhagenDaily()
    const store = useCalendarStore.getState()
    store.addEvent({
      id: 'cph-override-mar30',
      calendarId: 'default',
      title: 'Moved Monday',
      start: '2026-03-30T10:00:00',
      end: '2026-03-30T11:00:00',
      isAllDay: false,
      timezone: 'Europe/Copenhagen',
      recurrenceId: '2026-03-30T10:00:00',
      recurrenceMasterId: 'cph',
    })
    const march = store.getEventsForDateRange('2026-03-30', '2026-04-05')
    // The master slot for Mar 30 must be suppressed (override supersedes it).
    const masterSlot = march.find((e) => e.id.startsWith('cph-2026-03-30'))
    expect(masterSlot).toBeUndefined()
    // And the override itself is present.
    expect(march.some((e) => e.id === 'cph-override-mar30')).toBe(true)
  })
  describe('updateEvent TZID normalization (Phase 2 C3)', () => {
    it('converts a Z instant update to the event zone wall clock', () => {
      addCopenhagenDaily()
      useCalendarStore.getState().updateEvent('cph', {
        start: '2026-06-01T06:00:00.000Z',
        end: '2026-06-01T07:00:00.000Z',
      })
      const ev = useCalendarStore.getState().events.find((e) => e.id === 'cph')!
      expect(ev.start).toBe('2026-06-01T08:00:00')
      expect(ev.end).toBe('2026-06-01T09:00:00')
      expect(ev.timezone).toBe('Europe/Copenhagen')
    })
    it('leaves naive (already zone-frame) updates untouched', () => {
      addCopenhagenDaily()
      useCalendarStore.getState().updateEvent('cph', {
        start: '2026-06-01T08:00:00',
        end: '2026-06-01T09:00:00',
      })
      const ev = useCalendarStore.getState().events.find((e) => e.id === 'cph')!
      expect(ev.start).toBe('2026-06-01T08:00:00')
      expect(ev.end).toBe('2026-06-01T09:00:00')
    })
  })
})

/**
 * nextOpenOccurrence must judge "is this occurrence already past?" in the
 * same frame the zoned walk generates in. The cursor is initialized from the
 * master's own start via occurrenceInstant (the series' zone for a timed
 * TZID master, UTC midnight for all-day), so the first real occurrence is a
 * candidate instead of being sorted a day late by a device-zone parse.
 * Assertions are instants (toISOString), so they hold in both vitest
 * projects regardless of the ambient zone.
 */
describe('nextOpenOccurrence with timed TZID tasks', () => {
  const overrideMap = (...entries: CalendarEvent[]): Map<string, CalendarEvent> =>
    new Map(entries.map((e) => [e.recurrenceId as string, e]))

  const makeCopenhagenDaily = (start: string, end: string): CalendarEvent =>
    makeRecurringTask('FREQ=DAILY', {
      isAllDay: false,
      timezone: 'Europe/Copenhagen',
      start,
      end,
      rruleString: 'FREQ=DAILY',
    })

  it('returns the first occurrence at its true instant, not a day late', () => {
    // Wall 10:00 Copenhagen = 09:00Z (CET). The buggy cursor (device-parse of
    // the naive wall clock) sorted this occurrence before the walk and the
    // function returned Feb 11 instead.
    const master = makeCopenhagenDaily('2026-02-10T10:00:00', '2026-02-10T11:00:00')
    expect(nextOpenOccurrence(master, new Map())!.occStartStr).toBe('2026-02-10T09:00:00.000Z')
  })

  it('advances past a completed first occurrence', () => {
    const master = makeCopenhagenDaily('2026-02-10T10:00:00', '2026-02-10T11:00:00')
    const done = makeTask({
      recurrenceId: '2026-02-10T10:00:00',
      completed: true,
      taskStatus: 'COMPLETED',
    })

    expect(nextOpenOccurrence(master, overrideMap(done))!.occStartStr).toBe(
      '2026-02-11T09:00:00.000Z'
    )
  })

  it('keeps occurrence instants correct across the 2026-03-29 spring-forward', () => {
    const master = makeCopenhagenDaily('2026-03-25T10:00:00', '2026-03-25T11:00:00')

    // Before spring-forward: wall 10:00 CET = 09:00Z.
    expect(nextOpenOccurrence(master, new Map())!.occStartStr).toBe('2026-03-25T09:00:00.000Z')

    // Complete every occurrence up to and including Mar 28 (still CET).
    const done = ['2026-03-25', '2026-03-26', '2026-03-27', '2026-03-28'].map((d) =>
      makeTask({ recurrenceId: d + 'T10:00:00', completed: true, taskStatus: 'COMPLETED' })
    )
    // After spring-forward: wall 10:00 CEST = 08:00Z.
    expect(nextOpenOccurrence(master, overrideMap(...done))!.occStartStr).toBe(
      '2026-03-29T08:00:00.000Z'
    )
  })
})
