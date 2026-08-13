import { describe, it, expect } from 'vitest'
import ICAL from 'ical.js'
import {
  icalEventToCalendarEvent,
  calendarEventToIcalComponent,
  calendarEventToIcalVjournal,
  icalVjournalToCalendarEvent,
} from '../icalTypeMapping'
import type { CalendarEvent } from '@/types'

// ---------------------------------------------------------------------------
// Helper: create a VEVENT ICAL.Component from raw iCal string
// ---------------------------------------------------------------------------
function createVevent(iCalStr: string): ICAL.Component {
  const jCal = ICAL.parse(iCalStr)
  const comp = new ICAL.Component(jCal)
  const vevents = comp.getAllSubcomponents('vevent')
  if (vevents.length === 0) throw new Error('No VEVENT found in iCal string')
  return vevents[0]
}

// ---------------------------------------------------------------------------
// Bug 25: Floating time timezone flip
// ---------------------------------------------------------------------------
describe('Bug 25: Floating time timezone flip', () => {
  it('preserves floating datetime values without timezone conversion', () => {
    // A floating time (no Z, no TZID) should be preserved as-is
    const iCalStr = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:floating-test-1',
      'SUMMARY:Floating Event',
      'DTSTART:20250615T140000',
      'DTEND:20250615T150000',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const vevent = createVevent(iCalStr)
    const event = icalEventToCalendarEvent(vevent, 'cal-1')

    // The date string should preserve the original values, not be shifted
    expect(event.start).toBe('2025-06-15T14:00:00')
    expect(event.end).toBe('2025-06-15T15:00:00')
    expect(event.isAllDay).toBe(false)
  })

  it('preserves UTC datetimes with Z suffix', () => {
    const iCalStr = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:utc-test-1',
      'SUMMARY:UTC Event',
      'DTSTART:20250615T140000Z',
      'DTEND:20250615T150000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const vevent = createVevent(iCalStr)
    const event = icalEventToCalendarEvent(vevent, 'cal-1')

    // UTC times go through toJSDate().toISOString() which adds .000
    expect(event.start).toContain('2025-06-15T14:00:00')
    expect(event.start).toContain('Z')
    expect(event.end).toContain('2025-06-15T15:00:00')
    expect(event.end).toContain('Z')
  })

  it('preserves floating times at midnight', () => {
    const iCalStr = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:floating-midnight',
      'SUMMARY:Midnight Event',
      'DTSTART:20250101T000000',
      'DTEND:20250101T010000',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const vevent = createVevent(iCalStr)
    const event = icalEventToCalendarEvent(vevent, 'cal-1')

    expect(event.start).toBe('2025-01-01T00:00:00')
    expect(event.end).toBe('2025-01-01T01:00:00')
  })

  it('preserves floating times with seconds', () => {
    const iCalStr = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:floating-seconds',
      'SUMMARY:Seconds Event',
      'DTSTART:20250615T143045',
      'DTEND:20250615T153045',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const vevent = createVevent(iCalStr)
    const event = icalEventToCalendarEvent(vevent, 'cal-1')

    expect(event.start).toBe('2025-06-15T14:30:45')
    expect(event.end).toBe('2025-06-15T15:30:45')
  })

  it('does not shift floating times across timezone boundaries', () => {
    // Even if the system timezone is UTC, a floating time at 23:00
    // should NOT become 00:00 the next day
    const iCalStr = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:floating-boundary',
      'SUMMARY:Boundary Event',
      'DTSTART:20251231T230000',
      'DTEND:20260101T010000',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const vevent = createVevent(iCalStr)
    const event = icalEventToCalendarEvent(vevent, 'cal-1')

    expect(event.start).toBe('2025-12-31T23:00:00')
    expect(event.end).toBe('2026-01-01T01:00:00')
  })
})

