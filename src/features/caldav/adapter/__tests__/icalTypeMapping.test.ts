import { describe, it, expect } from 'vitest'
import ICAL from 'ical.js'
import {
  icalEventToCalendarEvent,
  calendarEventToIcalComponent,
  calendarEventToIcalVjournal,
  icalVjournalToCalendarEvent,
  icalVtodoToCalendarEvent,
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

// ---------------------------------------------------------------------------
// CATEGORIES is a multi-value property (RFC 5545 §3.8.1.2)
//
// `getFirstProperty('categories').getFirstValue()` returned only the first
// value of the first line, so `CATEGORIES:Work,Personal,Urgent` parsed as
// ['Work'] and the other two were destroyed on the next save.
// ---------------------------------------------------------------------------
describe('CATEGORIES multi-value parsing', () => {
  const CATS = 'CATEGORIES:Work,Personal,Urgent'

  function vtodoFrom(body: string): ICAL.Component {
    const comp = new ICAL.Component(ICAL.parse(body))
    return comp.getAllSubcomponents('vtodo')[0]
  }

  function vjournalFrom(body: string): ICAL.Component {
    const comp = new ICAL.Component(ICAL.parse(body))
    return comp.getAllSubcomponents('vjournal')[0]
  }

  it('reads every category from a VEVENT', () => {
    const vevent = createVevent(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:cat-event',
        'DTSTART:20260615T100000Z',
        'DTEND:20260615T110000Z',
        'SUMMARY:Categorised',
        CATS,
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')
    )

    expect(icalEventToCalendarEvent(vevent, 'cal-1').categories).toEqual([
      'Work',
      'Personal',
      'Urgent',
    ])
  })

  it('reads every category from a VTODO', () => {
    const vtodo = vtodoFrom(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VTODO',
        'UID:cat-task',
        'SUMMARY:Categorised task',
        CATS,
        'END:VTODO',
        'END:VCALENDAR',
      ].join('\r\n')
    )

    expect(icalVtodoToCalendarEvent(vtodo, 'cal-1').categories).toEqual([
      'Work',
      'Personal',
      'Urgent',
    ])
  })

  it('reads every category from a VJOURNAL', () => {
    const vjournal = vjournalFrom(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VJOURNAL',
        'UID:cat-journal',
        'DTSTART;VALUE=DATE:20260615',
        'SUMMARY:Categorised entry',
        CATS,
        'END:VJOURNAL',
        'END:VCALENDAR',
      ].join('\r\n')
    )

    expect(icalVjournalToCalendarEvent(vjournal, 'cal-1').categories).toEqual([
      'Work',
      'Personal',
      'Urgent',
    ])
  })

  it('merges multiple CATEGORIES lines, dedupes, and trims', () => {
    const vevent = createVevent(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:cat-multi',
        'DTSTART:20260615T100000Z',
        'DTEND:20260615T110000Z',
        'CATEGORIES:Work, Personal',
        'CATEGORIES:Urgent,Work',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')
    )

    // First-seen order preserved; the repeated 'Work' collapses to one tag.
    expect(icalEventToCalendarEvent(vevent, 'cal-1').categories).toEqual([
      'Work',
      'Personal',
      'Urgent',
    ])
  })

  it('yields no categories when the property is absent', () => {
    const vevent = createVevent(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:cat-none',
        'DTSTART:20260615T100000Z',
        'DTEND:20260615T110000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')
    )

    expect(icalEventToCalendarEvent(vevent, 'cal-1').categories).toBeUndefined()
  })

  it('round-trips every category back out on save', () => {
    const vevent = createVevent(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:cat-roundtrip',
        'DTSTART:20260615T100000Z',
        'DTEND:20260615T110000Z',
        CATS,
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')
    )

    const parsed = icalEventToCalendarEvent(vevent, 'cal-1')
    const out = calendarEventToIcalComponent(parsed).toString()

    expect(out).toContain('CATEGORIES:Work,Personal,Urgent')
  })
})

