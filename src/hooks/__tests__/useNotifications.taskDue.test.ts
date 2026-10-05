import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { format } from 'date-fns'
import { useNotifications } from '../useNotifications'
import type { Calendar, CalendarEvent } from '@/types'

// Task due-date reminders ride the event-reminder machinery through synthetic
// zero-lead events (see taskReminders.ts). These tests pin the wiring: which
// setting gates them, and what each platform does with them.

const mockShowNotification = vi.fn()
const mockReconcile = vi.fn()
const mockCancelAll = vi.fn()
const mockCheckPermission = vi.fn()

let isNative = false
let mirrorStatus = 'idle'

vi.mock('sonner', () => ({ toast: vi.fn() }))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNative },
}))

vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn(() => Promise.resolve({ remove: vi.fn() })) },
}))

vi.mock('@/lib/nativeReminders', () => ({
  registerReminderActions: vi.fn(() => Promise.resolve()),
  listenForReminderActions: vi.fn(() => () => {}),
  reconcileNativeReminders: (...args: unknown[]) => mockReconcile(...args),
  cancelAllNativeReminders: (...args: unknown[]) => mockCancelAll(...args),
  checkNativeReminderPermission: () => mockCheckPermission(),
}))

vi.mock('@/lib/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/notifications')>()
  return {
    ...actual,
    showNotification: (...args: unknown[]) => mockShowNotification(...args),
    getDueSnoozedReminders: () => [],
    getEffectiveReminders: (event: CalendarEvent) => event.reminders ?? [],
  }
})

vi.mock('@/store/calendarMirrorStore', () => ({
  useCalendarMirrorStore: (selector: (s: { status: string }) => unknown) =>
    selector({ status: mirrorStatus }),
  mirrorOwnsReminders: (status: string) => status === 'active',
}))

let currentEvents: CalendarEvent[] = []
let currentCalendars: Calendar[] = []
let taskDueDateReminders = true

vi.mock('@/store/calendarStore', () => {
  const useCalendarStore = (
    selector: (s: { events: CalendarEvent[]; calendars: Calendar[] }) => unknown
  ) => selector({ events: currentEvents, calendars: currentCalendars })
  // Raw events only: a task is not an event occurrence, so the event path
  // must not be what carries it.
  useCalendarStore.getState = () => ({
    getEventsForDateRange: () => currentEvents.filter((e) => e.type !== 'task'),
  })
  return {
    useCalendarStore,
    calendarMutesReminders: (c: Calendar | undefined) =>
      c?.source === 'webcal' && c.notifyReminders !== true,
  }
})

vi.mock('@/store/settingsStore', () => {
  const useSettingsStore = (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ enableDesktopNotifications: true, taskDueDateReminders })
  useSettingsStore.getState = () => ({ timeFormat: '24h' as const })
  return { useSettingsStore }
})

const calendar: Calendar = {
  id: 'cal1',
  name: 'Tasks',
  color: '#3b82f6',
  isVisible: true,
  isDefault: false,
  showTasksInViews: true,
}

function makeDueTask(id: string, due: Date, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  const dueDate = format(due, "yyyy-MM-dd'T'HH:mm")
  return {
    id,
    calendarId: 'cal1',
    title: `Task ${id}`,
    start: dueDate,
    end: dueDate,
    dueDate,
    isAllDay: false,
    type: 'task',
    completed: false,
    taskStatus: 'NEEDS-ACTION',
    ...overrides,
  }
}

describe('useNotifications - task due-date reminders', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    // Mid-month, mid-afternoon, so ±1 minute never crosses a day boundary.
    vi.setSystemTime(new Date(2026, 2, 10, 15, 30, 0))
    currentEvents = []
    currentCalendars = [calendar]
    taskDueDateReminders = true
    isNative = false
    mirrorStatus = 'idle'
    mockCheckPermission.mockResolvedValue(true)
    Object.defineProperty(globalThis, 'Notification', {
      value: { permission: 'granted' },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('notifies on the web when a task falls due', () => {
    currentEvents = [makeDueTask('t1', new Date(2026, 2, 10, 15, 30))]
    renderHook(() => useNotifications())
    expect(mockShowNotification).toHaveBeenCalledTimes(1)
    expect(mockShowNotification).toHaveBeenCalledWith(
      'Task t1',
      'Due at 15:30',
      't1',
      expect.any(String)
    )
  })

  it('does not notify before the task is due', () => {
    currentEvents = [makeDueTask('t1', new Date(2026, 2, 10, 18, 0))]
    renderHook(() => useNotifications())
    expect(mockShowNotification).not.toHaveBeenCalled()
  })

  it('stays quiet when the setting is off', () => {
    taskDueDateReminders = false
    currentEvents = [makeDueTask('t1', new Date(2026, 2, 10, 15, 30))]
    renderHook(() => useNotifications())
    expect(mockShowNotification).not.toHaveBeenCalled()
  })

  it('stays quiet for completed tasks and tasks on hidden calendars', () => {
    currentCalendars = [{ ...calendar, id: 'hidden', isVisible: false }, calendar]
    currentEvents = [
      makeDueTask('done', new Date(2026, 2, 10, 15, 30), { completed: true }),
      makeDueTask('hidden', new Date(2026, 2, 10, 15, 30), { calendarId: 'hidden' }),
    ]
    renderHook(() => useNotifications())
    expect(mockShowNotification).not.toHaveBeenCalled()
  })

  it('fires once, not again on the next poll', () => {
    currentEvents = [makeDueTask('t1', new Date(2026, 2, 10, 15, 30))]
    renderHook(() => useNotifications())
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(mockShowNotification).toHaveBeenCalledTimes(1)
  })

  describe('native', () => {
    beforeEach(() => {
      isNative = true
    })

    it('schedules task reminders alongside event reminders', async () => {
      currentEvents = [makeDueTask('t1', new Date(2026, 2, 12, 9, 0))]
      renderHook(() => useNotifications())
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })
      expect(mockReconcile).toHaveBeenCalledTimes(1)
      const scheduled = mockReconcile.mock.calls[0][0] as CalendarEvent[]
      expect(scheduled.map((e) => e.id)).toEqual(['t1'])
    })

    it('keeps scheduling only the task reminders when the calendar mirror owns events', async () => {
      mirrorStatus = 'active'
      currentEvents = [makeDueTask('t1', new Date(2026, 2, 12, 9, 0))]
      renderHook(() => useNotifications())
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })
      expect(mockCancelAll).not.toHaveBeenCalled()
      const scheduled = mockReconcile.mock.calls[0][0] as CalendarEvent[]
      expect(scheduled.map((e) => e.id)).toEqual(['t1'])
    })

    it('still clears everything when the mirror owns events and there are no task reminders', async () => {
      mirrorStatus = 'active'
      renderHook(() => useNotifications())
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })
      expect(mockCancelAll).toHaveBeenCalledTimes(1)
      expect(mockReconcile).not.toHaveBeenCalled()
    })
  })
})
