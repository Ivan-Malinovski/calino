import { describe, it, expect } from 'vitest'
import ICAL from 'ical.js'
import { patchICALData } from '../icalPatch'
import { parseICALData } from '../iCalendarAdapter'
import type { CalendarEvent } from '@/types'

/**
 * The regression gate for iCalendar fidelity.
 *
 * Calino models a subset of RFC 5545 and used to rebuild every resource from
 * that subset on save, so a single drag destroyed whatever another client had
 * written. These tests pin the properties that must survive a round trip; add a
 * row to UNMODELLED whenever the app learns to preserve something new.
 */

const RICH = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Other Client//Their Product//EN',
  'CALSCALE:GREGORIAN',
  'X-WR-CALNAME:Shared Team Calendar',
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Berlin',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'UID:rich-event',
  'DTSTAMP:20260101T120000Z',
  'DTSTART:20260310T100000Z',
  'DTEND:20260310T120000Z',
  'SUMMARY:Original title',
  'DESCRIPTION;ALTREP="cid:body.html":Original body',
  'GEO:52.52;13.405',
  'CLASS:CONFIDENTIAL',
  'PRIORITY:2',
  'RESOURCES:Projector,Whiteboard',
  'COMMENT:A comment nobody should lose',
  'CONTACT:Jane Doe',
  'RELATED-TO;RELTYPE=PARENT:parent-uid-99',
  'RDATE:20260315T100000Z',
  'ORGANIZER;CN=Boss;SENT-BY="mailto:asst@example.com":mailto:boss@example.com',
  'ATTENDEE;CN=Alice;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CUTYPE=INDIVIDUAL;DIR="ldap://x";MEMBER="mailto:team@example.com":mailto:alice@example.com',
  'X-ALT-DESC;FMTTYPE=text/html:<html>rich body</html>',
  'X-MOZ-LASTACK:20260101T120000Z',
  'X-CUSTOM-FLAG:keepme',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

/** Properties Calino has no field for. None may change when it saves. */
const UNMODELLED = [
  'geo',
  'class',
  'priority',
  'resources',
  'comment',
  'contact',
  'related-to',
  'rdate',
  'x-alt-desc',
  'x-moz-lastack',
  'x-custom-flag',
]

function vevents(ics: string): ICAL.Component[] {
  return new ICAL.Component(ICAL.parse(ics)).getAllSubcomponents('vevent')
}

function propMap(comp: ICAL.Component): Map<string, string> {
  return new Map(comp.getAllProperties().map((p) => [p.name, p.toICALString()] as const))
}

describe('patchICALData — fidelity', () => {
  const parsed = () => parseICALData(RICH, 'cal-1')

  it('preserves every unmodelled property byte-for-byte through an edit', () => {
    const [event] = parsed()
    const out = patchICALData(RICH, [{ ...event, title: 'Renamed' }])
    expect(out).toBeTruthy()

    const before = propMap(vevents(RICH)[0])
    const after = propMap(vevents(out!)[0])

    for (const name of UNMODELLED) {
      expect(after.get(name), `${name} was dropped`).toBeTruthy()
      expect(after.get(name), `${name} was rewritten`).toBe(before.get(name))
    }
    // The property set may only grow, never shrink.
    for (const name of before.keys()) {
      expect(after.has(name), `${name} disappeared`).toBe(true)
    }
    expect(after.get('summary')).toContain('Renamed')
  })

  it('keeps parameters on properties it does rewrite', () => {
    const [event] = parsed()
    const out = patchICALData(RICH, [{ ...event, description: 'New body' }])!
    const desc = vevents(out)[0].getFirstProperty('description')!

    expect(desc.getFirstValue()).toBe('New body')
    expect(desc.getParameter('altrep')).toBe('cid:body.html')
  })

  it('preserves attendee and organizer parameters Calino does not model', () => {
    const [event] = parsed()
    const out = patchICALData(RICH, [{ ...event, title: 'Renamed' }])!
    const vevent = vevents(out)[0]

    const attendee = vevent.getFirstProperty('attendee')!
    expect(attendee.getParameter('cutype')).toBe('INDIVIDUAL')
    expect(attendee.getParameter('member')).toBe('mailto:team@example.com')
    expect(attendee.getParameter('dir')).toBe('ldap://x')
    expect(vevent.getFirstProperty('organizer')!.getParameter('sent-by')).toBe(
      'mailto:asst@example.com'
    )
  })

  it('leaves the document around the event alone', () => {
    const [event] = parsed()
    const out = patchICALData(RICH, [{ ...event, title: 'Renamed' }])!
    const root = new ICAL.Component(ICAL.parse(out))

    // The origin server's PRODID must not be replaced with Calino's.
    expect(root.getFirstPropertyValue('prodid')).toBe('-//Other Client//Their Product//EN')
    expect(root.getFirstPropertyValue('x-wr-calname')).toBe('Shared Team Calendar')
    expect(root.getAllSubcomponents('vtimezone')).toHaveLength(1)
    expect(root.getFirstSubcomponent('vtimezone')!.getFirstPropertyValue('tzid')).toBe(
      'Europe/Berlin'
    )
  })
})

