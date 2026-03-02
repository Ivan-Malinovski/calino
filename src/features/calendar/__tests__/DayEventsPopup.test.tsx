import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DayEventsPopup } from '../components/DayEventsPopup'
import type { CalendarEvent } from '@/types'

const mockEvent: CalendarEvent = {
  id: '1',
  title: 'Test Event',
  start: '2024-03-15T10:00:00.000Z',
  end: '2024-03-15T11:00:00.000Z',
  calendarId: 'cal-1',
  isAllDay: false,
  color: '#4285F4',
}

const mockAllDayEvent: CalendarEvent = {
  id: '2',
  title: 'All Day Event',
  start: '2024-03-15T00:00:00.000Z',
  end: '2024-03-15T23:59:59.000Z',
  calendarId: 'cal-1',
  isAllDay: true,
}

const mockEventWithLocation: CalendarEvent = {
  ...mockEvent,
  id: '3',
  title: 'Event with Location',
  location: 'Conference Room A',
}

describe('DayEventsPopup', () => {
  const mockOnClose = vi.fn()
  const mockOnEventClick = vi.fn()
  const mockDate = new Date('2024-03-15')
  const mockPosition = { x: 100, y: 200 }

  beforeEach(() => {
    mockOnClose.mockClear()
    mockOnEventClick.mockClear()
  })

  it('renders date header with correct format', () => {
    render(
      <DayEventsPopup
        date={mockDate}
        events={[mockEvent]}
        position={mockPosition}
        onClose={mockOnClose}
        onEventClick={mockOnEventClick}
      />
    )

    expect(screen.getByText('Friday, March 15')).toBeInTheDocument()
  })

  it('renders event count', () => {
    render(
      <DayEventsPopup
        date={mockDate}
        events={[mockEvent, mockAllDayEvent]}
        position={mockPosition}
        onClose={mockOnClose}
        onEventClick={mockOnEventClick}
      />
    )

    expect(screen.getByText('2 events')).toBeInTheDocument()
  })

  it('renders singular event count', () => {
    render(
      <DayEventsPopup
        date={mockDate}
        events={[mockEvent]}
        position={mockPosition}
        onClose={mockOnClose}
        onEventClick={mockOnEventClick}
      />
    )

    expect(screen.getByText('1 event')).toBeInTheDocument()
  })

  it('renders event title', () => {
    render(
      <DayEventsPopup
        date={mockDate}
        events={[mockEvent]}
        position={mockPosition}
        onClose={mockOnClose}
        onEventClick={mockOnEventClick}
      />
    )

    expect(screen.getByText('Test Event')).toBeInTheDocument()
  })

  it('renders event time for non-all-day events', () => {
    render(
      <DayEventsPopup
        date={mockDate}
        events={[mockEvent]}
        position={mockPosition}
        onClose={mockOnClose}
        onEventClick={mockOnEventClick}
      />
    )

    expect(screen.getByText(/11:00 - 12:00/)).toBeInTheDocument()
  })

  it('renders All day for all-day events', () => {
    render(
      <DayEventsPopup
        date={mockDate}
        events={[mockAllDayEvent]}
        position={mockPosition}
        onClose={mockOnClose}
        onEventClick={mockOnEventClick}
      />
    )

    expect(screen.getByText('All day')).toBeInTheDocument()
  })

  it('renders event location', () => {
    render(
      <DayEventsPopup
        date={mockDate}
        events={[mockEventWithLocation]}
        position={mockPosition}
        onClose={mockOnClose}
        onEventClick={mockOnEventClick}
      />
    )

    expect(screen.getByText('Conference Room A')).toBeInTheDocument()
  })

  it('calls onEventClick when event is clicked', () => {
    render(
      <DayEventsPopup
        date={mockDate}
        events={[mockEvent]}
        position={mockPosition}
        onClose={mockOnClose}
        onEventClick={mockOnEventClick}
      />
    )

    fireEvent.click(screen.getByText('Test Event'))

    expect(mockOnEventClick).toHaveBeenCalledWith(mockEvent)
  })

  it('calls onClose when Escape is pressed', () => {
    render(
      <DayEventsPopup
        date={mockDate}
        events={[mockEvent]}
        position={mockPosition}
        onClose={mockOnClose}
        onEventClick={mockOnEventClick}
      />
    )

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(mockOnClose).toHaveBeenCalled()
  })

  it('renders multiple events', () => {
    render(
      <DayEventsPopup
        date={mockDate}
        events={[mockEvent, mockAllDayEvent, mockEventWithLocation]}
        position={mockPosition}
        onClose={mockOnClose}
        onEventClick={mockOnEventClick}
      />
    )

    expect(screen.getByText('Test Event')).toBeInTheDocument()
    expect(screen.getByText('All Day Event')).toBeInTheDocument()
    expect(screen.getByText('Event with Location')).toBeInTheDocument()
  })
})
