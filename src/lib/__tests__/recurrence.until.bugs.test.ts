import { describe, it, expect } from 'vitest'
import { buildRRuleString, describeRecurrence, normaliseAllDayUntil } from '../recurrence'
import { resolveRRuleString } from '../occurrenceExpansion'
import { makeEvent, makeRule } from './fixtures'

/**
 * Recurrence UNTIL, west of UTC.
 *
 * Two defects of the same family, found while pinning the suite's timezone
 * (see vite.config.ts). `rule.endDate` arrives in three shapes — floating date,
 * floating local wall clock, and true UTC instant — and both the description
 * and the all-day serializer used to treat them as one.
 *
 * The suite runs in two zones (see vite.config.ts). Cases that start from a
 * fixed *instant* have no single right answer — resolving an instant into the
 * viewer's own day is the whole fix — so they derive their expectation from
 * the ambient zone using Intl, which is an oracle independent of the code
 * under test. West of UTC that expectation differs from what the unfixed code
 * produced, which is where these bite; east it is an identity check.
 *
 * Everything else here is a fixed calendar day and holds in any zone.
 */

/** The instant's local calendar day as `yyyy-mm-dd`, computed via Intl. */
function localDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA').format(d)
}

/** The instant's local calendar day as rrule's `toText()` spells it. */
function localDayLongForm(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(d)
}

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
    // nothing covered it before. The unfixed code always said January 1.
    const instant = new Date('2026-01-01T04:59:59Z')
    const event = makeEvent({ rruleString: 'FREQ=DAILY;UNTIL=20260101T045959Z' })
    expect(describeRecurrence(event)).toBe(`Every day until ${localDayLongForm(instant)}`)
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
    const instant = new Date('2026-01-01T04:59:59Z')
    const event = makeEvent({ rruleString: 'FREQ=WEEKLY;UNTIL=20260101T045959Z;BYDAY=MO,WE' })
    expect(describeRecurrence(event)).toBe(
      `Every week on Monday, Wednesday until ${localDayLongForm(instant)}`
    )
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

describe('legacy all-day series with a timed UNTIL', () => {
  // What Calino itself wrote before EventModal started setting isAllDay on the
  // rule: an instant, on an all-day series, one day past the picked date west
  // of UTC. Those are still on servers and in local storage, so the string is
  // repaired where it is used rather than migrated in place — a sync would
  // otherwise keep bringing it back.
  const LEGACY = 'FREQ=DAILY;UNTIL=20270101T045959Z'
  // The instant that string encodes, resolved into the viewer's own day —
  // Dec 31 west of UTC, Jan 1 east of it. Both are correct answers for their
  // zone; what matters is that the result is a floating date either way.
  const REPAIRED = `FREQ=DAILY;UNTIL=${localDay(new Date('2027-01-01T04:59:59Z')).replaceAll('-', '')}`

  it('repairs it for an all-day series', () => {
    expect(normaliseAllDayUntil(LEGACY, true)).toBe(REPAIRED)
    // Whichever day it lands on, it must be a floating date, not an instant.
    expect(REPAIRED).toMatch(/UNTIL=\d{8}$/)
  })

  it('leaves a timed series alone', () => {
    // Here UNTIL genuinely is an instant and must stay one.
    expect(normaliseAllDayUntil(LEGACY, false)).toBe(LEGACY)
    expect(normaliseAllDayUntil(LEGACY, undefined)).toBe(LEGACY)
  })

  it('leaves an already-conformant all-day rule alone', () => {
    expect(normaliseAllDayUntil('FREQ=DAILY;UNTIL=20261231', true)).toBe('FREQ=DAILY;UNTIL=20261231')
  })

  it('stops expansion drawing the extra day', () => {
    // resolveRRuleString feeds the grid. Before the repair this returned the
    // instant, which rrule expands through 2027-01-01.
    const event = makeEvent({ isAllDay: true, rruleString: LEGACY })
    expect(resolveRRuleString(event)).toBe(REPAIRED)
  })
})