// ---------------------------------------------------------------------------
// Patch mode: calendarEventToIcalComponent(event, existing)
//
// Calino models a subset of RFC 5545. Rebuilding a VEVENT from scratch on every
// save destroyed everything outside that subset. Patching an existing component
// writes only what Calino owns and leaves the rest byte-identical.
// ---------------------------------------------------------------------------
describe('calendarEventToIcalComponent patch mode', () => {
  const RICH = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Other Client//EN',
    'BEGIN:VEVENT',
    'UID:rich-1',
    'DTSTAMP:20260101T120000Z',
    'DTSTART:20260310T100000Z',
    'DTEND:20260310T120000Z',
    'SUMMARY:Original title',
    'DESCRIPTION:Original body',
    'GEO:52.52;13.405',
    'CLASS:CONFIDENTIAL',
    'PRIORITY:2',
    'RESOURCES:Projector,Whiteboard',
    'COMMENT:A comment nobody should lose',
    'CONTACT:Jane Doe',
    'RELATED-TO;RELTYPE=PARENT:parent-uid-99',
    'X-ALT-DESC;FMTTYPE=text/html:<html>rich body</html>',
    'X-MOZ-LASTACK:20260101T120000Z',
    'X-CUSTOM-FLAG:keepme',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')

  /** Every property Calino has no field for; none may change on a save. */
  const UNMODELLED = [
    'geo',
    'class',
    'priority',
    'resources',
    'comment',
    'contact',
    'related-to',
    'x-alt-desc',
    'x-moz-lastack',
    'x-custom-flag',
  ]

  function patch(ics: string, mutate: (e: CalendarEvent) => CalendarEvent = (e) => e) {
    const vevent = createVevent(ics)
    const before = new Map(
      vevent.getAllProperties().map((p) => [p.name, p.toICALString()] as const)
    )
    const parsed = icalEventToCalendarEvent(vevent, 'cal-1')
    const patched = calendarEventToIcalComponent(mutate(parsed), vevent)
    return { patched, before }
  }

  it('preserves every unmodelled property byte-for-byte', () => {
    const { patched, before } = patch(RICH, (e) => ({ ...e, title: 'Renamed' }))

    for (const name of UNMODELLED) {
      const prop = patched.getFirstProperty(name)
      expect(prop, `${name} was dropped`).toBeTruthy()
      expect(prop!.toICALString(), `${name} was rewritten`).toBe(before.get(name))
    }
    expect(patched.getFirstPropertyValue('summary')).toBe('Renamed')
  })

  it('does not duplicate properties that are written by appending', () => {
    const { patched } = patch(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:series-1',
        'DTSTART:20260310T100000Z',
        'DTEND:20260310T110000Z',
        'RRULE:FREQ=DAILY;COUNT=5',
        'EXDATE:20260312T100000Z',
        'ATTACH;FMTTYPE=text/plain:https://example.com/a.txt',
        'X-APPLE-TRAVEL-DURATION:PT15M',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')
    )

    expect(patched.getAllProperties('rrule')).toHaveLength(1)
    expect(patched.getAllProperties('exdate')).toHaveLength(1)
    expect(patched.getAllProperties('attach')).toHaveLength(1)
    expect(patched.getAllProperties('x-apple-travel-duration')).toHaveLength(1)
  })

  it('removes a property the user cleared', () => {
    const { patched } = patch(RICH, (e) => ({ ...e, description: undefined }))

    expect(patched.getFirstProperty('description')).toBeFalsy()
    // ...without taking the unmodelled neighbours with it.
    expect(patched.getFirstProperty('x-custom-flag')).toBeTruthy()
  })

  it('drops a stale TZID when the event no longer has a zone', () => {
    const { patched } = patch(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:zoned-1',
        'DTSTART;TZID=Europe/Berlin:20260310T100000',
        'DTEND;TZID=Europe/Berlin:20260310T110000',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
      (e) => ({ ...e, timezone: undefined })
    )

    expect(patched.getFirstProperty('dtstart')?.getParameter('tzid')).toBeFalsy()
    expect(patched.getFirstProperty('dtend')?.getParameter('tzid')).toBeFalsy()
  })
})

