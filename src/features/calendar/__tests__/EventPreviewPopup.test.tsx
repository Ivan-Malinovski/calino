import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { format, parseISO } from 'date-fns'
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

// Times are chosen 8 hours apart, spanning midnight, so the event lands on
// different local calendar days regardless of the test runner's timezone
// offset (unlike a tight 23:00→01:00 span, which can collapse onto the same
// local day under positive UTC offsets).
const mockOvernightEvent: CalendarEvent = {
  id: 'test-event-overnight',
  title: 'Overnight Event',
  start: '2024-03-13T20:00:00.000Z',
  end: '2024-03-14T04:00:00.000Z',
  calendarId: 'default',
  isAllDay: false,
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
    expect(document.body.querySelector('[data-tooltip]')).toBeInTheDocument()
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

  it('closes popup when Escape is pressed', async () => {
    const store = useCalendarStore.getState()
    store.openPreview('test-event-1', mockPosition)

    render(
      <EventPreviewPopup event={mockEvent} position={mockPosition} clickedEventId="test-event-1" />
    )

    fireEvent.keyDown(document, { key: 'Escape' })

    // R3.10 removed the duplicate immediate-close handler. Escape now
    // triggers animateClose() (150ms close animation), then closePreview()
    // clears previewEventId. Wait for that to settle.
    await waitFor(() => {
      expect(useCalendarStore.getState().previewEventId).toBeNull()
    })
  })

  it('makes title editable when clicked', () => {
    render(
      <EventPreviewPopup event={mockEvent} position={mockPosition} clickedEventId="test-event-1" />
    )

    const title = screen.getByText('Test Meeting')
    fireEvent.click(title)

    expect(screen.getByDisplayValue('Test Meeting')).toBeInTheDocument()
  })

  it('makes date editable when clicked', () => {
    render(
      <EventPreviewPopup event={mockEvent} position={mockPosition} clickedEventId="test-event-1" />
    )

    const date = screen.getByText(/15 Mar 2024/)
    fireEvent.click(date)

    expect(screen.getByDisplayValue('2024-03-15')).toBeInTheDocument()
  })

  it('makes time editable when clicked', () => {
    render(
      <EventPreviewPopup event={mockEvent} position={mockPosition} clickedEventId="test-event-1" />
    )

    const time = screen.getByText(/11:00/)
    fireEvent.click(time)

    expect(screen.getByDisplayValue('11:00')).toBeInTheDocument()
  })

  it('makes location editable when clicked', () => {
    render(
      <EventPreviewPopup event={mockEvent} position={mockPosition} clickedEventId="test-event-1" />
    )

    const location = screen.getByText('Conference Room A')
    fireEvent.click(location)

    expect(screen.getByDisplayValue('Conference Room A')).toBeInTheDocument()
  })

  it('makes description editable when clicked', () => {
    render(
      <EventPreviewPopup event={mockEvent} position={mockPosition} clickedEventId="test-event-1" />
    )

    const description = screen.getByText('This is a test meeting description.')
    fireEvent.click(description)

    expect(screen.getByDisplayValue('This is a test meeting description.')).toBeInTheDocument()
  })

  it('shows save button when changes are made', () => {
    render(
      <EventPreviewPopup event={mockEvent} position={mockPosition} clickedEventId="test-event-1" />
    )

    const title = screen.getByText('Test Meeting')
    fireEvent.click(title)

    const input = screen.getByDisplayValue('Test Meeting')
    fireEvent.change(input, { target: { value: 'Updated Meeting' } })

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
  })

  it('shows add description option when no description exists', () => {
    const eventWithoutDescription: CalendarEvent = {
      ...mockEvent,
      description: undefined,
    }

    render(
      <EventPreviewPopup
        event={eventWithoutDescription}
        position={mockPosition}
        clickedEventId="test-event-1"
      />
    )

    expect(screen.getByText('+ Add description')).toBeInTheDocument()
  })

  it('renders reminder when present', () => {
    const eventWithReminder: CalendarEvent = {
      ...mockEvent,
      reminders: [{ id: '1', minutesBefore: 15, method: 'popup' }],
    }

    render(
      <EventPreviewPopup
        event={eventWithReminder}
        position={mockPosition}
        clickedEventId="test-event-1"
      />
    )

    expect(screen.getByText('15 minutes before')).toBeInTheDocument()
  })

  it('renders travel time when present', () => {
    const eventWithTravel: CalendarEvent = {
      ...mockEvent,
      travelDuration: 30,
    }

    render(
      <EventPreviewPopup
        event={eventWithTravel}
        position={mockPosition}
        clickedEventId="test-event-1"
      />
    )

    expect(screen.getByText('30 min travel')).toBeInTheDocument()
  })

  describe('editing a recurring occurrence', () => {
    // Master starts 2024-03-01; the popup is opened on the 3rd occurrence
    // (2024-03-15) via its instance id `series-<ISO>`.
    const seedSeries = (): CalendarEvent => {
      const store = useCalendarStore.getState()
      const master: CalendarEvent = {
        id: 'series',
        title: 'Weekly Sync',
        start: '2024-03-01T10:00:00.000Z',
        end: '2024-03-01T11:00:00.000Z',
        calendarId: 'default',
        isAllDay: false,
        recurrence: { frequency: 'weekly', interval: 1 },
      }
      store.addEvent(master)
      return master
    }
    const instanceId = 'series-2024-03-15T10:00:00.000Z'

    it('"All events" title edit does NOT move the series anchor (no dropped occurrences)', async () => {
      const master = seedSeries()
      render(
        <EventPreviewPopup event={master} position={mockPosition} clickedEventId={instanceId} />
      )

      fireEvent.click(screen.getByText('Weekly Sync'))
      fireEvent.change(screen.getByDisplayValue('Weekly Sync'), {
        target: { value: 'Renamed Sync' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
      fireEvent.click(screen.getByRole('button', { name: 'All events' }))

      await waitFor(() => {
        const updated = useCalendarStore.getState().events.find((e) => e.id === 'series')
        expect(updated?.title).toBe('Renamed Sync')
        // The anchor stays on the master's original start — earlier occurrences survive.
        expect(updated?.start).toBe('2024-03-01T10:00:00.000Z')
        expect(updated?.recurrence?.endDate).toBeUndefined()
      })
    })

    it('"This and following events" truncates the master and starts a new series at the occurrence', async () => {
      const master = seedSeries()
      render(
        <EventPreviewPopup event={master} position={mockPosition} clickedEventId={instanceId} />
      )

      fireEvent.click(screen.getByText('Weekly Sync'))
      fireEvent.change(screen.getByDisplayValue('Weekly Sync'), {
        target: { value: 'New Series' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
      fireEvent.click(screen.getByRole('button', { name: 'This and following events' }))

      await waitFor(() => {
        const events = useCalendarStore.getState().events
        const original = events.find((e) => e.id === 'series')
        // Master keeps its title/anchor but is truncated to before the split.
        expect(original?.title).toBe('Weekly Sync')
        expect(original?.start).toBe('2024-03-01T10:00:00.000Z')
        expect(original?.recurrence?.endDate).toContain('2024-03-14')
        // A new series carries the new title starting on the clicked occurrence.
        const newSeries = events.find((e) => e.id !== 'series' && e.title === 'New Series')
        expect(newSeries).toBeDefined()
        expect(newSeries?.start).toContain('2024-03-15')
        expect(newSeries?.recurrence?.frequency).toBe('weekly')
      })
    })

    it('"This event only" edits just the occurrence and excludes it from the master', async () => {
      const master = seedSeries()
      render(
        <EventPreviewPopup event={master} position={mockPosition} clickedEventId={instanceId} />
      )

      fireEvent.click(screen.getByText('Weekly Sync'))
      fireEvent.change(screen.getByDisplayValue('Weekly Sync'), {
        target: { value: 'Just This One' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
      fireEvent.click(screen.getByRole('button', { name: 'This event only' }))

      await waitFor(() => {
        const events = useCalendarStore.getState().events
        const original = events.find((e) => e.id === 'series')
        expect(original?.title).toBe('Weekly Sync')
        expect(original?.excludedDates ?? []).not.toContain('2024-03-15T10:00:00.000Z')
        // Exception lands on the clicked occurrence date, not the master's start.
        const exception = events.find((e) => e.id === instanceId)
        expect(exception?.title).toBe('Just This One')
        expect(exception?.start).toContain('2024-03-15')
        expect(exception?.recurrence).toBeUndefined()
      })
    })

    it('re-edits a detached occurrence without showing recurrence options', async () => {
      const master = seedSeries()
      const exception: CalendarEvent = {
        ...master,
        id: instanceId,
        title: 'Detached occurrence',
        start: '2024-03-15T10:00:00.000Z',
        end: '2024-03-15T11:00:00.000Z',
        recurrence: undefined,
        recurrenceId: '2024-03-15T10:00:00.000Z',
        recurrenceMasterId: master.id,
      }
      useCalendarStore.getState().addEvent(exception)
      render(
        <EventPreviewPopup event={exception} position={mockPosition} clickedEventId={instanceId} />
      )

      fireEvent.click(screen.getByText('Detached occurrence'))
      fireEvent.change(screen.getByDisplayValue('Detached occurrence'), {
        target: { value: 'Detached occurrence updated' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

      expect(screen.queryByText('Edit recurring event')).not.toBeInTheDocument()
      await waitFor(() => {
        const events = useCalendarStore.getState().events
        expect(events.find((event) => event.id === master.id)?.title).toBe('Weekly Sync')
        expect(events.find((event) => event.id === instanceId)?.title).toBe(
          'Detached occurrence updated'
        )
      })
    })
  })

  describe('date field changes preserve start<=end (issue #44)', () => {
    // Local-time (test-runner timezone) representations of the fixture, matching
    // what the component itself derives via date-fns `format`/`parseISO`.
    const startLocalDate = format(parseISO(mockOvernightEvent.start), 'yyyy-MM-dd')
    const startLocalTime = format(parseISO(mockOvernightEvent.start), 'HH:mm')
    const endLocalDate = format(parseISO(mockOvernightEvent.end), 'yyyy-MM-dd')
    const endLocalTime = format(parseISO(mockOvernightEvent.end), 'HH:mm')
    const startDisplay = format(parseISO(mockOvernightEvent.start), 'd MMM yyyy')
    const endDisplay = format(parseISO(mockOvernightEvent.end), 'd MMM yyyy')

    it('shifts the end date along with the start date for an overnight event, keeping the range valid', async () => {
      const store = useCalendarStore.getState()
      store.addEvent(mockOvernightEvent)
      render(
        <EventPreviewPopup
          event={mockOvernightEvent}
          position={mockPosition}
          clickedEventId="test-event-overnight"
        />
      )

      fireEvent.click(screen.getByText(startDisplay))
      const shiftedStartDate = format(
        new Date(new Date(`${startLocalDate}T00:00:00`).getTime() + 86400000),
        'yyyy-MM-dd'
      )
      const shiftedEndDate = format(
        new Date(new Date(`${endLocalDate}T00:00:00`).getTime() + 86400000),
        'yyyy-MM-dd'
      )
      fireEvent.change(screen.getByDisplayValue(startLocalDate), {
        target: { value: shiftedStartDate },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

      await waitFor(() => {
        const updated = useCalendarStore
          .getState()
          .events.find((e) => e.id === 'test-event-overnight')
        expect(updated?.start).toBe(`${shiftedStartDate}T${startLocalTime}:00`)
        expect(updated?.end).toBe(`${shiftedEndDate}T${endLocalTime}:00`)
      })
    })

    it('refuses to save when the end date is edited to a date before the start date', async () => {
      const store = useCalendarStore.getState()
      store.addEvent(mockOvernightEvent)
      render(
        <EventPreviewPopup
          event={mockOvernightEvent}
          position={mockPosition}
          clickedEventId="test-event-overnight"
        />
      )

      fireEvent.click(screen.getByText(endDisplay))
      const beforeStartDate = format(
        new Date(new Date(`${startLocalDate}T00:00:00`).getTime() - 86400000),
        'yyyy-MM-dd'
      )
      fireEvent.change(screen.getByDisplayValue(endLocalDate), {
        target: { value: beforeStartDate },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

      await waitFor(() => {
        const updated = useCalendarStore
          .getState()
          .events.find((e) => e.id === 'test-event-overnight')
        // The invalid edit must not be persisted — start/end stay as originally seeded.
        expect(updated?.start).toBe(mockOvernightEvent.start)
        expect(updated?.end).toBe(mockOvernightEvent.end)
      })
    })
  })
})
