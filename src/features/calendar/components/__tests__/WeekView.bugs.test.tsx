import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router'
import { WeekView } from '../WeekView'
import { useCalendarStore } from '@/store/calendarStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { useGestures } from '@/hooks/useGestures'
import { useIsMobile } from '@/hooks/useIsMobile'

vi.mock('@/features/caldav/hooks/useCalDAV')
vi.mock('@/hooks/useGestures')
vi.mock('@/hooks/useIsMobile')

const mockUseCalDAV = vi.mocked(useCalDAV)
const mockUseGestures = vi.mocked(useGestures)
const mockUseIsMobile = vi.mocked(useIsMobile)

const renderWithRouter = (component: React.ReactElement) => {
  return render(<BrowserRouter>{component}</BrowserRouter>)
}

describe('Bug #88: Timed tasks invisible in WeekView', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockUseCalDAV.mockReturnValue({
      accounts: [],
      calendars: [],
      syncState: { status: 'idle', lastSyncAt: null, error: null, pendingChanges: 0 },
      addAccount: vi.fn(),
      removeAccount: vi.fn(),
      syncAccount: vi.fn(),
      syncAll: vi.fn(),
      createEvent: vi.fn(),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
      retryAllFailedSyncs: vi.fn().mockResolvedValue({ succeeded: 0, failed: 0 }),
      createCalendar: vi.fn(),
      updateCalendar: vi.fn(),
      deleteCalendarFromServer: vi.fn(),
    } as unknown as ReturnType<typeof useCalDAV>)

    mockUseGestures.mockReturnValue({
      bind: {},
      gestureState: 'idle',
    })

    mockUseIsMobile.mockReturnValue(false)

    const store = useCalendarStore.getState()
    store.events.forEach((e) => store.deleteEvent(e.id))
    store.calendars.forEach((c) => store.deleteCalendar(c.id))
    store.addCalendar({
      id: 'default',
      name: 'Default Calendar',
      color: '#4285F4',
      isVisible: true,
      isDefault: true,
      showTasksInViews: true,
    })
    store.setCurrentDate('2024-03-15')
  })

  it('does not place an undated task using its technical start property', () => {
    const store = useCalendarStore.getState()
    store.addEvent({
      id: 'task-start-only',
      calendarId: 'default',
      title: 'Task with Start',
      start: '2024-03-15T14:00:00',
      end: '2024-03-15T15:00:00',
      isAllDay: false,
      type: 'task',
    })

    renderWithRouter(<WeekView />)
    expect(screen.queryByText('Task with Start')).not.toBeInTheDocument()
  })

  it('shows timed task with only dueDate property', () => {
    const store = useCalendarStore.getState()
    store.addEvent({
      id: 'task-due-only',
      calendarId: 'default',
      title: 'Task with DueDate',
      start: '2024-03-15T10:00:00',
      end: '2024-03-15T11:00:00',
      isAllDay: false,
      type: 'task',
      dueDate: '2024-03-15',
    })

    renderWithRouter(<WeekView />)
    expect(screen.getByText('Task with DueDate')).toBeInTheDocument()
  })

  it('shows timed task with both start and dueDate', () => {
    const store = useCalendarStore.getState()
    store.addEvent({
      id: 'task-both',
      calendarId: 'default',
      title: 'Task with Both',
      start: '2024-03-15T16:00:00',
      end: '2024-03-15T17:00:00',
      isAllDay: false,
      type: 'task',
      dueDate: '2024-03-15',
    })

    renderWithRouter(<WeekView />)
    expect(screen.getByText('Task with Both')).toBeInTheDocument()
  })

  it('shows all-day tasks with a due date outside the time grid', () => {
    const store = useCalendarStore.getState()
    store.addEvent({
      id: 'task-allday',
      calendarId: 'default',
      title: 'All Day Task',
      start: '2024-03-15T00:00:00',
      end: '2024-03-15T23:59:59',
      isAllDay: true,
      type: 'task',
      dueDate: '2024-03-15',
    })

    renderWithRouter(<WeekView />)
    // All-day task should appear in the tasks footer, not as a timed event
    expect(screen.getByText('All Day Task')).toBeInTheDocument()
  })

  it('shows regular non-task events with start but no dueDate', () => {
    const store = useCalendarStore.getState()
    store.addEvent({
      id: 'event-notask',
      calendarId: 'default',
      title: 'Regular Event',
      start: '2024-03-15T11:00:00',
      end: '2024-03-15T12:00:00',
      isAllDay: false,
      type: 'event',
    })

    renderWithRouter(<WeekView />)
    expect(screen.getByText('Regular Event')).toBeInTheDocument()
  })
})

