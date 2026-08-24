import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildVCalendar,
  sanitizeFilename,
  exportSingleEventIcs,
  exportCalendarIcs,
  exportAllEventsIcs,
} from '../icsExport'
import { ensureZoneRegisteredAsync } from '../timezoneRegistry'
import { parseICALData } from '@/features/caldav/adapter/iCalendarAdapter'
import type { Calendar, CalendarEvent } from '@/types'

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt-1',
    uid: 'evt-1',
    calendarId: 'cal-1',
    title: 'Standup',
    start: '2026-03-10T09:00:00.000Z',
    end: '2026-03-10T09:30:00.000Z',
    isAllDay: false,
    ...overrides,
  }
}

const calendar: Calendar = {
  id: 'cal-1',
  name: 'Work',
  color: '#3b82f6',
  isVisible: true,
  isDefault: true,
  showTasksInViews: true,
}

describe('buildVCalendar', () => {
  it('emits exactly one top-level VCALENDAR with the Calino headers', () => {
    const ics = buildVCalendar([makeEvent(), makeEvent({ id: 'evt-2', uid: 'evt-2' })])

    expect(ics.match(/BEGIN:VCALENDAR/g)).toHaveLength(1)
    expect(ics.match(/END:VCALENDAR/g)).toHaveLength(1)
    expect(ics).toContain('VERSION:2.0')
    expect(ics).toContain('PRODID:-//Calino//Calendar//EN')
    expect(ics).toContain('CALSCALE:GREGORIAN')
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
  })

  it('is valid for an empty event list', () => {
    const ics = buildVCalendar([])
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).not.toContain('BEGIN:VEVENT')
    expect(parseICALData(ics, 'cal-1')).toEqual([])
  })

  it('dispatches tasks to VTODO and journals to VJOURNAL', () => {
    const ics = buildVCalendar([
      makeEvent(),
      makeEvent({ id: 'task-1', uid: 'task-1', type: 'task', title: 'Write spec' }),
      makeEvent({ id: 'jrnl-1', uid: 'jrnl-1', type: 'journal', title: 'Monday notes' }),
    ])

    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('BEGIN:VTODO')
    expect(ics).toContain('BEGIN:VJOURNAL')
  })

  it('serializes recurrence rules', () => {
    const ics = buildVCalendar([
      makeEvent({
        recurrence: { frequency: 'weekly', interval: 1, byWeekday: [1, 3] },
      }),
    ])
    expect(ics).toMatch(/RRULE:.*FREQ=WEEKLY/)
  })

  it('serializes reminders as VALARM', () => {
    const ics = buildVCalendar([
      makeEvent({ reminders: [{ id: 'r1', minutesBefore: 15, method: 'popup' }] }),
    ])
    expect(ics).toContain('BEGIN:VALARM')
    expect(ics).toContain('ACTION:DISPLAY')
  })

  it('round-trips an event back through parseICALData', () => {
    const original = makeEvent({
      title: 'Design review',
      description: 'Bring the mocks',
      location: 'Room 4',
    })
    const parsed = parseICALData(buildVCalendar([original]), 'cal-2')

    expect(parsed).toHaveLength(1)
    const back = parsed[0]!
    expect(back.title).toBe('Design review')
    expect(back.description).toBe('Bring the mocks')
    expect(back.location).toBe('Room 4')
    expect(back.calendarId).toBe('cal-2')
    expect(new Date(back.start).toISOString()).toBe(original.start)
    expect(new Date(back.end).toISOString()).toBe(original.end)
  })

  it('round-trips tasks and journals without dropping them', () => {
    const ics = buildVCalendar([
      makeEvent({ id: 't', uid: 't', type: 'task', title: 'Ship it' }),
      makeEvent({ id: 'j', uid: 'j', type: 'journal', title: 'Retro' }),
    ])
    const parsed = parseICALData(ics, 'cal-1')

    expect(parsed.map((e) => e.type).sort()).toEqual(['journal', 'task'])
  })
})

describe('sanitizeFilename', () => {
  it('keeps ordinary titles as-is', () => {
    expect(sanitizeFilename('Team Standup', 'event')).toBe('Team Standup')
  })

  it('replaces path separators and reserved characters', () => {
    expect(sanitizeFilename('Q1/Q2 plan', 'event')).toBe('Q1-Q2 plan')
    expect(sanitizeFilename('a\\b:c*d?e"f<g>h|i', 'event')).toBe('a-b-c-d-e-f-g-h-i')
  })

  it('strips control characters', () => {
    expect(sanitizeFilename('one\x01two\x1ftre', 'event')).toBe('onetwotre')
  })

  it('collapses whitespace and trims leading/trailing dots', () => {
    expect(sanitizeFilename('  ..spaced   out..  ', 'event')).toBe('spaced out')
  })

  it('caps the length', () => {
    expect(sanitizeFilename('x'.repeat(500), 'event')).toHaveLength(80)
  })

  it('falls back when the title sanitizes to nothing', () => {
    expect(sanitizeFilename('', 'event')).toBe('event')
    expect(sanitizeFilename('   ', 'calendar')).toBe('calendar')
    expect(sanitizeFilename('...', 'event')).toBe('event')
  })

  it('preserves non-Latin titles', () => {
    expect(sanitizeFilename('Совещание', 'event')).toBe('Совещание')
  })
})

describe('download helpers', () => {
  let clicked: HTMLAnchorElement[]

  beforeEach(() => {
    clicked = []
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock')
    globalThis.URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicked.push(this)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exportSingleEventIcs names the file after the event', () => {
    exportSingleEventIcs(makeEvent({ title: 'Design/Review' }))
    expect(clicked).toHaveLength(1)
    expect(clicked[0]!.download).toBe('Design-Review.ics')
  })

  it('exportCalendarIcs filters to the calendar and names the file after it', () => {
    const count = exportCalendarIcs(calendar, [
      makeEvent(),
      makeEvent({ id: 'evt-2', uid: 'evt-2' }),
      makeEvent({ id: 'other', uid: 'other', calendarId: 'cal-9' }),
    ])

    expect(count).toBe(2)
    expect(clicked[0]!.download).toBe('Work.ics')
  })

  it('exportAllEventsIcs uses a dated filename', () => {
    exportAllEventsIcs([makeEvent()])
    expect(clicked[0]!.download).toMatch(/^calino-export-\d{4}-\d{2}-\d{2}\.ics$/)
  })
  describe('Phase 2 C4 buildVCalendar VTIMEZONE', () => {
    it('emits a VTIMEZONE and folds lines', async () => {
      await ensureZoneRegisteredAsync('Europe/Copenhagen')
      const ics = buildVCalendar([
        makeEvent({
          start: '2026-03-10T09:00:00',
          end: '2026-03-10T09:30:00',
          timezone: 'Europe/Copenhagen',
        }),
      ])
      expect(ics).toContain('BEGIN:VTIMEZONE')
      expect(ics).toContain('TZID:Europe/Copenhagen')
      // RFC 5545 §3.1: no physical line may exceed 75 octets.
      for (const line of ics.split('\r\n')) {
        expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
      }
    })
  })
})
