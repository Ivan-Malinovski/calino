import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCommandPalette } from '../hooks/useCommandPalette'
import type { CalendarEvent } from '@/types'

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
  useCalendarStore: vi.fn((selector) => {
    const state = {
      events: mockEvents,
      calendars: mockCalendars,
      addEvent: vi.fn(),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
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
      getEventsForDateRange: vi.fn(),
      getVisibleEvents: vi.fn(),
    }
    return selector(state as never)
  }),
  selectSetCurrentView: (state: never) => state.setCurrentView,
  selectSetCurrentDate: (state: never) => state.setCurrentDate,
  selectOpenModal: (state: never) => state.openModal,
  selectAddEvent: (state: never) => state.addEvent,
  selectEvents: (state: never) => state.events,
  selectCalendars: (state: never) => state.calendars,
}))

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: vi.fn((selector) => {
    const state = {
      timeFormat: '12h' as const,
      firstDayOfWeek: 0,
      defaultView: 'month' as const,
      themeMode: 'auto' as const,
      updateSettings: vi.fn(),
    }
    return selector(state as never)
  }),
  selectThemeMode: (state: never) => state.themeMode,
  selectUpdateSettings: (state: never) => state.updateSettings,
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
