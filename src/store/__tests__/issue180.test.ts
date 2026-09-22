import { beforeEach, describe, expect, it } from 'vitest'
import { parseICALEvent, eventToICAL } from '@/features/caldav/adapter/iCalendarAdapter'
import { useCalendarStore } from '../calendarStore'

const ISSUE_180_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Calino//Calendar//EN
CALSCALE:GREGORIAN
BEGIN:VEVENT
UID:issue-180
DTSTART;TZID=W. Europe Standard Time:20250930T193000
DTEND;TZID=W. Europe Standard Time:20250930T213000
RRULE:FREQ=MONTHLY;BYDAY=-1TU;UNTIL=20270831T173000Z
SUMMARY:Another Test
END:VEVENT
BEGIN:VTIMEZONE
TZID:W. Europe Standard Time
BEGIN:STANDARD
DTSTART:16010101T030000
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:16010101T020000
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
END:DAYLIGHT
END:VTIMEZONE
END:VCALENDAR`

describe('issue 180: Outlook Windows-TZID recurrence', () => {
  beforeEach(() => {
    const store = useCalendarStore.getState()
    store.events.forEach((event) => store.deleteEvent(event.id))
  })

  it('preserves the source TZID while expanding every last Tuesday through UNTIL', () => {
    const [event] = parseICALEvent(ISSUE_180_ICS, 'default')
    expect(event.timezone).toBe('W. Europe Standard Time')
    expect(event.rruleString).toBe('FREQ=MONTHLY;BYDAY=-1TU;UNTIL=20270831T173000Z')
    expect(eventToICAL(event)).toContain('DTSTART;TZID=W. Europe Standard Time:20250930T193000')

    useCalendarStore.getState().addEvent(event)
    const occurrences = useCalendarStore
      .getState()
      .getEventsForDateRange('2025-09-30', '2027-09-30')
      .filter((candidate) => candidate.title === 'Another Test')

    expect(occurrences.some((candidate) => candidate.start === '2025-09-30T17:30:00.000Z')).toBe(
      true
    )
    expect(occurrences.some((candidate) => candidate.start === '2025-10-28T18:30:00.000Z')).toBe(
      true
    )
    expect(occurrences.some((candidate) => candidate.start === '2027-08-31T17:30:00.000Z')).toBe(
      true
    )
    expect(occurrences.some((candidate) => candidate.start.startsWith('2027-09'))).toBe(false)
  })
})
