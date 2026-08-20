import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from '@testing-library/react'
import { renderHook } from '@/test/caldavRender'
import type { CalendarEvent, CalendarStore, SettingsStore } from '@/types'

/**
 * The palette searches `state.events`, which holds series masters — expansion
 * only happens inside `getEventsForDateRange`. So a recurring item used to be
 * shown at its DTSTART (the *first* occurrence, often years old), and a
 * detached override appeared as a second near-identical row beside its series.
 */
const openModal = vi.fn()

let mockEvents: CalendarEvent[] = []

vi.mock('@/store/calendarStore', () => ({
  useCalendarStore: vi.fn((selector: (state: CalendarStore) => unknown) => {
    const state = {
      events: mockEvents,
      calendars: [],
      categories: [],
      currentDate: '2026-08-04',
      currentView: 'month',
      openModal,
      openJournalModal: vi.fn(),
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
      viewOrder: ['month'],
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

const master: CalendarEvent = {
  id: 'm1',
  calendarId: 'cal1',
  title: 'Standup',
  start: '2024-01-02T09:00:00.000Z',
  end: '2024-01-02T09:15:00.000Z',
  isAllDay: false,
  // UTC so the assertions hold in both vitest projects: since issue #126, a
  // no-TZID timed series expands in the device zone and 09:00Z would shift.
  timezone: 'UTC',
  rruleString: 'FREQ=WEEKLY;BYDAY=TU',
}

const search = (query: string) => {
  const { result } = renderHook(() => useCommandPalette({ isOpen: true }))
  act(() => result.current.setQuery(query))
  return result.current.items.filter((i) => i.itemType === 'event')
}

describe('command palette — recurring results', () => {
  beforeEach(() => {
    openModal.mockClear()
    mockEvents = [master]
    // A Tuesday, after the series' 09:00 slot.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-04T12:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('reads the clock rather than the calendar it was written on', () => {
    // Daily, so the expectation doesn't depend on knowing a weekday: proves the
    // walk starts from the current instant and not from some fixed date.
    mockEvents = [{ ...master, rruleString: 'FREQ=DAILY' }]
    vi.setSystemTime(new Date('2027-05-20T23:00:00Z'))
    const [row] = search('Standup')
    expect((row.data as { start: string }).start).toBe('2027-05-21T09:00:00.000Z')
  })

  it('dates a series at its next occurrence, not its DTSTART', () => {
    const [row] = search('Standup')
    expect((row.data as { start: string }).start).toBe('2026-08-11T09:00:00.000Z')
  })

  it('opens that occurrence, so the modal can resolve it back to the master', () => {
    const [row] = search('Standup')
    // The `${masterId}-${occurrence}` shape `findEventById` understands.
    expect(row.id).toBe('event-m1-2026-08-11T09:00:00.000Z')
  })

  it('labels the row with the rule so recurrence is visible', () => {
    const [row] = search('Standup')
    expect((row.data as { recurrence?: string }).recurrence).toMatch(/every week/i)
  })

  it('leaves a non-recurring event alone', () => {
    mockEvents = [{ ...master, id: 'e1', rruleString: undefined }]
    const [row] = search('Standup')
    expect(row.id).toBe('event-e1')
    expect((row.data as { start: string }).start).toBe('2024-01-02T09:00:00.000Z')
    expect((row.data as { recurrence?: string }).recurrence).toBeUndefined()
  })

  it('shows one row per series, folding in a matching override', () => {
    mockEvents = [
      master,
      {
        ...master,
        id: 'm1-override',
        recurrenceMasterId: 'm1',
        recurrenceId: '2026-09-01T09:00:00.000Z',
        start: '2026-09-01T10:00:00.000Z',
        end: '2026-09-01T10:15:00.000Z',
        rruleString: undefined,
      },
    ]
    const rows = search('Standup')
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('event-m1-2026-08-11T09:00:00.000Z')
  })

  it('keeps an override that matches on its own, away from its series', () => {
    mockEvents = [
      master,
      {
        ...master,
        id: 'm1-override',
        title: 'Standup — retro edition',
        recurrenceMasterId: 'm1',
        recurrenceId: '2026-09-01T09:00:00.000Z',
        start: '2026-09-01T10:00:00.000Z',
        rruleString: undefined,
      },
    ]
    // Matches only the override, so the series never enters the candidate set
    // and the override is the row.
    const rows = search('retro')
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('event-m1-override')
  })

  it('shows the last occurrence of a series that has finished', () => {
    mockEvents = [{ ...master, rruleString: 'FREQ=WEEKLY;BYDAY=TU;COUNT=3' }]
    const [row] = search('Standup')
    expect((row.data as { start: string }).start).toBe('2024-01-16T09:00:00.000Z')
  })

  it('dates a recurring task at its next occurrence too', () => {
    mockEvents = [{ ...master, type: 'task', title: 'Water the plants' }]
    const [row] = search('plants')
    expect((row.data as { start: string }).start).toBe('2026-08-11T09:00:00.000Z')
    expect(row.group).toBe('task')
  })
})
