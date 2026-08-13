import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DayEventsPopup } from '../components/DayEventsPopup'
import type { CalendarEvent } from '@/types'

// Local wall-clock fixtures. These used to be UTC instants ('...T10:00:00.000Z')
// with assertions written for the author's UTC+1 machine, so the file only
// passed in that one zone. The component renders in local time, so the fixture
// is built in local time and the expectations are plain wall-clock strings.
const localISO = (h: number, m = 0): string =>
  `2024-03-15T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000`

const mockEvent: CalendarEvent = {
  id: '1',
  title: 'Test Event',
  start: localISO(11),
  end: localISO(12),
  calendarId: 'cal-1',
  isAllDay: false,
  color: '#4285F4',
}

const mockAllDayEvent: CalendarEvent = {
  id: '2',
  title: 'All Day Event',
  start: localISO(0),
  end: localISO(23, 59),
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
  // Local midnight — `new Date('2024-03-15')` is UTC midnight, which is the
  // previous day west of UTC.
  const mockDate = new Date(2024, 2, 15)
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

  it('has role="dialog" for accessibility (Bug #65)', () => {
    render(
      <DayEventsPopup
        date={mockDate}
        events={[mockEvent]}
        position={mockPosition}
        onClose={mockOnClose}
        onEventClick={mockOnEventClick}
      />
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
  })

  it('has aria-label with the date (Bug #65)', () => {
    render(
      <DayEventsPopup
        date={mockDate}
        events={[mockEvent]}
        position={mockPosition}
        onClose={mockOnClose}
        onEventClick={mockOnEventClick}
      />
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-label', 'Events for Friday, March 15')
  })

  it('moves focus into the popup on mount (Bug #65)', () => {
    render(
      <DayEventsPopup
        date={mockDate}
        events={[mockEvent]}
        position={mockPosition}
        onClose={mockOnClose}
        onEventClick={mockOnEventClick}
      />
    )

    // useFocusTrap focuses the first focusable descendant (the first event row)
    // rather than the container itself, so Tab wraps within the dialog.
    const dialog = screen.getByRole('dialog')
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    expect(document.activeElement).not.toBe(dialog)
  })
})