describe('patchICALData — recurrence groups', () => {
  const SERIES = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Other Client//EN',
    'BEGIN:VEVENT',
    'UID:series-1',
    'DTSTAMP:20260101T120000Z',
    'DTSTART:20260310T100000Z',
    'DTEND:20260310T110000Z',
    'SUMMARY:Standup',
    'RRULE:FREQ=DAILY;COUNT=5',
    'X-MASTER-MARK:master',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:series-1',
    'RECURRENCE-ID:20260312T100000Z',
    'DTSTAMP:20260101T120000Z',
    'DTSTART:20260312T140000Z',
    'DTEND:20260312T150000Z',
    'SUMMARY:Standup (moved)',
    'X-OVERRIDE-MARK:override',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')

  function byRecurrenceId(ics: string) {
    const map = new Map<string, ICAL.Component>()
    for (const comp of vevents(ics)) {
      map.set((comp.getFirstProperty('recurrence-id')?.toICALString() ?? 'master') as string, comp)
    }
    return map
  }

  it('edits one override without losing anything from the master', () => {
    const events = parseICALData(SERIES, 'cal-1')
    expect(events).toHaveLength(2)

    const out = patchICALData(
      SERIES,
      events.map((e) => (e.recurrenceId ? { ...e, title: 'Renamed override' } : e))
    )!
    const after = byRecurrenceId(out)
    expect(after.size).toBe(2)

    // Byte-identity is deliberately NOT asserted: every component handed to the
    // patcher is rewritten, which refreshes DTSTAMP/LAST-MODIFIED. What must
    // hold is that no *data* moves — the master keeps its rule and its
    // unmodelled properties.
    const master = after.get('master')!
    expect(master.getFirstPropertyValue('summary')).toBe('Standup')
    expect(master.getFirstPropertyValue('x-master-mark')).toBe('master')
    expect(master.getFirstProperty('rrule')!.toICALString()).toBe('RRULE:FREQ=DAILY;COUNT=5')

    const patchedOverride = [...after.entries()].find(([k]) => k !== 'master')![1]
    expect(patchedOverride.getFirstPropertyValue('summary')).toBe('Renamed override')
    expect(patchedOverride.getFirstPropertyValue('x-override-mark')).toBe('override')
  })

  it('removes an override the user deleted', () => {
    const events = parseICALData(SERIES, 'cal-1')
    const master = events.find((e) => !e.recurrenceId)!

    const out = patchICALData(SERIES, [master])!

    expect(vevents(out)).toHaveLength(1)
    expect(vevents(out)[0].getFirstProperty('recurrence-id')).toBeFalsy()
  })

  it('does not delete a component belonging to somebody else', () => {
    const withForeign = SERIES.replace(
      'END:VCALENDAR',
      ['BEGIN:VEVENT', 'UID:not-ours', 'DTSTART:20260401T090000Z', 'END:VEVENT', 'END:VCALENDAR'].join(
        '\r\n'
      )
    )
    const events = parseICALData(withForeign, 'cal-1').filter((e) => e.uid === 'series-1')

    const out = patchICALData(withForeign, events)!

    expect(vevents(out).some((c) => c.getFirstPropertyValue('uid') === 'not-ours')).toBe(true)
  })
})

describe('patchICALData — failure paths fall back', () => {
  const event: CalendarEvent = {
    id: 'e1',
    calendarId: 'cal-1',
    title: 'x',
    start: '2026-03-10T10:00:00Z',
    end: '2026-03-10T11:00:00Z',
    isAllDay: false,
  }

  it('returns null for malformed iCalendar', () => {
    expect(patchICALData('NOT ICALENDAR AT ALL', [event])).toBeNull()
  })

  it('returns null for an empty original', () => {
    expect(patchICALData('', [event])).toBeNull()
  })

  it('returns null when the root is not a VCALENDAR', () => {
    const vcard = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Someone', 'END:VCARD'].join('\r\n')
    expect(patchICALData(vcard, [event])).toBeNull()
  })
})
