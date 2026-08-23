import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from '@testing-library/react'
import { renderHook } from '@/test/caldavRender'
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
      pendingEventPrefill: null,
      importQueue: [],
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
      completeTaskOccurrence: vi.fn(),
      deleteEvent: vi.fn(),
      duplicateEvent: vi.fn(),
      addBrokenEvent: vi.fn(),
      removeBrokenEvent: vi.fn(),
      fixBrokenEvent: vi.fn(),
      addDuplicateUidIssue: vi.fn(),
      clearDuplicateUidIssues: vi.fn(),
      removeDuplicateUidResource: vi.fn(),
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
      setPendingEventPrefill: vi.fn(),
      startImportQueue: vi.fn(),
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
      secondaryTimezoneEnabled: false,
      secondaryTimezone: null,
      secondaryTimezoneLabel: null,
      dateFormat: 'yyyy-MM-dd',
      timeFormat: '12h',
      firstDayOfWeek: 0,
      defaultDuration: 60,
      defaultView: 'month',
      showWeekNumbers: false,
      showWeekNumbersInSidebar: false,
      eventDensity: 'comfortable',
      mapProvider: 'google',
      defaultReminderMinutes: 15,
      defaultEventColor: '#4285F4',
      enableDesktopNotifications: false,
      enableCalendarMirror: false,
      enableSoundAlerts: false,
      enableHaptics: true,
      conflictResolution: 'local-wins',
      compactRecurringEvents: false,
      compressPastWeeks: false,
      hasCompletedOnboarding: false,
      themeMode: 'auto',
      lightTheme: 'default',
      darkTheme: 'default',
      mochaAccent: '#89b4fa',
      eventTint: 'subtle',
      adjustableTheme: {
        light: {
          canvas: '#f7f4ee',
          panel: '#fffdfa',
          accent: '#b07d4f',
          accentContrast: '#ffffff',
          text: '#2c2823',
          mutedText: '#70695f',
          border: '#e4ded4',
          fontFamily: 'system',
          cornerRadius: 10,
          density: 100,
          shadowStrength: 70,
          eventTint: 10,
        },
        dark: {
          canvas: '#17181b',
          panel: '#22252a',
          accent: '#87a7ff',
          accentContrast: '#16181d',
          text: '#eef1f5',
          mutedText: '#a7afba',
          border: '#3b414b',
          fontFamily: 'system',
          cornerRadius: 10,
          density: 100,
          shadowStrength: 60,
          eventTint: 18,
        },
      },
      caldavDebugMode: false,
      hideCompletedTasksInMonthView: true,
      monthViewEventLimit: 3,
      sidebarWidth: 300,
      sidebarCollapsed: false,
      agendaSidebarOpen: false,
      agendaSidebarWidth: 340,
      agendaBelowMonthEnabled: true,
      monthAgendaGridRatio: 0.4,
      monthAgendaSplitRatio: 0.65,
      fadePastDaysInAgenda: 'never',
      viewOrder: ['month', 'week', 'agenda', 'year', 'day', 'todo', 'journal', 'contacts'],
      viewDividerAfter: 'day',
      useCategoryColors: true,
      showEventIcons: true,
      journalEnabled: false,
      contactsEnabled: false,
      taskDueDateReminders: true,
      overdueTaskBadge: false,
      taskCollapseOverrides: {},
      updateSettings: vi.fn(),
      resetSettings: vi.fn(),
    }
    return selector(state)
  }),
  selectThemeMode: (state: SettingsStore) => state.themeMode,
  selectUpdateSettings: (state: SettingsStore) => state.updateSettings,
}))

vi.mock('react-router', () => ({
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

  describe('natural-event routing improvements', () => {
    const quickAdd = (q: string) => result0.current.parseInput(q).type

    let result0: { current: ReturnType<typeof useCommandPalette> }

    beforeEach(() => {
      const { result } = renderHook(() => useCommandPalette({ isOpen: true }))
      result0 = result
    })

    it('routes bare-noun events to quick-add (lunch/gym/meeting)', () => {
      expect(quickAdd('lunch')).toBe('quick-add')
      expect(quickAdd('gym')).toBe('quick-add')
      expect(quickAdd('meeting')).toBe('quick-add')
    })

    it('routes task-prefixed phrases to quick-add', () => {
      expect(quickAdd('todo buy milk')).toBe('quick-add')
      expect(quickAdd('task call mom')).toBe('quick-add')
      expect(quickAdd('remind me to send email')).toBe('quick-add')
    })

    it('does not false-reject a navigation-verb phrase that clearly has event time', () => {
      expect(quickAdd('go to gym at 5pm')).toBe('quick-add')
      expect(quickAdd('show the demo on friday at 2pm')).toBe('quick-add')
    })

    it('does not misroute a month-name substring inside an event phrase to navigation', () => {
      // "may" as a verb, not the month of May.
      expect(quickAdd('may I have a meeting')).toBe('quick-add')
      // "december" embedded in another word must not trigger December navigation.
      expect(quickAdd('the decemberists concert')).toBe('quick-add')
    })

    it('still navigates for a bare month/day name', () => {
      expect(quickAdd('march')).toBe('navigation')
      expect(quickAdd('monday')).toBe('navigation')
      expect(quickAdd('2027')).toBe('navigation')
    })

    it('navigates on a half-typed month or day name', () => {
      // Prefix matching keeps mid-typing navigation working: the value is
      // always shorter than the name it matches, so an event phrase that
      // merely starts with a date word cannot reach this branch.
      expect(quickAdd('dece')).toBe('navigation')
      expect(quickAdd('marc')).toBe('navigation')
      expect(quickAdd('thur')).toBe('navigation')
      expect(quickAdd('septemb')).toBe('navigation')
    })

    it('does not let a prefix match hijack a longer event phrase', () => {
      expect(quickAdd('may i have a meeting')).toBe('quick-add')
      expect(quickAdd('march to the gym at 6pm')).toBe('quick-add')
    })

    it('attaches the parsed NLP result to avoid re-parsing', () => {
      const parsed = result0.current.parseInput('lunch tomorrow at 1pm')
      expect(parsed.type).toBe('quick-add')
      expect(parsed.nlp).toBeDefined()
      expect(parsed.nlp?.title).toBe('Lunch')
    })
  })
})