// ---------------------------------------------------------------------------
// Bug 26: Absolute reminder trigger uses Date.now()
// ---------------------------------------------------------------------------
describe('Bug 26: Absolute reminder trigger uses DTSTART, not Date.now()', () => {
  it('calculates reminder minutes from DTSTART, not current time', () => {
    // Create an event with an absolute TRIGGER (ICAL.Time) that fires
    // 30 minutes BEFORE the event starts.
    // DTSTART: 2025-06-15T14:00:00Z
    // TRIGGER: 2025-06-15T13:30:00Z  (30 min before start)
    // Note: ical.js requires TRIGGER;VALUE=DATE-TIME for absolute triggers
    const iCalStr = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:absolute-trigger-test',
      'SUMMARY:Reminder Test',
      'DTSTART:20250615T140000Z',
      'DTEND:20250615T150000Z',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER;VALUE=DATE-TIME:20250615T133000Z',
      'DESCRIPTION:Reminder',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const vevent = createVevent(iCalStr)
    const event = icalEventToCalendarEvent(vevent, 'cal-1')

    expect(event.reminders).toBeDefined()
    expect(event.reminders!.length).toBe(1)
    // Should be 30 minutes before start
    expect(event.reminders![0].minutesBefore).toBe(30)
  })

  it('calculates reminder minutes correctly when trigger is 15 min before', () => {
    const iCalStr = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:absolute-trigger-15',
      'SUMMARY:15min Reminder',
      'DTSTART:20250615T140000Z',
      'DTEND:20250615T150000Z',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER;VALUE=DATE-TIME:20250615T134500Z',
      'DESCRIPTION:Reminder',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const vevent = createVevent(iCalStr)
    const event = icalEventToCalendarEvent(vevent, 'cal-1')

    expect(event.reminders).toBeDefined()
    expect(event.reminders![0].minutesBefore).toBe(15)
  })

  it('still parses string-based duration triggers correctly', () => {
    const iCalStr = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:duration-trigger',
      'SUMMARY:Duration Trigger',
      'DTSTART:20250615T140000Z',
      'DTEND:20250615T150000Z',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:-PT30M',
      'DESCRIPTION:Reminder',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const vevent = createVevent(iCalStr)
    const event = icalEventToCalendarEvent(vevent, 'cal-1')

    expect(event.reminders).toBeDefined()
    expect(event.reminders![0].minutesBefore).toBe(30)
  })

  it('handles absolute trigger that fires after event start gracefully', () => {
    // Trigger 30 min AFTER the event start (unusual but possible)
    const iCalStr = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:absolute-trigger-after',
      'SUMMARY:After Start',
      'DTSTART:20250615T140000Z',
      'DTEND:20250615T150000Z',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER;VALUE=DATE-TIME:20250615T143000Z',
      'DESCRIPTION:Reminder',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const vevent = createVevent(iCalStr)
    const event = icalEventToCalendarEvent(vevent, 'cal-1')

    expect(event.reminders).toBeDefined()
    // Math.abs makes it positive: 30 minutes
    expect(event.reminders![0].minutesBefore).toBe(30)
  })
})

