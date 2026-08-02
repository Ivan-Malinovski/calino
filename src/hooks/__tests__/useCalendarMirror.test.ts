import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useCalendarMirror } from '../useCalendarMirror'
import { useCalendarMirrorStore } from '@/store/calendarMirrorStore'
import type { Calendar, CalendarEvent } from '@/types'

const mockSync = vi.fn()
const mockClear = vi.fn()
const mockCheckPermission = vi.fn()
const mockHasCalendarApp = vi.fn()
const mockScheduleBackgroundSync = vi.fn()
const mockCancelBackgroundSync = vi.fn()

vi.mock('@/lib/calendarMirror', () => ({
  isCalendarMirrorSupported: () => true,
  checkCalendarMirrorPermission: () => mockCheckPermission(),
  hasCalendarApp: () => mockHasCalendarApp(),
  syncCalendarMirror: (...args: unknown[]) => mockSync(...args),
  clearCalendarMirror: () => mockClear(),
  scheduleBackgroundSync: () => mockScheduleBackgroundSync(),
  cancelBackgroundSync: () => mockCancelBackgroundSync(),
}))

vi.mock('@capacitor/app', () => ({
  App: { addListener: () => Promise.resolve({ remove: vi.fn() }) },
}))

let currentEvents: CalendarEvent[] = []
const currentCalendars: Calendar[] = []
let currentEnabled = true

vi.mock('@/store/calendarStore', () => ({
  useCalendarStore: (selector: (s: { events: CalendarEvent[]; calendars: Calendar[] }) => unknown) =>
    selector({ events: currentEvents, calendars: currentCalendars }),
}))

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (
    selector: (s: { enableCalendarMirror: boolean; defaultReminderMinutes: number }) => unknown
  ) => selector({ enableCalendarMirror: currentEnabled, defaultReminderMinutes: 15 }),
}))

function event(id: string): CalendarEvent {
  return {
    id,
    calendarId: 'cal-1',
    title: id,
    start: '2026-06-16T09:00:00.000Z',
    end: '2026-06-16T09:30:00.000Z',
    isAllDay: false,
  }
}

describe('useCalendarMirror', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    currentEvents = [event('a')]
    currentEnabled = true
    mockSync.mockReset().mockResolvedValue(undefined)
    mockClear.mockReset().mockResolvedValue(undefined)
    mockCheckPermission.mockReset().mockResolvedValue(true)
    mockHasCalendarApp.mockReset().mockResolvedValue(true)
    mockScheduleBackgroundSync.mockReset().mockResolvedValue(undefined)
    mockCancelBackgroundSync.mockReset().mockResolvedValue(undefined)
    useCalendarMirrorStore.setState({ status: 'off', lastError: null })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports active once a sync completes', async () => {
    renderHook(() => useCalendarMirror())
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    await waitFor(() => expect(useCalendarMirrorStore.getState().status).toBe('active'))
  })

  it('reports no-calendar-app when nothing can raise provider reminders', async () => {
    mockHasCalendarApp.mockResolvedValue(false)
    renderHook(() => useCalendarMirror())
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    await waitFor(() => expect(useCalendarMirrorStore.getState().status).toBe('no-calendar-app'))
  })

  it('distinguishes a failed write from a missing permission', async () => {
    mockSync.mockRejectedValue(new Error('provider exploded'))
    renderHook(() => useCalendarMirror())
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    await waitFor(() => {
      expect(useCalendarMirrorStore.getState().status).toBe('failed')
      expect(useCalendarMirrorStore.getState().lastError).toBe('provider exploded')
    })
  })

  it('records the result of a sync that outlives its effect run', async () => {
    // The regression: this hook re-runs on every event write, so a CalDAV sync
    // tears the effect down repeatedly while a mirror pass is still in flight.
    // Those passes used to complete and then discard their own result, leaving
    // the status stuck at 'off' — which the settings UI showed as "Syncing…"
    // forever on any account large enough to keep writing events.
    let resolveSync: () => void = () => {}
    mockSync.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSync = resolve
        })
    )

    const { rerender } = renderHook(() => useCalendarMirror())
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(mockSync).toHaveBeenCalled()

    // A new event arrives mid-sync, tearing down and re-creating the effect.
    currentEvents = [event('a'), event('b')]
    rerender()

    await act(async () => {
      resolveSync()
      await Promise.resolve()
    })

    await waitFor(() => expect(useCalendarMirrorStore.getState().status).toBe('active'))
  })

  it('tears the mirror down when the setting is turned off', async () => {
    currentEnabled = false
    renderHook(() => useCalendarMirror())
    await waitFor(() => expect(mockClear).toHaveBeenCalled())
    expect(useCalendarMirrorStore.getState().status).toBe('off')
    // The worker would otherwise keep waking the device to refresh a mirror
    // that no longer exists.
    expect(mockCancelBackgroundSync).toHaveBeenCalled()
    expect(mockScheduleBackgroundSync).not.toHaveBeenCalled()
  })

  it('starts the background refresh while the mirror is on', async () => {
    // Without it the mirror only holds what Calino saw in the foreground, so
    // an event created elsewhere never reaches the provider to be alarmed.
    renderHook(() => useCalendarMirror())
    await waitFor(() => expect(mockScheduleBackgroundSync).toHaveBeenCalled())
    expect(mockCancelBackgroundSync).not.toHaveBeenCalled()
  })
})
