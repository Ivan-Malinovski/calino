import { describe, it, expect } from 'vitest'

import { buildMasterTruncation, getFutureOverrideIds, isFirstOccurrence } from '../recurrenceSplit'
import { makeEvent, makeRule } from './fixtures'
import type { CalendarEvent } from '@/types'
import { fromZonedTime } from 'date-fns-tz'

describe('buildMasterTruncation (R5.2: do not pollute excludedDates)', () => {
  it('returns excludedDates: [] when the master has no excludedDates', () => {
    const master = makeEvent({ recurrence: makeRule({ frequency: 'weekly' }) })
    const result = buildMasterTruncation(master, '2026-04-15')
    expect(result.excludedDates).toEqual([])
  })

  it('does NOT include occurrenceDateStr in excludedDates (R5.2 fix)', () => {
    const master = makeEvent({ recurrence: makeRule({ frequency: 'weekly' }) })
    const result = buildMasterTruncation(master, '2026-04-15')
    expect(result.excludedDates).not.toContain('2026-04-15')
  })

  it("preserves the master's existing excludedDates without appending the split date", () => {
    const master = makeEvent({
      recurrence: makeRule({ frequency: 'weekly' }),
      excludedDates: ['2026-03-01', '2026-03-08'],
    })
    const result = buildMasterTruncation(master, '2026-04-15')
    // Exact array — no push of '2026-04-15', no reordering, no dedup magic.
    expect(result.excludedDates).toEqual(['2026-03-01', '2026-03-08'])
  })

  it('sets recurrence.endDate immediately before the selected occurrence', () => {
    const master = makeEvent({ recurrence: makeRule({ frequency: 'weekly' }) })
    const result = buildMasterTruncation(master, '2026-04-15')
    expect(result.recurrence?.endDate).toBe('2026-04-15T08:59:59.000Z')
  })

  it('uses the event timezone when truncating a timed series', () => {
    const master = makeEvent({
      start: '2026-04-01T23:30:00',
      end: '2026-04-02T00:30:00',
      timezone: 'America/Los_Angeles',
      recurrence: makeRule({ frequency: 'daily' }),
    })

    const result = buildMasterTruncation(master, '2026-04-15T23:30:00')

    expect(result.recurrence?.endDate).toBe('2026-04-16T06:29:59.000Z')
  })

  it('reads a generated occurrence id as the instant it is', () => {
    const master = makeEvent({
      start: '2026-04-01T23:30:00',
      end: '2026-04-02T00:30:00',
      timezone: 'America/Los_Angeles',
      recurrence: makeRule({ frequency: 'hourly' }),
    })

    // What the zoned expansion produces for 23:30 Los Angeles: a true instant.
    // (This fixture used to build the id with `new Date(naive).toISOString()`,
    // reading the wall clock in the *device* zone, because that is what the
    // pre-#126 expansion did — and parseOccurrenceValue undid it by the same
    // offset. Both halves are gone; the id is now simply an instant.)
    const generatedOccurrenceId = fromZonedTime(
      '2026-04-15T23:30:00',
      'America/Los_Angeles'
    ).toISOString()
    expect(generatedOccurrenceId).toBe('2026-04-16T06:30:00.000Z')

    const result = buildMasterTruncation(master, generatedOccurrenceId)

    // One second before the occurrence, so the truncated master can no longer
    // emit it — the split date must not render the old and new times at once.
    expect(result.recurrence?.endDate).toBe('2026-04-16T06:29:59.000Z')
  })

  it('truncates an RRULE-string-only series without removing recurrence', () => {
    const master = makeEvent({
      recurrence: undefined,
      rruleString: 'FREQ=HOURLY;COUNT=20',
    })

    const result = buildMasterTruncation(master, '2026-04-15T15:00:00Z')

    expect(result.rruleString).toBe('FREQ=HOURLY;UNTIL=20260415T145959Z')
  })

  it('does not mutate the master event (pure function)', () => {
    const recurrence = makeRule({ frequency: 'weekly' })
    const excludedDates = ['2026-03-01', '2026-03-08']
    const master: CalendarEvent = makeEvent({
      recurrence,
      excludedDates,
    })
    const beforeJson = JSON.stringify(master)

    buildMasterTruncation(master, '2026-04-15')

    // Deep-equal: no field on the master was added, removed, or changed.
    expect(JSON.stringify(master)).toBe(beforeJson)
    // Identity: the recurrence and excludedDates array references are
    // preserved (no in-place mutation or replacement on the input).
    expect(master.recurrence).toBe(recurrence)
    expect(master.excludedDates).toBe(excludedDates)
  })
})

describe('isFirstOccurrence', () => {
  it('recognizes a generated first occurrence for a TZID series', () => {
    const master = makeEvent({
      start: '2026-04-15T23:30:00',
      end: '2026-04-16T00:30:00',
      timezone: 'America/Los_Angeles',
    })
    const generatedOccurrenceId = new Date(master.start).toISOString()

    expect(isFirstOccurrence(master, generatedOccurrenceId)).toBe(true)
  })

  it('does not treat a later occurrence as the first', () => {
    const master = makeEvent({ start: '2026-04-15T09:00:00Z' })
    expect(isFirstOccurrence(master, '2026-04-16T09:00:00Z')).toBe(false)
  })
})

describe('getFutureOverrideIds', () => {
  it('returns only overrides from the selected occurrence onward', () => {
    const master = makeEvent({ id: 'series', uid: 'series-uid' })
    const events = [
      master,
      makeEvent({
        id: 'past',
        uid: 'series-uid',
        recurrenceId: '2026-04-08T09:00:00.000Z',
        recurrenceMasterId: master.id,
      }),
      makeEvent({
        id: 'selected',
        uid: 'series-uid',
        recurrenceId: '2026-04-15T09:00:00.000Z',
        recurrenceMasterId: master.id,
      }),
      makeEvent({
        id: 'future',
        uid: 'series-uid',
        recurrenceId: '2026-04-22T09:00:00.000Z',
        recurrenceMasterId: master.id,
      }),
      makeEvent({
        id: 'other-series',
        uid: 'other-series',
        recurrenceId: '2026-04-22T09:00:00.000Z',
      }),
      makeEvent({
        id: 'other-calendar',
        uid: 'series-uid',
        calendarId: 'other-calendar',
        recurrenceId: '2026-04-22T09:00:00.000Z',
      }),
    ]

    expect(getFutureOverrideIds(events, master, '2026-04-15')).toEqual(['selected', 'future'])
  })

  it('preserves earlier overrides from the same day for sub-daily recurrence', () => {
    const master = makeEvent({ id: 'hourly', uid: 'hourly', rruleString: 'FREQ=HOURLY' })
    const events = [
      master,
      makeEvent({ id: 'morning', uid: 'hourly', recurrenceId: '2026-04-15T09:00:00Z' }),
      makeEvent({ id: 'selected', uid: 'hourly', recurrenceId: '2026-04-15T15:00:00Z' }),
      makeEvent({ id: 'later', uid: 'hourly', recurrenceId: '2026-04-15T18:00:00Z' }),
    ]

    expect(getFutureOverrideIds(events, master, '2026-04-15T15:00:00Z')).toEqual([
      'selected',
      'later',
    ])
  })
})
