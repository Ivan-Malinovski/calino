import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSearch } from '../hooks/useSearch'
import type { CalendarEvent } from '@/types'

const mockEvents: CalendarEvent[] = [
  {
    id: '1',
    calendarId: 'cal1',
    title: 'Team Meeting',
    description: 'Weekly standup',
    location: 'Conference Room',
    start: '2024-03-15T09:00:00Z',
    end: '2024-03-15T10:00:00Z',
    isAllDay: false,
  },
  {
    id: '2',
    calendarId: 'cal1',
    title: 'Lunch',
    location: 'Restaurant',
    start: '2024-03-15T12:00:00Z',
    end: '2024-03-15T13:00:00Z',
    isAllDay: false,
  },
]

vi.mock('@/store/calendarStore', () => ({
  useCalendarStore: vi.fn((selector) => {
    const state = {
      events: mockEvents,
      calendars: [
        { id: 'cal1', name: 'Calendar 1', color: '#4285F4', isVisible: true, isDefault: true },
      ],
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
}))

describe('useSearch', () => {
  it('initializes with empty query and results', () => {
    const { result } = renderHook(() => useSearch())

    expect(result.current.query).toBe('')
    expect(result.current.results).toHaveLength(0)
    expect(result.current.isSearchOpen).toBe(false)
  })

  it('updates query when handleSearch is called', () => {
    const { result } = renderHook(() => useSearch())

    act(() => {
      result.current.handleSearch('meeting')
    })

    expect(result.current.query).toBe('meeting')
  })

  it('clears query when handleClear is called', () => {
    const { result } = renderHook(() => useSearch())

    act(() => {
      result.current.handleSearch('meeting')
    })

    act(() => {
      result.current.handleClear()
    })

    expect(result.current.query).toBe('')
    expect(result.current.debouncedQuery).toBe('')
  })

  it('opens search when openSearch is called', () => {
    const { result } = renderHook(() => useSearch())

    act(() => {
      result.current.openSearch()
    })

    expect(result.current.isSearchOpen).toBe(true)
  })

  it('closes search when closeSearch is called', () => {
    const { result } = renderHook(() => useSearch())

    act(() => {
      result.current.openSearch()
    })

    act(() => {
      result.current.closeSearch()
    })

    expect(result.current.isSearchOpen).toBe(false)
    expect(result.current.query).toBe('')
  })

  it('updates filters when updateFilters is called', () => {
    const { result } = renderHook(() => useSearch())

    act(() => {
      result.current.updateFilters({ calendarIds: ['cal1'] })
    })

    expect(result.current.filters.calendarIds).toEqual(['cal1'])
  })

  it('clears filters when clearFilters is called', () => {
    const { result } = renderHook(() => useSearch())

    act(() => {
      result.current.updateFilters({ calendarIds: ['cal1'], dateFrom: '2024-03-01' })
    })

    act(() => {
      result.current.clearFilters()
    })

    expect(result.current.filters).toEqual({})
  })

  it('debounces search query', () => {
    const { result } = renderHook(() => useSearch())

    act(() => {
      result.current.handleSearch('meeting')
    })

    expect(result.current.isSearching).toBe(true)
  })
})