// ---------------------------------------------------------------------------
// Bug 27: All-day DTEND rollover broken for December/January
// ---------------------------------------------------------------------------
describe('Bug 27: All-day DTEND rollover', () => {
  it('rolls over from December 31 to January 1 of next year', () => {
    const event: CalendarEvent = {
      id: 'dec31-test',
      calendarId: 'cal-1',
      title: 'Year End',
      start: '2025-12-31',
      end: '2025-12-31',
      isAllDay: true,
    }

    const vevent = calendarEventToIcalComponent(event)
    const dtendProp = vevent.getFirstProperty('dtend')
    const dtendValue = dtendProp?.getFirstValue()

    expect(dtendValue).toBeInstanceOf(ICAL.Time)
    if (dtendValue instanceof ICAL.Time) {
      // DTEND should be 2026-01-01 (exclusive end per iCal spec)
      expect(dtendValue.year).toBe(2026)
      expect(dtendValue.month).toBe(1)
      expect(dtendValue.day).toBe(1)
    }
  })

  it('rolls over from January 31 to February 1', () => {
    const event: CalendarEvent = {
      id: 'jan31-test',
      calendarId: 'cal-1',
      title: 'Jan End',
      start: '2025-01-31',
      end: '2025-01-31',
      isAllDay: true,
    }

    const vevent = calendarEventToIcalComponent(event)
    const dtendProp = vevent.getFirstProperty('dtend')
    const dtendValue = dtendProp?.getFirstValue()

    expect(dtendValue).toBeInstanceOf(ICAL.Time)
    if (dtendValue instanceof ICAL.Time) {
      expect(dtendValue.year).toBe(2025)
      expect(dtendValue.month).toBe(2)
      expect(dtendValue.day).toBe(1)
    }
  })

  it('rolls over from February 28 to March 1 in non-leap year', () => {
    const event: CalendarEvent = {
      id: 'feb28-test',
      calendarId: 'cal-1',
      title: 'Feb End',
      start: '2025-02-28',
      end: '2025-02-28',
      isAllDay: true,
    }

    const vevent = calendarEventToIcalComponent(event)
    const dtendProp = vevent.getFirstProperty('dtend')
    const dtendValue = dtendProp?.getFirstValue()

    expect(dtendValue).toBeInstanceOf(ICAL.Time)
    if (dtendValue instanceof ICAL.Time) {
      expect(dtendValue.year).toBe(2025)
      expect(dtendValue.month).toBe(3)
      expect(dtendValue.day).toBe(1)
    }
  })

  it('rolls over from February 29 to March 1 in leap year', () => {
    const event: CalendarEvent = {
      id: 'feb29-test',
      calendarId: 'cal-1',
      title: 'Leap Day',
      start: '2024-02-29',
      end: '2024-02-29',
      isAllDay: true,
    }

    const vevent = calendarEventToIcalComponent(event)
    const dtendProp = vevent.getFirstProperty('dtend')
    const dtendValue = dtendProp?.getFirstValue()

    expect(dtendValue).toBeInstanceOf(ICAL.Time)
    if (dtendValue instanceof ICAL.Time) {
      expect(dtendValue.year).toBe(2024)
      expect(dtendValue.month).toBe(3)
      expect(dtendValue.day).toBe(1)
    }
  })

  it('rolls over from February 28 to February 29 in leap year', () => {
    const event: CalendarEvent = {
      id: 'feb28-leap',
      calendarId: 'cal-1',
      title: 'Feb 28 in Leap Year',
      start: '2024-02-28',
      end: '2024-02-28',
      isAllDay: true,
    }

    const vevent = calendarEventToIcalComponent(event)
    const dtendProp = vevent.getFirstProperty('dtend')
    const dtendValue = dtendProp?.getFirstValue()

    expect(dtendValue).toBeInstanceOf(ICAL.Time)
    if (dtendValue instanceof ICAL.Time) {
      expect(dtendValue.year).toBe(2024)
      expect(dtendValue.month).toBe(2)
      expect(dtendValue.day).toBe(29)
    }
  })

  it('rolls over from March 31 to April 1', () => {
    const event: CalendarEvent = {
      id: 'mar31-test',
      calendarId: 'cal-1',
      title: 'Mar End',
      start: '2025-03-31',
      end: '2025-03-31',
      isAllDay: true,
    }

    const vevent = calendarEventToIcalComponent(event)
    const dtendProp = vevent.getFirstProperty('dtend')
    const dtendValue = dtendProp?.getFirstValue()

    expect(dtendValue).toBeInstanceOf(ICAL.Time)
    if (dtendValue instanceof ICAL.Time) {
      expect(dtendValue.year).toBe(2025)
      expect(dtendValue.month).toBe(4)
      expect(dtendValue.day).toBe(1)
    }
  })

  it('handles month with 30 days correctly (April 30)', () => {
    const event: CalendarEvent = {
      id: 'apr30-test',
      calendarId: 'cal-1',
      title: 'Apr End',
      start: '2025-04-30',
      end: '2025-04-30',
      isAllDay: true,
    }

    const vevent = calendarEventToIcalComponent(event)
    const dtendProp = vevent.getFirstProperty('dtend')
    const dtendValue = dtendProp?.getFirstValue()

    expect(dtendValue).toBeInstanceOf(ICAL.Time)
    if (dtendValue instanceof ICAL.Time) {
      expect(dtendValue.year).toBe(2025)
      expect(dtendValue.month).toBe(5)
      expect(dtendValue.day).toBe(1)
    }
  })
})

