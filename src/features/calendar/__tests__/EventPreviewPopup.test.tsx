import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EventPreviewPopup } from '../components/EventPreviewPopup'
import { useCalendarStore } from '@/store/calendarStore'
import type { CalendarEvent } from '@/types'

const mockEvent: CalendarEvent = {
  id: 'test-event-1',
  title: 'Test Meeting',
  start: '2024-03-15T10:00:00.000Z',
  end: '2024-03-15T11:00:00.000Z',
  calendarId: 'default',
  isAllDay: false,
  location: 'Conference Room A',
  description: 'This is a test meeting description.',
}

const mockAllDayEvent: CalendarEvent = {
  id: 'test-event-2',
  title: 'All Day Event',
  start: '2024-03-15T00:00:00.000Z',
  end: '2024-03-15T23:59:59.000Z',
  calendarId: 'default',
  isAllDay: true,
}

const mockTask: CalendarEvent = {
  id: 'test-task-1',
  title: 'Test Task',
  start: '2024-03-15T10:00:00.000Z',
  end: '2024-03-15T11:00:00.000Z',
  calendarId: 'default',
  isAllDay: false,
  type: 'task',
  dueDate: '2024-03-15',
  priority: 3,
}

const mockRecurringEvent: CalendarEvent = {
  id: 'test-event-3',
  title: 'Recurring Meeting',
  start: '2024-03-15T10:00:00.000Z',
  end: '2024-03-15T11:00:00.000Z',
  calendarId: 'default',
  isAllDay: false,
  recurrence: {
    frequency: 'weekly',
    interval: 1,
  },
}

describe('EventPreviewPopup', () => {
  const mockPosition = { x: 100, y: 200 }

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
      showTasksInViews: true,
    })
    store.addEvent(mockEvent)
  })

  it('renders event title', () => {
    render(
      <EventPreviewPopup event={mockEvent} position={mockPosition} clickedEventId="test-event-1" />
    )
    expect(screen.getByText('Test Meeting')).toBeInTheDocument()
  })

  it('renders event date', () => {
    render(
      <EventPreviewPopup event={mockEvent} position={mockPosition} clickedEventId="test-event-1" />
    )
    expect(screen.getByText(/15 Mar 2024/)).toBeInTheDocument()
  })

  it('renders event time', () => {
    render(
      <EventPreviewPopup event={mockEvent} position={mockPosition} clickedEventId="test-event-1" />
    )
    expect(screen.getByText(/11:00.*12:00/)).toBeInTheDocument()
  })

  it('renders "All day" for all-day events', () => {
    render(
      <EventPreviewPopup
        event={mockAllDayEvent}
        position={mockPosition}
        clickedEventId="test-event-2"
      />
    )
    expect(screen.getByText('All day')).toBeInTheDocument()
  })

  it('renders location', () => {
    render(
      <EventPreviewPopup event={mockEvent} position={mockPosition} clickedEventId="test-event-1" />
    )
    expect(screen.getByText('Conference Room A')).toBeInTheDocument()
  })

  it('renders description', () => {
    render(
      <EventPreviewPopup event={mockEvent} position={mockPosition} clickedEventId="test-event-1" />
    )
    expect(screen.getByText('This is a test meeting description.')).toBeInTheDocument()
  })

  it('renders recurring event indicator', () => {
    render(
      <EventPreviewPopup
        event={mockRecurringEvent}
        position={mockPosition}
        clickedEventId="test-event-3"
      />
    )
    expect(screen.getByText('Recurring event')).toBeInTheDocument()
  })

  it('renders task with priority', () => {
    render(
      <EventPreviewPopup event={mockTask} position={mockPosition} clickedEventId="test-task-1" />
    )
    expect(screen.getByText('Priority: 3')).toBeInTheDocument()
  })

  it('renders "Open event" button for regular events', () => {
    render(
      <EventPreviewPopup event={mockEvent} position={mockPosition} clickedEventId="test-event-1" />
    )
    expect(screen.getByText('Open event')).toBeInTheDocument()
  })

  it('renders "Open task" button for tasks', () => {
    render(
      <EventPreviewPopup event={mockTask} position={mockPosition} clickedEventId="test-task-1" />
    )
    expect(screen.getByText('Open task')).toBeInTheDocument()
  })

  it('has delete button', () => {
    render(
      <EventPreviewPopup event={mockEvent} position={mockPosition} clickedEventId="test-event-1" />
    )
    expect(screen.getByLabelText('Delete')).toBeInTheDocument()
  })

  it('closes popup when Escape is pressed', () => {
    const store = useCalendarStore.getState()
    store.openPreview('test-event-1', mockPosition)

    render(
      <EventPreviewPopup event={mockEvent} position={mockPosition} clickedEventId="test-event-1" />
    )

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(useCalendarStore.getState().previewEventId).toBeNull()
  })
})
