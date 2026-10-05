import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseISO } from 'date-fns'
import type { CalendarEvent } from '@/types'
import { toEventInstant, formatTime } from '@/lib/datetime'
import { LocalNotifications } from '@capacitor/local-notifications'
import {
  reminderInstant,
  reminderBodyTime,
  setNativeOverdueBadge,
  clearNativeOverdueBadge,
} from '../nativeReminders'
import { reminderBody } from '../notifications'

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
    createChannel: vi.fn(),
    removeDeliveredNotifications: vi.fn(),
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
    const display = formatTime(toEventInstant(event.start, event.timezone), '24h')
    expect(reminderBodyTime(event)).toBe(display)
    expect(reminderBody(event, new Date('2026-02-09T12:00:00'))).toBe(`Starts tomorrow at ${display}`)
    expect(reminderBody(event, new Date('2026-02-08T12:00:00'))).toContain('Feb 10, 2026')
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
    expect(reminderBody(event, new Date('2026-02-09T12:00:00'))).toBe('Starts tomorrow')
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

describe('nativeReminders - overdue task badge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('posts one silent standing notification carrying the count', async () => {
    await setNativeOverdueBadge(3)
    expect(LocalNotifications.createChannel).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'overdue-tasks', importance: 2 })
    )
    const { notifications } = vi.mocked(LocalNotifications.schedule).mock.calls[0][0]
    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toMatchObject({
      title: '3 overdue tasks',
      badge: 3,
      channelId: 'overdue-tasks',
      autoCancel: false,
    })
    // No `schedule`: the plugin posts it immediately.
    expect(notifications[0].schedule).toBeUndefined()
  })

  it('uses the singular for one task', async () => {
    await setNativeOverdueBadge(1)
    const { notifications } = vi.mocked(LocalNotifications.schedule).mock.calls[0][0]
    expect(notifications[0].title).toBe('1 overdue task')
  })

  it('reuses one notification id, so a new count replaces the old one', async () => {
    await setNativeOverdueBadge(2)
    await setNativeOverdueBadge(5)
    const ids = vi
      .mocked(LocalNotifications.schedule)
      .mock.calls.map((call) => call[0].notifications[0].id)
    expect(ids[0]).toBe(ids[1])
  })

  it('takes the notification down for a zero count', async () => {
    await setNativeOverdueBadge(0)
    expect(LocalNotifications.schedule).not.toHaveBeenCalled()
    expect(LocalNotifications.removeDeliveredNotifications).toHaveBeenCalledTimes(1)
  })

  it('removes the delivered notification, not a pending one', async () => {
    await setNativeOverdueBadge(2)
    const postedId = vi.mocked(LocalNotifications.schedule).mock.calls[0][0].notifications[0].id
    await clearNativeOverdueBadge()
    expect(LocalNotifications.removeDeliveredNotifications).toHaveBeenCalledWith({
      notifications: [expect.objectContaining({ id: postedId })],
    })
    expect(LocalNotifications.cancel).not.toHaveBeenCalled()
  })
})