// ---------------------------------------------------------------------------
// Group B: rrule round-trip for BYMONTHDAY, BYMONTH, BYSETPOS, positional BYDAY
// ---------------------------------------------------------------------------
describe('rrule round-trip for new BY* parts', () => {
  it('parses BYMONTHDAY', () => {
    const iCalStr = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:bymonthday-test',
      'SUMMARY:Month day test',
      'DTSTART:20250315T100000Z',
      'DTEND:20250315T110000Z',
      'RRULE:FREQ=MONTHLY;BYMONTHDAY=15',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const event = icalEventToCalendarEvent(createVevent(iCalStr), 'cal-1')
    expect(event.recurrence?.byMonthDay).toEqual([15])
  })

  it('parses BYMONTH', () => {
    const iCalStr = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:bymonth-test',
      'SUMMARY:Yearly in March',
      'DTSTART:20250315T100000Z',
      'DTEND:20250315T110000Z',
      'RRULE:FREQ=YEARLY;BYMONTH=3',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const event = icalEventToCalendarEvent(createVevent(iCalStr), 'cal-1')
    expect(event.recurrence?.byMonth).toEqual([3])
  })

  it('parses BYDAY with positional prefix into byWeekday+byDayOrdinals (not bySetPos)', () => {
    // R2.4 — Per-BYDAY ordinals now live in byDayOrdinals, NOT bySetPos.
    // bySetPos is reserved for the standalone BYSETPOS rule part.
    const iCalStr = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:second-tue',
      'SUMMARY:Second Tuesday',
      'DTSTART:20250311T100000Z',
      'DTEND:20250311T110000Z',
      'RRULE:FREQ=MONTHLY;BYDAY=2TU',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const event = icalEventToCalendarEvent(createVevent(iCalStr), 'cal-1')
    expect(event.recurrence?.byWeekday).toEqual([2])
    expect(event.recurrence?.byDayOrdinals).toEqual([2])
    expect(event.recurrence?.bySetPos).toBeUndefined()
  })

  it('does not emit fake bySetPos=0 for plain BYDAY', () => {
    const iCalStr = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:plain-monday',
      'SUMMARY:Every Monday',
      'DTSTART:20250303T100000Z',
      'DTEND:20250303T110000Z',
      'RRULE:FREQ=WEEKLY;BYDAY=MO',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const event = icalEventToCalendarEvent(createVevent(iCalStr), 'cal-1')
    expect(event.recurrence?.byWeekday).toEqual([1])
    expect(event.recurrence?.bySetPos).toBeUndefined()
  })

  it('parses standalone BYSETPOS', () => {
    const iCalStr = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:setpos-standalone',
      'SUMMARY:Last weekday',
      'DTSTART:20250331T100000Z',
      'DTEND:20250331T110000Z',
      'RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const event = icalEventToCalendarEvent(createVevent(iCalStr), 'cal-1')
    expect(event.recurrence?.bySetPos).toEqual([-1])
  })

  it('serializes byMonthDay to BYMONTHDAY', () => {
    const event: CalendarEvent = {
      id: 'serial-bymonthday',
      calendarId: 'cal-1',
      title: '15th of the month',
      start: '2025-03-15T10:00:00Z',
      end: '2025-03-15T11:00:00Z',
      isAllDay: false,
      recurrence: { frequency: 'monthly', interval: 1, byMonthDay: [15] },
    }
    const vevent = calendarEventToIcalComponent(event)
    const rrule = vevent.getFirstProperty('rrule')?.getFirstValue() as ICAL.Recur
    expect(rrule).toBeDefined()
    expect(rrule.getComponent('BYMONTHDAY')).toEqual([15])
  })

  it('serializes byMonth to BYMONTH', () => {
    const event: CalendarEvent = {
      id: 'serial-bymonth',
      calendarId: 'cal-1',
      title: 'Every March',
      start: '2025-03-15T10:00:00Z',
      end: '2025-03-15T11:00:00Z',
      isAllDay: false,
      recurrence: { frequency: 'yearly', interval: 1, byMonth: [3] },
    }
    const vevent = calendarEventToIcalComponent(event)
    const rrule = vevent.getFirstProperty('rrule')?.getFirstValue() as ICAL.Recur
    expect(rrule.getComponent('BYMONTH')).toEqual([3])
  })
})

