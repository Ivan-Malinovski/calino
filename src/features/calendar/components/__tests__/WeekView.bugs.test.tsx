import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
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
