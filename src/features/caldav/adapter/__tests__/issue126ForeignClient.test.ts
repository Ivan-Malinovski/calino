import { describe, it, expect } from 'vitest'
import ICAL from 'ical.js'
import { eventToICAL } from '../iCalendarAdapter'
import type { CalendarEvent } from '@/types'

/**
 * Issue #126, seen from outside Calino.
 *
 * The read-side fix keeps a locally-created timed series on the user's own
 * weekdays *in our UI*. What makes it a real fix rather than a local illusion
 * is the write side: the item has to leave Calino carrying the zone, or every
 * other CalDAV client keeps expanding its RRULE on UTC weekdays and the
 * reporter still sees the shifted days in Thunderbird or on their phone.
 *
 * So these tests deliberately use no Calino code past the serializer: the ICS
 * is handed to stock ical.js and expanded the way a foreign client would.
 * Verified once against a live Radicale server — the bytes below are what it
 * stored and returned — and kept here as an offline regression guard.
 */

/** Expand an ICS the way a foreign client does: parse, register VTIMEZONEs, iterate. */
function foreignClientExpansion(ics: string, viewingZone: string, count: number): string[] {
  const vcal = new ICAL.Component(ICAL.parse(ics))
  for (const vtz of vcal.getAllSubcomponents('vtimezone')) {
    const zone = new ICAL.Timezone(vtz)
    if (!ICAL.TimezoneService.has(zone.tzid)) ICAL.TimezoneService.register(zone.tzid, zone)
  }
  const iterator = new ICAL.Event(vcal.getFirstSubcomponent('vevent')!).iterator()
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: viewingZone,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return Array.from({ length: count }, () => fmt.format(iterator.next().toJSDate()))
}

const series = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: 'workweek',
  uid: 'workweek',
  calendarId: 'cal1',
  title: 'Late standup',
  start: '2026-08-03T23:00:00',
  end: '2026-08-03T23:30:00',
  isAllDay: false,
  rruleString: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  recurrence: { frequency: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] },
  ...over,
})

describe('issue 126 — what a foreign CalDAV client sees', () => {
  it('exports a timed series with a TZID and a VTIMEZONE, not a bare UTC instant', () => {
    const ics = eventToICAL(series({ timezone: 'America/New_York' }))
    expect(ics).toContain('DTSTART;TZID=America/New_York:20260803T230000')
    expect(ics).toContain('BEGIN:VTIMEZONE')
    expect(ics).toContain('TZID:America/New_York')
  })

  it('keeps a 23:00 Mon–Fri series on Mon–Fri for a New York reader', () => {
    const ics = eventToICAL(series({ timezone: 'America/New_York' }))
    expect(foreignClientExpansion(ics, 'America/New_York', 5)).toEqual([
      'Mon 03 Aug, 23:00',
      'Tue 04 Aug, 23:00',
      'Wed 05 Aug, 23:00',
      'Thu 06 Aug, 23:00',
      'Fri 07 Aug, 23:00',
    ])
  })

  // The bug as the reporter met it, pinned so the old shape can't creep back:
  // the same series stored as the bare UTC instant it used to be. 23:00 in New
  // York is 03:00Z the next day, so BYDAY selects the UTC weekdays Tue–Sat and
  // the reader sees Mon–Thu plus a stray Sunday — Friday missing entirely.
  it('shifts the days when the same series is stored as a bare UTC instant', () => {
    const ics = eventToICAL(
      series({ start: '2026-08-04T03:00:00.000Z', end: '2026-08-04T03:30:00.000Z' })
    )
    expect(ics).toContain('DTSTART:20260804T030000Z')
    expect(foreignClientExpansion(ics, 'America/New_York', 5)).toEqual([
      'Mon 03 Aug, 23:00',
      'Tue 04 Aug, 23:00',
      'Wed 05 Aug, 23:00',
      'Thu 06 Aug, 23:00',
      'Sun 09 Aug, 23:00',
    ])
  })

  // The wall clock is what a TZID series promises, so the hour must survive the
  // October transition rather than sliding to 22:00 with the offset.
  it('holds 23:00 across the autumn DST transition', () => {
    const ics = eventToICAL(
      series({
        timezone: 'Europe/Copenhagen',
        // Fri 2026-10-23, three days before the last-Sunday-of-October change.
        start: '2026-10-23T23:00:00',
        end: '2026-10-23T23:30:00',
        rruleString: 'FREQ=WEEKLY;BYDAY=FR',
        recurrence: { frequency: 'weekly', interval: 1, byWeekday: [5] },
      })
    )
    expect(foreignClientExpansion(ics, 'Europe/Copenhagen', 3)).toEqual([
      'Fri 23 Oct, 23:00',
      'Fri 30 Oct, 23:00',
      'Fri 06 Nov, 23:00',
    ])
  })
})
