import { describe, it, expect, vi } from 'vitest'
import { parseISO } from 'date-fns'
import type { CalendarEvent } from '@/types'
import { toEventInstant } from '@/lib/datetime'
import { reminderInstant, reminderBodyTime, reminderBody } from '../nativeReminders'

// The helpers under test are pure; mock the Capacitor plugin and the deep-link
// module so importing nativeReminders never touches platform code.
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    requestPermissions: vi.fn(),
    checkPermissions: vi.fn(),
    schedule: vi.fn(),
    getPending: vi.fn(),
    cancel: vi.fn(),
    addListener: vi.fn(),
    registerActionTypes: vi.fn(),
  },
}))

vi.mock('../deepLink', () => ({
  openEventDeepLink: vi.fn(),
}))

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt1',
    calendarId: 'cal1',
    title: 'Event evt1',
    start: '2026-02-10T10:00:00',
    end: '2026-02-10T11:00:00',
    isAllDay: false,
    type: 'event',
    reminders: [{ id: 'rem1', minutesBefore: 15, method: 'popup' }],
    ...overrides,
  }
}

describe('nativeReminders - TZID reminder timing', () => {
  it('schedules a TZID event at toEventInstant(start, tz) minus the lead time', () => {
    // Naive wall clock in Europe/Copenhagen. Expected value derived from
    // toEventInstant so the test is portable across the west/east projects.
    const event = makeEvent({ timezone: 'Europe/Copenhagen' })
    const minutesBefore = 15
    const expected = new Date(
      toEventInstant(event.start, event.timezone).getTime() - minutesBefore * 60_000
    )
    expect(reminderInstant(event, minutesBefore).getTime()).toBe(expected.getTime())
  })

  it('renders the body time as the device-local display of the true instant', () => {
    const event = makeEvent({ timezone: 'Europe/Copenhagen' })
    const display = toEventInstant(event.start, event.timezone).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    })
    expect(reminderBodyTime(event)).toBe(display)
    expect(reminderBody(event)).toBe(`Starting at ${display}`)
  })

  it('keeps calendar-date behavior for all-day events (no conversion)', () => {
    // Even with a TZID set, an all-day event's trigger must stay midnight
    // local on the event date minus the lead time — toEventInstant would
    // shift the date-only value a day west of UTC.
    const event = makeEvent({ start: '2026-02-10', isAllDay: true, timezone: 'Europe/Copenhagen' })
    const minutesBefore = 15
    expect(reminderInstant(event, minutesBefore).getTime()).toBe(
      parseISO(event.start).getTime() - minutesBefore * 60_000
    )
    expect(reminderBodyTime(event)).toBe('All day')
    expect(reminderBody(event)).toBe('Starting today')
  })

  it('passes Z-suffixed (already-instant) starts through unchanged', () => {
    // Recurring occurrence events carry Z-suffixed UTC starts; toEventInstant
    // must leave them alone (no zone path for a trailing Z).
    const event = makeEvent({ start: '2026-02-10T09:00:00Z', timezone: 'Europe/Copenhagen' })
    const minutesBefore = 15
    expect(reminderInstant(event, minutesBefore).getTime()).toBe(
      parseISO(event.start).getTime() - minutesBefore * 60_000
    )
  })
})
