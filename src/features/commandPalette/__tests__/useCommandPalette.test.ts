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
  {
    id: 'cal1',
    name: 'Calendar 1',
    color: '#4285F4',
    isVisible: true,
    isDefault: true,
    showTasksInViews: true,
  },
]

vi.mock('@/store/calendarStore', () => ({
  useCalendarStore: vi.fn((selector: (state: CalendarStore) => unknown) => {
    const state: CalendarStore = {
      events: mockEvents,
      calendars: mockCalendars,
      categories: [],
      autoCategoryRules: [],
      selectedCategoryIds: [],
      currentDate: '2024-03-15',
      currentView: 'month',
      selectedEventId: null,
      isModalOpen: false,
      selectedDate: null,
      selectedEndDate: null,
      initialTitle: null,
      initialCalendarId: null,
      subtaskParentId: null,
      isOverlayOpen: false,
      selectedEventType: 'event',
      showAddCalendar: false,
      previewEventId: null,
      previewPosition: null,
      isJournalModalOpen: false,
      journalModalDate: null,
      journalStartInCompose: false,
      brokenEvents: [],
      duplicateUidIssues: [],
      rangeExpansionVersion: 0,
      addEvent: vi.fn(),
      updateEvent: vi.fn(),
      completeTask: vi.fn(),
      deleteEvent: vi.fn(),
      duplicateEvent: vi.fn(),
      addBrokenEvent: vi.fn(),
      removeBrokenEvent: vi.fn(),
      fixBrokenEvent: vi.fn(),
      addDuplicateUidIssue: vi.fn(),
      clearDuplicateUidIssues: vi.fn(),
      bumpVersion: vi.fn(),
      addCalendar: vi.fn(),
      updateCalendar: vi.fn(),
      deleteCalendar: vi.fn(),
      toggleCalendarVisibility: vi.fn(),
      setDefaultCalendar: vi.fn(),
      addCategory: vi.fn(),
      updateCategory: vi.fn(),
      deleteCategory: vi.fn(),
      addAutoCategoryRule: vi.fn(),
      updateAutoCategoryRule: vi.fn(),
      deleteAutoCategoryRule: vi.fn(),
      toggleCategoryFilter: vi.fn(),
      setCurrentDate: vi.fn(),
      setCurrentView: vi.fn(),
      setSelectedEventId: vi.fn(),
      openModal: vi.fn(),
      closeModal: vi.fn(),
      setOverlayOpen: vi.fn(),
      setShowAddCalendar: vi.fn(),
      openPreview: vi.fn(),
      closePreview: vi.fn(),
      openJournalModal: vi.fn(),
      closeJournalModal: vi.fn(),
      getEventsForDateRange: vi.fn(),
      getVisibleEvents: vi.fn(),
    }
    return selector(state)
  }),
  selectSetCurrentView: (state: CalendarStore) => state.setCurrentView,
  selectSetCurrentDate: (state: CalendarStore) => state.setCurrentDate,
  selectOpenModal: (state: CalendarStore) => state.openModal,
  selectAddEvent: (state: CalendarStore) => state.addEvent,
  selectUpdateEvent: (state: CalendarStore) => state.updateEvent,
  selectDeleteEvent: (state: CalendarStore) => state.deleteEvent,
  selectAddCalendar: (state: CalendarStore) => state.addCalendar,
  selectUpdateCalendar: (state: CalendarStore) => state.updateCalendar,
  selectDeleteCalendar: (state: CalendarStore) => state.deleteCalendar,
  selectCalendars: (state: CalendarStore) => state.calendars,
  selectEvents: (state: CalendarStore) => state.events,
  selectAddCategory: (state: CalendarStore) => state.addCategory,
  selectCategories: (state: CalendarStore) => state.categories,
  selectOpenJournalModal: (state: CalendarStore) => state.openJournalModal,
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
      conflictResolution: 'local-wins',
      compactRecurringEvents: false,
      compressPastWeeks: false,
      hasCompletedOnboarding: false,
      themeMode: 'auto',
      lightTheme: 'default',
      darkTheme: 'default',
      caldavDebugMode: false,
      hideCompletedTasksInMonthView: true,
      monthViewEventLimit: 3,
      sidebarWidth: 300,
      sidebarCollapsed: false,
      agendaSidebarOpen: false,
      agendaSidebarWidth: 340,
      useCategoryColors: true,
      showEventIcons: true,
      journalEnabled: false,
      contactsEnabled: false,
      taskDueDateReminders: true,
      overdueTaskBadge: false,
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

  it('does not reset query immediately when closed (deferred to component)', () => {
    const { result, rerender } = renderHook(({ isOpen }) => useCommandPalette({ isOpen }), {
      initialProps: { isOpen: true },
    })

    act(() => {
      result.current.setQuery('test query')
    })

    expect(result.current.query).toBe('test query')

    rerender({ isOpen: false })

    act(() => {})

    // The hook no longer auto-resets the query on close.
    // The component resets it after the close animation via setQuery('').
    expect(result.current.query).toBe('test query')
  })

  it('setQuery can clear the query when called', () => {
    const { result } = renderHook(() => useCommandPalette({ isOpen: true }))

    act(() => {
      result.current.setQuery('test query')
    })
    expect(result.current.query).toBe('test query')

    act(() => {
      result.current.setQuery('')
    })
    expect(result.current.query).toBe('')
  })

  it('exposes items array for the command palette to render', () => {
    const { result } = renderHook(() => useCommandPalette({ isOpen: true }))

    expect(Array.isArray(result.current.items)).toBe(true)
  })

  it('parseInput returns quick-add for "hang out with batman tomorrow"', () => {
    const { result } = renderHook(() => useCommandPalette({ isOpen: true }))

    const parsed = result.current.parseInput('hang out with batman tomorrow')
    expect(parsed.type).toBe('quick-add')
  })

  it('parseInput returns quick-add for "hang out with batman on 23rd of june at 16"', () => {
    const { result } = renderHook(() => useCommandPalette({ isOpen: true }))

    const parsed = result.current.parseInput('hang out with batman on 23rd of june at 16')
    expect(parsed.type).toBe('quick-add')
  })

  it('parseInput returns quick-add for time/duration inputs', () => {
    const { result } = renderHook(() => useCommandPalette({ isOpen: true }))

    expect(result.current.parseInput('lunch at noon').type).toBe('quick-add')
    expect(result.current.parseInput('meeting at 2pm').type).toBe('quick-add')
  })

  it('parseInput returns navigation for plain "tomorrow"', () => {
    const { result } = renderHook(() => useCommandPalette({ isOpen: true }))

    expect(result.current.parseInput('tomorrow').type).toBe('navigation')
  })

  it('items array contains a quick-add item for NLP-style queries', () => {
    const { result } = renderHook(() => useCommandPalette({ isOpen: true }))

    act(() => {
      result.current.setQuery('hang out with batman tomorrow')
    })

    const quickAddItems = result.current.items.filter((i) => i.group === 'quick-add')
    expect(quickAddItems.length).toBeGreaterThanOrEqual(1)
    expect(quickAddItems[0].itemType).toBe('quick-add')
  })
})
