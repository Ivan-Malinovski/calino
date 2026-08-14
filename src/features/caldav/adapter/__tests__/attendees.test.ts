import { describe, it, expect } from 'vitest'
import ICAL from 'ical.js'
import {
  parseAttendees,
  parseOrganizer,
  writeAttendees,
  calendarEventToIcalComponent,
} from '../icalTypeMapping'
import { parseICALData } from '../iCalendarAdapter'
import { buildVCalendar } from '@/lib/icsExport'
import type { CalendarEvent } from '@/types'

function component(veventBody: string): ICAL.Component {
  const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:x@example.com
DTSTART:20260310T090000Z
DTEND:20260310T100000Z
SUMMARY:Meeting
${veventBody}
END:VEVENT
END:VCALENDAR`
  const root = new ICAL.Component(ICAL.parse(ics) as unknown as never)
  return root.getFirstSubcomponent('vevent')!
}

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt-1',
    uid: 'evt-1',
    calendarId: 'cal-1',
    title: 'Meeting',
    start: '2026-03-10T09:00:00.000Z',
    end: '2026-03-10T10:00:00.000Z',
    isAllDay: false,
    ...overrides,
  }
}

describe('parseAttendees', () => {
  it('reads email, CN, ROLE, PARTSTAT and RSVP', () => {
    const vevent = component(
      'ATTENDEE;CN=Sam Rivers;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=TRUE:mailto:sam@example.com'
    )

    expect(parseAttendees(vevent)).toEqual([
      {
        email: 'sam@example.com',
        name: 'Sam Rivers',
        role: 'REQ-PARTICIPANT',
        partstat: 'ACCEPTED',
        rsvp: true,
      },
    ])
  })

  it('reads several attendees', () => {
    const vevent = component(
      'ATTENDEE:mailto:a@example.com\r\nATTENDEE:mailto:b@example.com'
    )
    expect(parseAttendees(vevent).map((a) => a.email)).toEqual(['a@example.com', 'b@example.com'])
  })

  it('leaves optional parameters undefined rather than inventing them', () => {
    const [attendee] = parseAttendees(component('ATTENDEE:mailto:plain@example.com'))

    expect(attendee).toEqual({
      email: 'plain@example.com',
      name: undefined,
      role: undefined,
      partstat: undefined,
      rsvp: undefined,
    })
  })

  it('reads RSVP=FALSE as false, not as absent', () => {
    const [attendee] = parseAttendees(component('ATTENDEE;RSVP=FALSE:mailto:a@example.com'))
    expect(attendee!.rsvp).toBe(false)
  })

  it('drops an unrecognized PARTSTAT instead of storing it', () => {
    const [attendee] = parseAttendees(component('ATTENDEE;PARTSTAT=WAT:mailto:a@example.com'))
    expect(attendee!.partstat).toBeUndefined()
  })

  it('returns an empty list when there are no ATTENDEE properties', () => {
    expect(parseAttendees(component('DESCRIPTION:nothing here'))).toEqual([])
  })
})

describe('parseOrganizer', () => {
  it('strips the mailto: scheme and reads CN', () => {
    const vevent = component('ORGANIZER;CN=Ivan:mailto:ivan@example.com')
    expect(parseOrganizer(vevent)).toEqual({ email: 'ivan@example.com', name: 'Ivan' })
  })

  it('is undefined when absent', () => {
    expect(parseOrganizer(component('DESCRIPTION:none'))).toBeUndefined()
  })
})

describe('writeAttendees', () => {
  it('emits ORGANIZER and ATTENDEE with their parameters', () => {
    const vevent = calendarEventToIcalComponent(
      makeEvent({
        organizer: { email: 'ivan@example.com', name: 'Ivan' },
        attendees: [
          { email: 'sam@example.com', name: 'Sam', role: 'REQ-PARTICIPANT', partstat: 'TENTATIVE', rsvp: true },
        ],
      })
    )
    // Unfold before asserting — RFC 5545 wraps at 75 octets, and this
    // ATTENDEE line is long enough to be split.
    const ics = vevent.toString().replace(/\r?\n[ \t]/g, '')

    expect(ics).toContain('ORGANIZER;CN=Ivan:mailto:ivan@example.com')
    expect(ics).toContain('mailto:sam@example.com')
    expect(ics).toContain('PARTSTAT=TENTATIVE')
    expect(ics).toContain('RSVP=TRUE')
  })

  it('does not double properties when a component is written twice', () => {
    const event = makeEvent({
      organizer: { email: 'ivan@example.com' },
      attendees: [{ email: 'sam@example.com' }],
    })
    const vevent = calendarEventToIcalComponent(event)
    writeAttendees(vevent, event)
    writeAttendees(vevent, event)

    expect(vevent.getAllProperties('attendee')).toHaveLength(1)
    expect(vevent.getAllProperties('organizer')).toHaveLength(1)
  })

  it('clears the properties when the event no longer has attendees', () => {
    const withPeople = makeEvent({
      organizer: { email: 'ivan@example.com' },
      attendees: [{ email: 'sam@example.com' }],
    })
    const vevent = calendarEventToIcalComponent(withPeople)
    writeAttendees(vevent, makeEvent())

    expect(vevent.getAllProperties('attendee')).toHaveLength(0)
    expect(vevent.getAllProperties('organizer')).toHaveLength(0)
  })

  it('skips an attendee with no email', () => {
    const vevent = calendarEventToIcalComponent(
      makeEvent({ attendees: [{ email: '' }, { email: 'ok@example.com' }] })
    )
    expect(vevent.getAllProperties('attendee')).toHaveLength(1)
  })
})

describe('attendee round-trip', () => {
  it('survives serialize → parse unchanged', () => {
    const original = makeEvent({
      organizer: { email: 'ivan@example.com', name: 'Ivan' },
      attendees: [
        { email: 'sam@example.com', name: 'Sam', role: 'REQ-PARTICIPANT', partstat: 'ACCEPTED', rsvp: true },
        { email: 'lee@example.com', role: 'OPT-PARTICIPANT', partstat: 'NEEDS-ACTION', rsvp: false },
      ],
    })

    const parsed = parseICALData(buildVCalendar([original]), 'cal-1')[0]!

    expect(parsed.organizer).toEqual(original.organizer)
    expect(parsed.attendees).toEqual(original.attendees)
  })

  it('leaves attendees undefined, not empty, on an event with none', () => {
    const parsed = parseICALData(buildVCalendar([makeEvent()]), 'cal-1')[0]!

    expect(parsed.attendees).toBeUndefined()
    expect(parsed.organizer).toBeUndefined()
  })
})
