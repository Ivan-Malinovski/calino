import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EventCard } from '../components/EventCard'
import { useCalendarStore } from '@/store/calendarStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import type { CalendarEvent } from '@/types'

vi.mock('@/features/caldav/hooks/useCalDAV')

const mockUseCalDAV = vi.mocked(useCalDAV)

const mockEvent: CalendarEvent = {
  id: 'test-event-1',
  calendarId: 'default',
  title: 'Test Meeting',
  start: '2024-03-15T10:00:00',
  end: '2024-03-15T11:00:00',
  isAllDay: false,
}

describe('EventCard', () => {
  const mockDeleteCalDAVEvent = vi.fn().mockResolvedValue(undefined)

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
      deleteEvent: mockDeleteCalDAVEvent,
    } as unknown as ReturnType<typeof useCalDAV>)

    const store = useCalendarStore.getState()
    store.events.forEach((e) => store.deleteEvent(e.id))
    store.calendars.forEach((c) => store.deleteCalendar(c.id))
    store.addCalendar({
      id: 'default',
      name: 'Default Calendar',
      color: '#4285F4',
      isVisible: true,
      isDefault: true,
    })
  })

  it('renders event title', () => {
    render(<EventCard event={mockEvent} />)
    expect(screen.getByText('Test Meeting')).toBeInTheDocument()
  })

  it('renders event time when not all-day', () => {
    render(<EventCard event={mockEvent} />)
    expect(screen.getByText(/10:00.*11:00/)).toBeInTheDocument()
  })

  it('renders "All day" for all-day events', () => {
    const allDayEvent: CalendarEvent = {
      ...mockEvent,
      isAllDay: true,
    }
    render(<EventCard event={allDayEvent} />)
    expect(screen.getByText('All day')).toBeInTheDocument()
  })

  it('renders location when present', () => {
    const eventWithLocation: CalendarEvent = {
      ...mockEvent,
      location: 'Conference Room A',
    }
    render(<EventCard event={eventWithLocation} />)
    expect(screen.getByText('Conference Room A')).toBeInTheDocument()
  })

  it('does not show time in compact mode', () => {
    render(<EventCard event={mockEvent} compact />)
    expect(screen.queryByText(/10:00/)).not.toBeInTheDocument()
  })

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup()
    const handleClick = vi.fn()

    render(<EventCard event={mockEvent} onClick={handleClick} />)

    await user.click(screen.getByText('Test Meeting'))

    expect(handleClick).toHaveBeenCalledWith(mockEvent)
  })

  it('deletes event from CalDAV when using context menu delete', async () => {
    const user = userEvent.setup()
    const store = useCalendarStore.getState()
    store.addEvent(mockEvent)

    render(<EventCard event={mockEvent} />)

    // Trigger context menu (right-click)
    const card = screen.getByText('Test Meeting')
    fireEvent.contextMenu(card)

    // Click delete in context menu
    const deleteButton = screen.getByText('Delete')
    await user.click(deleteButton)

    expect(mockDeleteCalDAVEvent).toHaveBeenCalledWith('default', 'test-event-1')
  })
})
