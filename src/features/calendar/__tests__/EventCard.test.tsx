import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EventCard } from '../components/EventCard'
import { useCalendarStore } from '@/store/calendarStore'
import type { CalendarEvent } from '@/types'

const mockEvent: CalendarEvent = {
  id: 'test-event-1',
  calendarId: 'default',
  title: 'Test Meeting',
  start: '2024-03-15T10:00:00',
  end: '2024-03-15T11:00:00',
  isAllDay: false,
}

describe('EventCard', () => {
  beforeEach(() => {
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
})
