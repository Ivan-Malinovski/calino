import { describe, it, expect } from 'vitest'
import { parseICALData, eventToICAL } from '../iCalendarAdapter'

/**
 * Phase 0 verification suite.
 *
 * These tests pin down CURRENT, KNOWN-WRONG behaviour of the iCalendar
 * adapter so that a later fix has to flip each assertion deliberately.
 * Every case carries a comment naming the RFC 5545 behaviour that ought
 * to replace it.
 *
 * The suite runs in two projects, `west` (America/New_York) and `east`
 * (Europe/Copenhagen) — see vite.config.ts. A test file cannot pick its
 * own zone, so anything zone-dependent derives its expectation from the
 * ambient zone via an oracle independent of the code under test
 * (`new Date(...)` + `toISOString()`), never a hardcoded offset.
 */

const FLOATING_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Calino Phase 0//EN',
  'CALSCALE:GREGORIAN',
  'BEGIN:VEVENT',
  'UID:floating-1',
  'DTSTAMP:20260101T000000Z',
  'DTSTART:20260102T100000',
  'DTEND:20260102T110000',
  'SUMMARY:Floating meeting',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

/**
 * The UTC instant the ambient zone assigns to a local wall clock, in
 * iCalendar basic format (`YYYYMMDDTHHMMSSZ`). This mirrors what
 * `ICAL.Time.fromJSDate(new Date(iso), true)` produces — deliberately,
 * because that is the bug being pinned. Derived, not hardcoded, so the
 * expectation is correct in both `west` and `east`.
 */
