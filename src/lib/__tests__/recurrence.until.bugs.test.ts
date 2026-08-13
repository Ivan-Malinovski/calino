import { describe, it, expect } from 'vitest'
import { buildRRuleString, describeRecurrence } from '../recurrence'
import { makeEvent, makeRule } from './fixtures'

/**
 * Recurrence UNTIL, west of UTC.
 *
 * Two defects of the same family, found while pinning the suite's timezone
 * (see vite.config.ts). `rule.endDate` arrives in three shapes — floating date,
 * floating local wall clock, and true UTC instant — and both the description
 * and the all-day serializer used to treat them as one.
 *
 * The serializer cases below hold in any zone. The two description cases that
 * start from a UTC instant do not, and cannot: rendering an instant in the
 * user's own day is the whole fix, so their expectation moves with the zone.
 * They are written against the suite's America/New_York pin (vite.config.ts),
 * where 2026-01-01T04:59:59Z is the evening of Dec 31 — exactly the instant a
 * New York user creates by ending a series on Dec 31 at 23:59.
 */

describe('describeRecurrence renders UNTIL in the local day', () => {
  it('describes a picker-set end date as the day the user picked', () => {
    // The "repeat until" picker writes a floating local wall clock
    // (EventModal). rrule.toText() renders UNTIL with UTC getters, so west of
    // UTC this used to read "until January 1, 2026".
    const event = makeEvent({
      recurrence: makeRule({ frequency: 'daily', endDate: '2025-12-31T23:59:59' }),
    })
    expect(describeRecurrence(event)).toBe('Every day until December 31, 2025')
  })

  it('describes a synced UTC UNTIL in the local day', () => {
    // What a server stores for a series a New York user ended on Dec 31 23:59
    // local. This is the common path — synced events carry rruleString — and
    // nothing covered it before.
    const event = makeEvent({ rruleString: 'FREQ=DAILY;UNTIL=20260101T045959Z' })
    expect(describeRecurrence(event)).toBe('Every day until December 31, 2025')
  })

  it('leaves a date-only UNTIL alone', () => {
    // Floating: no zone to convert from. This pins the *pair* — parsing a
    // zoneless value as local and reading it back with local getters is an
    // identity. Reading it as UTC instead (the obvious wrong turn) would move
    // it a day backwards west of UTC, and this is what would catch that.
    const event = makeEvent({ rruleString: 'FREQ=DAILY;UNTIL=20251231' })
    expect(describeRecurrence(event)).toBe('Every day until December 31, 2025')
  })

  it('keeps describing rules with other parts after the UNTIL rewrite', () => {
    const event = makeEvent({ rruleString: 'FREQ=WEEKLY;UNTIL=20260101T045959Z;BYDAY=MO,WE' })
    expect(describeRecurrence(event)).toBe('Every week on Monday, Wednesday until December 31, 2025')
  })

  it('falls back to the raw string when UNTIL is unparseable', () => {
    const event = makeEvent({ rruleString: 'FREQ=DAILY;UNTIL=not-a-date' })
    expect(describeRecurrence(event)).toBe('Recurring')
  })
})

describe('buildRRuleString emits the all-day UNTIL the user picked', () => {
  it('takes the date as written from a floating local endDate', () => {
    // The picker's shape. UTC getters turned this into 20260101 west of UTC —
    // the series ran a day too long, on the server, for every client.
    expect(
      buildRRuleString(
        makeRule({ frequency: 'daily', isAllDay: true, endDate: '2025-12-31T23:59:59' })
      )
    ).toBe('FREQ=DAILY;UNTIL=20251231')
  })

  it('takes the date as written from a date-only endDate', () => {
    // buildMasterTruncation's all-day branch, and CalDAV all-day read-back.
    expect(
      buildRRuleString(makeRule({ frequency: 'daily', isAllDay: true, endDate: '2025-12-30' }))
    ).toBe('FREQ=DAILY;UNTIL=20251230')
  })

  it('uses the UTC day of a true instant', () => {
    // A trailing Z is a genuine instant, so its UTC day is the answer.
    expect(
      buildRRuleString(
        makeRule({ frequency: 'daily', isAllDay: true, endDate: '2025-12-31T00:00:00.000Z' })
      )
    ).toBe('FREQ=DAILY;UNTIL=20251231')
  })

  it('leaves the timed form as a UTC instant', () => {
    // Not all-day: RFC 5545 requires UNTIL be UTC on the wire. Unchanged.
    expect(
      buildRRuleString(makeRule({ frequency: 'daily', endDate: '2025-12-31T00:00:00.000Z' }))
    ).toBe('FREQ=DAILY;UNTIL=20251231T000000Z')
  })
})