// ---------------------------------------------------------------------------
// VALARM reconciliation — the alarm details Calino cannot model must survive a
// save, or an EMAIL alarm loses the ATTENDEE it is invalid without and a
// RELATED=END trigger silently moves.
// ---------------------------------------------------------------------------
describe('VALARM reconciliation in patch mode', () => {
  const WITH_ALARMS = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:alarmed-1',
    'DTSTART:20260310T100000Z',
    'DTEND:20260310T120000Z',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Alarm text',
    'TRIGGER;RELATED=END:-PT15M',
    'REPEAT:3',
    'DURATION:PT5M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')

  function patchAlarms(ics: string, mutate: (e: CalendarEvent) => CalendarEvent) {
    const vevent = createVevent(ics)
    const parsed = icalEventToCalendarEvent(vevent, 'cal-1')
    return calendarEventToIcalComponent(mutate(parsed), vevent)
  }

  it('leaves an untouched alarm completely alone', () => {
    const before = createVevent(WITH_ALARMS).getAllSubcomponents('valarm')[0].toString()
    // Edit something else entirely.
    const patched = patchAlarms(WITH_ALARMS, (e) => ({ ...e, title: 'Renamed' }))
    const alarms = patched.getAllSubcomponents('valarm')

    expect(alarms).toHaveLength(1)
    expect(alarms[0].toString()).toBe(before)
    // The pieces that a rebuild destroyed:
    expect(alarms[0].getFirstProperty('trigger')?.getParameter('related')).toBe('END')
    expect(alarms[0].getFirstPropertyValue('repeat')).toBe(3)
    expect(alarms[0].getFirstPropertyValue('description')).toBe('Alarm text')
  })

  it('rewrites only ACTION and TRIGGER when the reminder changed', () => {
    const patched = patchAlarms(WITH_ALARMS, (e) => ({
      ...e,
      reminders: [{ id: 'r1', minutesBefore: 30, method: 'popup' }],
    }))
    const alarm = patched.getAllSubcomponents('valarm')[0]

    expect(alarm.getFirstPropertyValue('trigger')?.toString()).toBe('-PT30M')
    // A start-relative trigger must not keep an END relation, or it moves.
    expect(alarm.getFirstProperty('trigger')?.getParameter('related')).toBeFalsy()
    // Unmodelled alarm detail is still preserved through the edit.
    expect(alarm.getFirstPropertyValue('description')).toBe('Alarm text')
    expect(alarm.getFirstPropertyValue('repeat')).toBe(3)
  })

  it('removes an alarm the user deleted', () => {
    const patched = patchAlarms(WITH_ALARMS, (e) => ({ ...e, reminders: [] }))
    expect(patched.getAllSubcomponents('valarm')).toHaveLength(0)
  })

  it('never touches an alarm whose trigger Calino cannot parse', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:exotic-1',
      'DTSTART:20260310T100000Z',
      'DTEND:20260310T110000Z',
      'BEGIN:VALARM',
      'ACTION:NONE',
      'X-WR-ALARMUID:exotic',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const before = createVevent(ics).getAllSubcomponents('valarm')[0].toString()

    // An unparseable alarm is invisible to `reminders`, so adding one must not
    // be mistaken for "the existing alarm changed".
    const patched = patchAlarms(ics, (e) => ({
      ...e,
      reminders: [{ id: 'r1', minutesBefore: 10, method: 'popup' }],
    }))
    const alarms = patched.getAllSubcomponents('valarm')

    expect(alarms).toHaveLength(2)
    expect(alarms.some((a) => a.toString() === before)).toBe(true)
  })
})
