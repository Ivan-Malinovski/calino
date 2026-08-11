import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useNotifications } from '../useNotifications'
import type { CalendarEvent } from '@/types'

const mockShowNotification = vi.fn()
const mockToast = vi.fn()

vi.mock('sonner', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}))

vi.mock('@/lib/notifications', () => ({
  showNotification: (...args: unknown[]) => mockShowNotification(...args),
  createNotificationId: (eventId: string, reminderId: string) => `calino-${eventId}-${reminderId}`,
  getDueSnoozedReminders: () => [],
  snoozeReminder: vi.fn(),
  getEffectiveReminders: (event: CalendarEvent) => event.reminders ?? [],
}))

let currentEvents: CalendarEvent[] = []
let currentEnableNotifications = true
let currentDefaultReminderMinutes = 15

// The hook reads the store's expanded occurrences via getEventsForDateRange.
// None of the events here recur, so mirroring the raw list matches what the
// real store returns.
vi.mock('@/store/calendarStore', () => {
  const useCalendarStore = (selector: (s: { events: CalendarEvent[] }) => unknown) =>
    selector({ events: currentEvents })
  useCalendarStore.getState = () => ({
    getEventsForDateRange: () => currentEvents,
  })
  return { useCalendarStore }
})

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (
    selector: (s: {
      enableDesktopNotifications: boolean
      defaultReminderMinutes: number
    }) => unknown
  ) =>
    selector({
      enableDesktopNotifications: currentEnableNotifications,
      defaultReminderMinutes: currentDefaultReminderMinutes,
    }),
}))

function makeEvent(id: string, start: Date, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id,
    calendarId: 'cal1',
    title: `Event ${id}`,
    start: start.toISOString(),
    end: new Date(start.getTime() + 60 * 60_000).toISOString(),
    isAllDay: false,
    type: 'event',
    reminders: [{ id: 'rem1', minutesBefore: 15, method: 'popup' }],
    ...overrides,
  }
}

describe('Bug #82: 1-minute notification polling interval', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    currentEvents = []
    currentEnableNotifications = true
    currentDefaultReminderMinutes = 15
    mockToast.mockClear()

    Object.defineProperty(globalThis, 'Notification', {
      value: { permission: 'granted' },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires a reminder when an event enters the check window', () => {
    const now = new Date()
    const eventStart = new Date(now.getTime() + 15 * 60_000)
    currentEvents = [makeEvent('evt1', eventStart)]

    renderHook(() => useNotifications())

    expect(mockShowNotification).toHaveBeenCalledTimes(1)
  })

  it('uses 60-second polling interval (not 5 minutes)', () => {
    const now = new Date()
    // Event starts in 17 minutes → reminder fires in 2 min (17-15), outside the 1-min check window
    const eventStart = new Date(now.getTime() + 17 * 60_000)
    currentEvents = [makeEvent('evt1', eventStart)]

    renderHook(() => useNotifications())
    expect(mockShowNotification).not.toHaveBeenCalled()

    // Advance 1 minute → event is 16 min away, reminder fires in 1 min, within check window
    act(() => {
      vi.advanceTimersByTime(60 * 1000)
    })

    expect(mockShowNotification).toHaveBeenCalledTimes(1)
  })

  it('detects new reminders within 1 minute (not 5 minutes)', () => {
    const now = new Date()
    // Event starts in 18 minutes → reminder fires in 3 min (18-15), outside check window
    const eventStart = new Date(now.getTime() + 18 * 60_000)
    currentEvents = [makeEvent('evt1', eventStart)]

    renderHook(() => useNotifications())
    expect(mockShowNotification).not.toHaveBeenCalled()

    // Advance 2 minutes → event is 16 min away, reminder fires in 1 min, within check window
    act(() => {
      vi.advanceTimersByTime(2 * 60 * 1000)
    })

    expect(mockShowNotification).toHaveBeenCalledTimes(1)
  })

  it('does not miss reminders that fall within 1-minute windows', () => {
    const now = new Date()
    // Event starts in 17 min — reminder fires in 2 min, outside check window initially
    const eventStart = new Date(now.getTime() + 17 * 60_000)
    currentEvents = [makeEvent('evt1', eventStart)]

    renderHook(() => useNotifications())
    expect(mockShowNotification).not.toHaveBeenCalled()

    // Advance 1 min — event is 16 min away, reminder fires in 1 min, within 1-min window
    act(() => {
      vi.advanceTimersByTime(60 * 1000)
    })

    expect(mockShowNotification).toHaveBeenCalledTimes(1)
  })
})
