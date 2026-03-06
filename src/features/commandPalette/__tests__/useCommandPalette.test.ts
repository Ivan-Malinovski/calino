import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCommandPalette } from '../hooks/useCommandPalette'
import type { CalendarEvent, CalendarStore, SettingsStore } from '@/types'

const mockEvents: CalendarEvent[] = [
  {
    id: '1',
    calendarId: 'cal1',
    title: 'Team Meeting',
    location: 'Conference Room',
    start: '2024-03-15T09:00:00Z',
    end: '2024-03-15T10:00:00Z',
    isAllDay: false,
  },
]

const mockCalendars = [
  { id: 'cal1', name: 'Calendar 1', color: '#4285F4', isVisible: true, isDefault: true },
]

vi.mock('@/store/calendarStore', () => ({
  useCalendarStore: vi.fn((selector: (state: CalendarStore) => unknown) => {
    const state: CalendarStore = {
      events: mockEvents,
      calendars: mockCalendars,
      currentDate: '2024-03-15',
      currentView: 'month',
      selectedEventId: null,
      isModalOpen: false,
      selectedDate: null,
      selectedEndDate: null,
      isOverlayOpen: false,
      selectedEventType: 'event',
      showAddCalendar: false,
      addEvent: vi.fn(),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
      duplicateEvent: vi.fn(),
      addCalendar: vi.fn(),
      updateCalendar: vi.fn(),
      deleteCalendar: vi.fn(),
      toggleCalendarVisibility: vi.fn(),
      setDefaultCalendar: vi.fn(),
      setCurrentDate: vi.fn(),
      setCurrentView: vi.fn(),
      setSelectedEventId: vi.fn(),
      openModal: vi.fn(),
      closeModal: vi.fn(),
      setOverlayOpen: vi.fn(),
      setShowAddCalendar: vi.fn(),
      getEventsForDateRange: vi.fn(),
      getVisibleEvents: vi.fn(),
    }
    return selector(state)
  }),
  selectSetCurrentView: (state: CalendarStore) => state.setCurrentView,
  selectSetCurrentDate: (state: CalendarStore) => state.setCurrentDate,
  selectOpenModal: (state: CalendarStore) => state.openModal,
  selectAddEvent: (state: CalendarStore) => state.addEvent,
  selectEvents: (state: CalendarStore) => state.events,
  selectCalendars: (state: CalendarStore) => state.calendars,
}))

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: vi.fn((selector: (state: SettingsStore) => unknown) => {
    const state: SettingsStore = {
      timezone: 'UTC',
      dateFormat: 'yyyy-MM-dd',
      timeFormat: '12h',
      firstDayOfWeek: 0,
      defaultDuration: 60,
      defaultView: 'month',
      showWeekNumbers: false,
      eventDensity: 'comfortable',
      defaultReminderMinutes: 15,
      defaultEventColor: '#4285F4',
      enableDesktopNotifications: false,
      enableSoundAlerts: false,
      syncEnabled: false,
      syncIntervalMinutes: 30,
      conflictResolution: 'local-wins',
      compactRecurringEvents: false,
      compressPastWeeks: false,
      hasCompletedOnboarding: false,
      themeMode: 'auto',
      lightTheme: 'default',
      darkTheme: 'default',
      caldavDebugMode: false,
      updateSettings: vi.fn(),
      resetSettings: vi.fn(),
    }
    return selector(state)
  }),
  selectThemeMode: (state: SettingsStore) => state.themeMode,
  selectUpdateSettings: (state: SettingsStore) => state.updateSettings,
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

describe('useCommandPalette', () => {
  it('initializes with empty query', () => {
    const { result } = renderHook(() => useCommandPalette({ isOpen: true }))

    expect(result.current.query).toBe('')
  })

  it('updates query when setQuery is called', () => {
    const { result } = renderHook(() => useCommandPalette({ isOpen: true }))

    act(() => {
      result.current.setQuery('today')
    })

    expect(result.current.query).toBe('today')
  })

  it('resets query and selectedIndex when closed', () => {
    const { result, rerender } = renderHook(({ isOpen }) => useCommandPalette({ isOpen }), {
      initialProps: { isOpen: true },
    })

    act(() => {
      result.current.setQuery('test query')
    })

    expect(result.current.query).toBe('test query')

    rerender({ isOpen: false })

    act(() => {})

    expect(result.current.query).toBe('')
    expect(result.current.selectedIndex).toBe(0)
  })

  it('resets selectedIndex when query changes', () => {
    const { result } = renderHook(() => useCommandPalette({ isOpen: true }))

    act(() => {
      result.current.setSelectedIndex(5)
    })

    act(() => {
      result.current.setQuery('new query')
    })

    expect(result.current.selectedIndex).toBe(0)
  })
})