// ---------------------------------------------------------------------------
// Issue 84: birthday/anniversary contact marker must survive CalDAV round-trip
// ---------------------------------------------------------------------------
describe('Issue 84: VEVENT URL round-trip', () => {
  it('parses URL off a VEVENT', () => {
    const iCalStr = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:birthday-1',
      'SUMMARY:Birthday',
      'DTSTART;VALUE=DATE:20250615',
      'DTEND;VALUE=DATE:20250616',
      'URL:calino:contact:abc-123',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const event = icalEventToCalendarEvent(createVevent(iCalStr), 'cal-1')
    expect(event.url).toBe('calino:contact:abc-123')
  })

  it('serializes URL onto a VEVENT', () => {
    const event: CalendarEvent = {
      id: 'birthday-2',
      calendarId: 'cal-1',
      title: "Ada's birthday",
      start: '2025-06-15T00:00:00',
      end: '2025-06-15T00:00:00',
      isAllDay: true,
      url: 'calino:contact:abc-123',
    }
    const vevent = calendarEventToIcalComponent(event)
    expect(vevent.getFirstProperty('url')?.getFirstValue()).toBe('calino:contact:abc-123')
  })

  it('omits URL when the event has none', () => {
    const event: CalendarEvent = {
      id: 'plain-1',
      calendarId: 'cal-1',
      title: 'Plain',
      start: '2025-06-15T10:00:00Z',
      end: '2025-06-15T11:00:00Z',
      isAllDay: false,
    }
    expect(calendarEventToIcalComponent(event).getFirstProperty('url')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// "At time of event" reminders (minutesBefore: 0)
// ---------------------------------------------------------------------------
describe('zero-minute reminder round-trip', () => {
  // Zero is a real reminder option ("At time of event"), not an absence. The
  // read path used to treat it as one and drop the alarm, so such a reminder
  // was written to the server, then silently disappeared on the next sync.
  const eventWithReminder = (minutesBefore: number): CalendarEvent => ({
    id: 'evt-0',
    calendarId: 'cal-1',
    title: 'Standup',
    start: '2025-06-15T14:00:00.000Z',
    end: '2025-06-15T15:00:00.000Z',
    isAllDay: false,
    reminders: [{ id: 'r1', minutesBefore, method: 'popup' }],
  })

  const parseTrigger = (trigger: string): CalendarEvent['reminders'] => {
    const iCalStr = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:zero-trigger',
      'SUMMARY:Standup',
      'DTSTART:20250615T140000Z',
      'DTEND:20250615T150000Z',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      trigger.startsWith('-P') || trigger.startsWith('P')
        ? `TRIGGER:${trigger}`
        : `TRIGGER;VALUE=DATE-TIME:${trigger}`,
      'DESCRIPTION:Reminder',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    return icalEventToCalendarEvent(createVevent(iCalStr), 'cal-1').reminders
  }

  it('parses -PT0M as a reminder at the time of the event', () => {
    const reminders = parseTrigger('-PT0M')
    expect(reminders).toHaveLength(1)
    expect(reminders![0].minutesBefore).toBe(0)
  })

  it('parses an absolute trigger equal to DTSTART as zero', () => {
    const reminders = parseTrigger('20250615T140000Z')
    expect(reminders).toHaveLength(1)
    expect(reminders![0].minutesBefore).toBe(0)
  })

  it('survives a full serialize → parse round-trip', () => {
    const comp = calendarEventToIcalComponent(eventWithReminder(0))
    const reparsed = icalEventToCalendarEvent(
      createVevent(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${comp.toString()}\r\nEND:VCALENDAR`),
      'cal-1'
    )
    expect(reparsed.reminders).toHaveLength(1)
    expect(reparsed.reminders![0].minutesBefore).toBe(0)
  })

  it('leaves non-zero reminders alone', () => {
    expect(parseTrigger('-PT15M')![0].minutesBefore).toBe(15)
  })
})

// ---------------------------------------------------------------------------
// Issue 116: journal DTSTART is a floating date
// ---------------------------------------------------------------------------
describe('Issue 116: VJOURNAL DTSTART is a floating date', () => {
  const entry: CalendarEvent = {
    id: 'journal-116',
    calendarId: 'cal-1',
    title: 'Debug Journal',
    start: '2026-08-12',
    end: '2026-08-12',
    isAllDay: true,
    type: 'journal',
  }

  it('writes entry.start verbatim, without a timezone shift', () => {
    // The serializer must not reinterpret the day. This pins the layer: #116 was
    // the *caller* passing a UTC-derived "today", so a future fix applied here
    // instead would be wrong and this test would catch it.
    const ics = new ICAL.Component(['vcalendar', [], []])
    ics.addSubcomponent(calendarEventToIcalVjournal(entry))

    expect(ics.toString()).toContain('DTSTART;VALUE=DATE:20260812')
  })

  it('round-trips the date back unchanged', () => {
    const vjournal = calendarEventToIcalVjournal(entry)
    const parsed = icalVjournalToCalendarEvent(vjournal, 'cal-1')

    expect(parsed.start).toBe('2026-08-12')
  })
})
