import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { CalendarEvent, CalendarStore, SettingsStore } from '@/types'

/**
 * Searching the palette matches journal entries alongside events (they live in
 * the same `events` array), but selecting one used to hand it to the event
 * modal — which can't render a journal and filters them out of its own lookup.
 * Journal results belong to the journal day modal, keyed by day.
 */
const openModal = vi.fn()
const openJournalModal = vi.fn()

const mockEvents: CalendarEvent[] = [
  {
    id: 'ev-1',
    calendarId: 'cal1',
    title: 'Dentist appointment',
    start: '2024-03-15T09:00:00Z',
    end: '2024-03-15T10:00:00Z',
    isAllDay: false,
  },
  {
    id: 'jr-1',
    calendarId: 'cal1',
    title: 'Dentist reflections',
    start: '2024-03-15',
    end: '2024-03-15',
    isAllDay: true,
    type: 'journal',
  },
]

vi.mock('@/store/calendarStore', () => ({
  useCalendarStore: vi.fn((selector: (state: CalendarStore) => unknown) => {
    const state = {
      events: mockEvents,
      calendars: [],
      categories: [],
      currentDate: '2024-03-15',
      currentView: 'month',
      openModal,
      openJournalModal,
      addEvent: vi.fn(),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
      addCalendar: vi.fn(),
      updateCalendar: vi.fn(),
      deleteCalendar: vi.fn(),
      addCategory: vi.fn(),
      setCurrentView: vi.fn(),
      setCurrentDate: vi.fn(),
    } as unknown as CalendarStore
    return selector(state)
  }),
  selectSetCurrentView: (s: CalendarStore) => s.setCurrentView,
  selectSetCurrentDate: (s: CalendarStore) => s.setCurrentDate,
  selectOpenModal: (s: CalendarStore) => s.openModal,
  selectAddEvent: (s: CalendarStore) => s.addEvent,
  selectUpdateEvent: (s: CalendarStore) => s.updateEvent,
  selectDeleteEvent: (s: CalendarStore) => s.deleteEvent,
  selectAddCalendar: (s: CalendarStore) => s.addCalendar,
  selectUpdateCalendar: (s: CalendarStore) => s.updateCalendar,
  selectDeleteCalendar: (s: CalendarStore) => s.deleteCalendar,
  selectCalendars: (s: CalendarStore) => s.calendars,
  selectEvents: (s: CalendarStore) => s.events,
  selectAddCategory: (s: CalendarStore) => s.addCategory,
  selectCategories: (s: CalendarStore) => s.categories,
  selectOpenJournalModal: (s: CalendarStore) => s.openJournalModal,
}))

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: vi.fn((selector: (state: SettingsStore) => unknown) => {
    const state = {
      themeMode: 'auto',
      journalEnabled: true,
      contactsEnabled: false,
      viewOrder: ['month', 'journal'],
      updateSettings: vi.fn(),
    } as unknown as SettingsStore
    return selector(state)
  }),
  selectThemeMode: (s: SettingsStore) => s.themeMode,
  selectUpdateSettings: (s: SettingsStore) => s.updateSettings,
}))

vi.mock('react-router', () => ({
  useNavigate: () => vi.fn(),
}))

const { useCommandPalette } = await import('../hooks/useCommandPalette')

describe('command palette — opening a search result', () => {
  beforeEach(() => {
    openModal.mockClear()
    openJournalModal.mockClear()
  })

  const search = async (query: string) => {
    const { result } = renderHook(() => useCommandPalette({ isOpen: true }))
    act(() => result.current.setQuery(query))
    return result
  }

  it('opens a journal entry in the journal modal, not the event modal', async () => {
    const result = await search('Dentist reflections')

    const item = result.current.items.find((i) => i.id === 'event-jr-1')
    expect(item).toBeDefined()
    await act(async () => {
      await item!.onSelect()
    })

    expect(openJournalModal).toHaveBeenCalledWith('2024-03-15')
    expect(openModal).not.toHaveBeenCalled()
  })

  it('still opens a plain event in the event modal', async () => {
    const result = await search('Dentist appointment')

    const item = result.current.items.find((i) => i.id === 'event-ev-1')
    expect(item).toBeDefined()
    await act(async () => {
      await item!.onSelect()
    })

    expect(openModal).toHaveBeenCalledWith('2024-03-15T09:00:00Z', undefined, 'ev-1')
    expect(openJournalModal).not.toHaveBeenCalled()
  })
})
