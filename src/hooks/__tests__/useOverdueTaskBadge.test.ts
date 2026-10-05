import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useOverdueTaskBadge } from '../useOverdueTaskBadge'
import type { Calendar, CalendarEvent } from '@/types'

const mockSetNative = vi.fn()
const mockClearNative = vi.fn()
const mockCheckPermission = vi.fn()
let appStateHandler: ((state: { isActive: boolean }) => void) | undefined
let isNative = false

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNative },
}))

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn((_event: string, handler: (state: { isActive: boolean }) => void) => {
      appStateHandler = handler
      return Promise.resolve({ remove: vi.fn() })
    }),
  },
}))

vi.mock('@/lib/nativeReminders', () => ({
  checkNativeReminderPermission: () => mockCheckPermission(),
  setNativeOverdueBadge: (...args: unknown[]) => mockSetNative(...args),
  clearNativeOverdueBadge: (...args: unknown[]) => mockClearNative(...args),
}))

let currentEvents: CalendarEvent[] = []
let currentCalendars: Calendar[] = []
let badgeEnabled = true
let notificationsEnabled = true

vi.mock('@/store/calendarStore', () => {
  const useCalendarStore = (
    selector: (s: { events: CalendarEvent[]; calendars: Calendar[] }) => unknown
  ) => selector({ events: currentEvents, calendars: currentCalendars })
  return { useCalendarStore, calendarMutesReminders: () => false }
})

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ overdueTaskBadge: badgeEnabled, enableDesktopNotifications: notificationsEnabled }),
}))

const calendar: Calendar = {
  id: 'cal1',
  name: 'Tasks',
  color: '#3b82f6',
  isVisible: true,
  isDefault: false,
  showTasksInViews: true,
}

function makeTask(id: string, dueDate: string): CalendarEvent {
  return {
    id,
    calendarId: 'cal1',
    title: id,
    start: dueDate,
    end: dueDate,
    dueDate,
    isAllDay: true,
    type: 'task',
    completed: false,
    taskStatus: 'NEEDS-ACTION',
  }
}

describe('useOverdueTaskBadge', () => {
  const setAppBadge = vi.fn(() => Promise.resolve())
  const clearAppBadge = vi.fn(() => Promise.resolve())

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.setSystemTime(new Date(2026, 2, 10, 15, 0, 0))
    currentEvents = [makeTask('a', '2026-03-09'), makeTask('b', '2026-03-01'), makeTask('c', '2026-03-10')]
    currentCalendars = [calendar]
    badgeEnabled = true
    notificationsEnabled = true
    isNative = false
    appStateHandler = undefined
    mockCheckPermission.mockResolvedValue(true)
    Object.assign(navigator, { setAppBadge, clearAppBadge })
  })

  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(navigator, 'setAppBadge')
    Reflect.deleteProperty(navigator, 'clearAppBadge')
  })

  describe('web', () => {
    it('sets the app badge to the overdue count', () => {
      renderHook(() => useOverdueTaskBadge())
      expect(setAppBadge).toHaveBeenCalledWith(2)
    })

    it('clears the badge when nothing is overdue', () => {
      currentEvents = [makeTask('c', '2026-03-10')]
      renderHook(() => useOverdueTaskBadge())
      expect(setAppBadge).not.toHaveBeenCalled()
      expect(clearAppBadge).toHaveBeenCalled()
    })

    it('does nothing to the badge when the setting is off', () => {
      badgeEnabled = false
      renderHook(() => useOverdueTaskBadge())
      expect(setAppBadge).not.toHaveBeenCalled()
    })

    it('picks up a task turning overdue when the day rolls over', () => {
      renderHook(() => useOverdueTaskBadge())
      expect(setAppBadge).toHaveBeenLastCalledWith(2)
      act(() => {
        vi.setSystemTime(new Date(2026, 2, 11, 0, 5, 0))
        vi.advanceTimersByTime(60_000)
      })
      expect(setAppBadge).toHaveBeenLastCalledWith(3)
    })

    it('clears the badge when unmounted', () => {
      const { unmount } = renderHook(() => useOverdueTaskBadge())
      clearAppBadge.mockClear()
      unmount()
      expect(clearAppBadge).toHaveBeenCalled()
    })

    it('copes with a browser that has no Badging API', () => {
      Reflect.deleteProperty(navigator, 'setAppBadge')
      Reflect.deleteProperty(navigator, 'clearAppBadge')
      expect(() => renderHook(() => useOverdueTaskBadge())).not.toThrow()
    })

    it('swallows a rejected badge call', async () => {
      setAppBadge.mockRejectedValueOnce(new Error('denied'))
      renderHook(() => useOverdueTaskBadge())
      await act(async () => {
        await Promise.resolve()
      })
    })
  })

  describe('native', () => {
    beforeEach(() => {
      isNative = true
    })

    it('posts the standing notification with the count, and leaves the web API alone', async () => {
      renderHook(() => useOverdueTaskBadge())
      await act(async () => {
        await Promise.resolve()
      })
      expect(mockSetNative).toHaveBeenCalledWith(2)
      expect(setAppBadge).not.toHaveBeenCalled()
    })

    it('clears it without notification permission', async () => {
      mockCheckPermission.mockResolvedValue(false)
      renderHook(() => useOverdueTaskBadge())
      await act(async () => {
        await Promise.resolve()
      })
      expect(mockSetNative).not.toHaveBeenCalled()
      expect(mockClearNative).toHaveBeenCalled()
    })

    it('clears it when notifications are switched off', async () => {
      notificationsEnabled = false
      renderHook(() => useOverdueTaskBadge())
      await act(async () => {
        await Promise.resolve()
      })
      expect(mockSetNative).not.toHaveBeenCalled()
      expect(mockClearNative).toHaveBeenCalled()
    })

    it('takes the notification down when unmounted', async () => {
      const { unmount } = renderHook(() => useOverdueTaskBadge())
      await act(async () => {
        await Promise.resolve()
      })
      mockClearNative.mockClear()
      unmount()
      expect(mockClearNative).toHaveBeenCalledTimes(1)
    })

    it('re-posts when the app returns to the foreground', async () => {
      renderHook(() => useOverdueTaskBadge())
      await act(async () => {
        await Promise.resolve()
      })
      mockSetNative.mockClear()
      await act(async () => {
        appStateHandler?.({ isActive: true })
        await Promise.resolve()
      })
      expect(mockSetNative).toHaveBeenCalledWith(2)
    })
  })
})