describe('Bug #120: all-day items in the mobile week view', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockUseCalDAV.mockReturnValue({
      accounts: [],
      calendars: [],
      syncState: { status: 'idle', lastSyncAt: null, error: null, pendingChanges: 0 },
      addAccount: vi.fn(),
      removeAccount: vi.fn(),
      syncAccount: vi.fn(),
      syncAll: vi.fn(),
      createEvent: vi.fn(),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
      retryAllFailedSyncs: vi.fn().mockResolvedValue({ succeeded: 0, failed: 0 }),
      createCalendar: vi.fn(),
      updateCalendar: vi.fn(),
      deleteCalendarFromServer: vi.fn(),
    } as unknown as ReturnType<typeof useCalDAV>)

    mockUseGestures.mockReturnValue({
      bind: {},
      gestureState: 'idle',
    })

    // The bug was mobile-only: the old footer's grid was laid out against the
    // viewport while the mobile day columns are fixed-width and scroll
    // horizontally.
    mockUseIsMobile.mockReturnValue(true)

    const store = useCalendarStore.getState()
    store.events.forEach((e) => store.deleteEvent(e.id))
    store.calendars.forEach((c) => store.deleteCalendar(c.id))
    store.addCalendar({
      id: 'default',
      name: 'Default Calendar',
      color: '#4285F4',
      isVisible: true,
      isDefault: true,
      showTasksInViews: true,
    })
    store.setCurrentDate('2024-03-15')
  })

  const addAllDayTask = (id: string, title: string, dueDate = '2024-03-15') => {
    useCalendarStore.getState().addEvent({
      id,
      calendarId: 'default',
      title,
      start: `${dueDate}T00:00:00`,
      end: `${dueDate}T23:59:59`,
      isAllDay: true,
      type: 'task',
      dueDate,
    })
  }

  const headerFor = (title: string) =>
    screen.getByText(title).closest('[data-component="week-mobile-day-header"]')

  it('renders an all-day task inside its own day header column', () => {
    addAllDayTask('task-allday-mobile', 'All Day Task')

    renderWithRouter(<WeekView />)

    // Being inside the day header is the fix: the header is a child of the
    // horizontally scrolled strip, so it shares the day column's width and
    // position instead of being laid out against the viewport.
    expect(headerFor('All Day Task')).not.toBeNull()
  })

  it('places each all-day task under the day it is due, not an arbitrary column', () => {
    addAllDayTask('task-fri', 'Friday Task', '2024-03-15')
    addAllDayTask('task-sat', 'Saturday Task', '2024-03-16')

    renderWithRouter(<WeekView />)

    expect(headerFor('Friday Task')).toHaveTextContent('15')
    expect(headerFor('Saturday Task')).toHaveTextContent('16')
    expect(headerFor('Friday Task')).not.toBe(headerFor('Saturday Task'))
  })

  it('shows all-day events, which the mobile header previously dropped entirely', () => {
    useCalendarStore.getState().addEvent({
      id: 'event-allday-mobile',
      calendarId: 'default',
      title: 'All Day Event',
      start: '2024-03-15T00:00:00',
      end: '2024-03-15T23:59:59',
      isAllDay: true,
      type: 'event',
    })

    renderWithRouter(<WeekView />)

    expect(headerFor('All Day Event')).not.toBeNull()
  })

  it('renders a spanning all-day event in every covered mobile column', () => {
    useCalendarStore.getState().addEvent({
      id: 'event-span-mobile',
      calendarId: 'default',
      title: 'Span Mobile',
      start: '2024-03-12T00:00:00',
      end: '2024-03-14T23:59:59',
      isAllDay: true,
      type: 'event',
    })

    renderWithRouter(<WeekView />)

    const headers = Array.from(document.querySelectorAll('[data-component="event-card"]'))
      .filter((card) => card.getAttribute('aria-label')?.includes('Span Mobile'))
      .map((card) => card.closest('[data-component="week-mobile-day-header"]'))

    expect(headers).toHaveLength(3)
    expect(headers.map((header) => header?.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Tue'),
        expect.stringContaining('Wed'),
        expect.stringContaining('Thu'),
      ])
    )
  })

  it('keeps timed tasks on the timeline rather than moving them into the header', () => {
    useCalendarStore.getState().addEvent({
      id: 'task-timed-mobile',
      calendarId: 'default',
      title: 'Timed Task',
      start: '2024-03-15T14:00:00',
      end: '2024-03-15T15:00:00',
      isAllDay: false,
      type: 'task',
      dueDate: '2024-03-15T14:00:00',
    })

    renderWithRouter(<WeekView />)

    expect(screen.getByText('Timed Task')).toBeInTheDocument()
    expect(headerFor('Timed Task')).toBeNull()
  })

  it('collapses past two items and expands again from the date block', async () => {
    addAllDayTask('t1', 'Task One')
    addAllDayTask('t2', 'Task Two')
    addAllDayTask('t3', 'Task Three')
    addAllDayTask('t4', 'Task Four')

    renderWithRouter(<WeekView />)

    expect(screen.getByText('Task One')).toBeInTheDocument()
    expect(screen.getByText('Task Two')).toBeInTheDocument()
    expect(screen.queryByText('Task Three')).not.toBeInTheDocument()
    expect(screen.queryByText('Task Four')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Show 2 more all-day items/ }))

    expect(screen.getByText('Task Three')).toBeInTheDocument()
    expect(screen.getByText('Task Four')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Show fewer all-day items/ }))

    expect(screen.queryByText('Task Three')).not.toBeInTheDocument()
  })

  it('puts the overflow control at the bottom of the stack, not under the date', () => {
    addAllDayTask('t1', 'Task One')
    addAllDayTask('t2', 'Task Two')
    addAllDayTask('t3', 'Task Three')

    renderWithRouter(<WeekView />)

    // Under the date it read as a badge on the day number; among the items it
    // reads as the rows it stands in for.
    const toggle = screen.getByRole('button', { name: /Show 1 more all-day item/ })
    expect(toggle).toHaveTextContent('+1 more')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle.previousElementSibling).not.toBeNull()
    expect(toggle.parentElement).toHaveTextContent('Task Two')
  })

  it('leaves days within the limit with no overflow control at all', () => {
    addAllDayTask('t1', 'Task One')
    addAllDayTask('t2', 'Task Two')

    renderWithRouter(<WeekView />)

    expect(screen.getByText('Task One')).toBeInTheDocument()
    expect(screen.getByText('Task Two')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /all-day items/ })).not.toBeInTheDocument()
  })
})