function localWallClockAsUtcStamp(localIso: string): string {
  return new Date(localIso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function dtstartLine(ics: string): string {
  return ics.split('\r\n').find((l) => l.startsWith('DTSTART')) ?? ''
}

function dtendLine(ics: string): string {
  return ics.split('\r\n').find((l) => l.startsWith('DTEND')) ?? ''
}

describe('Phase 0 verification: floating time round-trip (Bug A)', () => {
  it('parses a floating DTSTART without promoting it to an instant', () => {
    const [event] = parseICALData(FLOATING_ICS, 'cal-1')

    // This half is already correct: no Z, no offset, no zone shift.
    expect(event.start).toBe('2026-01-02T10:00:00')
    expect(event.end).toBe('2026-01-02T11:00:00')
    expect(event.isAllDay).toBe(false)
  })

  it('BUG: re-serializing a floating time emits a UTC instant shifted by the ambient offset', () => {
    const [event] = parseICALData(FLOATING_ICS, 'cal-1')
    const out = eventToICAL(event)

    // CORRECT per RFC 5545 §3.3.5 form 1: a floating time round-trips
    // unchanged as `DTSTART:20260102T100000` — no Z, no TZID. Instead
    // `createIcalDateTime` (icalTypeMapping.ts ~L427) falls through to
    // `ICAL.Time.fromJSDate(new Date(isoString), true)`, which reads the
    // string as LOCAL and then forces UTC output — so the emitted stamp
    // is the wall clock rebased through the browser's offset.
    //
    // west (America/New_York, -05:00 in January) -> DTSTART:20260102T150000Z
    // east (Europe/Copenhagen, +01:00 in January) -> DTSTART:20260102T090000Z
    expect(dtstartLine(out)).toBe(`DTSTART:${localWallClockAsUtcStamp('2026-01-02T10:00:00')}`)
    expect(dtendLine(out)).toBe(`DTEND:${localWallClockAsUtcStamp('2026-01-02T11:00:00')}`)

    // Stated negatively, so the intent survives the fix: the floating
    // form is gone and a Z-suffixed instant took its place.
    expect(out).not.toContain('DTSTART:20260102T100000\r\n')
    expect(dtstartLine(out)).toMatch(/Z$/)
  })

  it('BUG: a second round-trip shifts the wall clock away from the original', () => {
    const [first] = parseICALData(FLOATING_ICS, 'cal-1')
    const [second] = parseICALData(eventToICAL(first), 'cal-1')

    // CORRECT: parse -> serialize -> parse is the identity for a
    // floating time. Today the second pass comes back as a UTC instant
    // ('...Z'), i.e. the floating-ness is lost after one save.
    expect(second.start).not.toBe(first.start)
    expect(second.start).toMatch(/Z$/)
    // Note the re-parsed value also carries milliseconds ('...00.000Z'),
    // where the original floating value had none.
    expect(second.start).toBe(new Date('2026-01-02T10:00:00').toISOString())
  })
})

describe('Phase 0 verification: ICS import robustness (Bug B)', () => {
  it('BUG: two concatenated VCALENDAR blocks throw a TypeError instead of parsing', () => {
    const twoDocuments = [
      FLOATING_ICS,
      FLOATING_ICS.replace('UID:floating-1', 'UID:floating-2'),
    ].join('\r\n')

    // CORRECT: multi-document ICS (common in mail attachments and
    // exports) should yield 2 events. `ICAL.parse` returns an ARRAY of
    // jCal documents here, and `new ICAL.Component(jCal)`
    // (iCalendarAdapter.ts L26) mis-binds it, so `getAllSubcomponents`
    // dereferences undefined.
    //
    // Observed: TypeError "Cannot read properties of undefined (reading
    // 'length')" at Component.getAllSubcomponents (ical.js:8079).
    // It escapes parseICALEvent's try/catch, which only wraps ICAL.parse.
    expect(() => parseICALData(twoDocuments, 'cal-1')).toThrow(TypeError)
    expect(() => parseICALData(twoDocuments, 'cal-1')).toThrow(
      /Cannot read properties of undefined \(reading 'length'\)/
    )
  })

  it('BUG: a leading UTF-8 BOM silently yields 0 events', () => {
    const withBom = '﻿' + FLOATING_ICS

    // CORRECT: a BOM is a legal artefact of a UTF-8 export and should be
    // stripped before parsing, yielding 1 event. Today ICAL.parse throws,
    // parseICALEvent swallows it with console.error and returns [].
    expect(parseICALData(withBom, 'cal-1')).toHaveLength(0)
  })

  it('BUG: a truncated file (missing END:VEVENT) silently yields 0 events', () => {
    const truncated = FLOATING_ICS.replace('END:VEVENT\r\n', '')

    // CORRECT: either recover the complete VEVENTs that precede the
    // truncation, or surface a real error to the user. Today ICAL.parse
    // throws ParserError "invalid ical body. component began but did not
    // end", which is swallowed into an empty, indistinguishable result.
    expect(parseICALData(truncated, 'cal-1')).toHaveLength(0)
  })

  it('BUG: one unparseable DTSTART drops that VEVENT with only a console.error', () => {
    const mixed = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Calino Phase 0//EN',
      'BEGIN:VEVENT',
      'UID:good-1',
      'DTSTAMP:20260101T000000Z',
      'DTSTART:20260102T100000Z',
      'DTEND:20260102T110000Z',
      'SUMMARY:Good',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:bad-1',
      'DTSTAMP:20260101T000000Z',
      'DTSTART:notadate',
      'SUMMARY:Bad',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const events = parseICALData(mixed, 'cal-1')

    // CORRECT: the caller should learn that 1 of 2 events was rejected
    // (a skipped/failed count surfaced to the import UI). Today the good
    // event survives and the bad one vanishes silently — the only trace
    // is `console.error('Failed to parse vevent:', ...)` with
    // Error: invalid date-time value: "nota-da-teT::"
    // (icalTypeMapping.ts L547, via Event.startDate).
    expect(events).toHaveLength(1)
    expect(events[0].uid).toBe('good-1')
    expect(events.some((e) => e.uid === 'bad-1')).toBe(false)
  })
})
