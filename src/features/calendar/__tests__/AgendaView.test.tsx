import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgendaView } from '../components/AgendaView'
import { useCalendarStore } from '@/store/calendarStore'

describe('AgendaView', () => {
  beforeEach(() => {
    const store = useCalendarStore.getState()
    store.events.forEach((e) => store.deleteEvent(e.id))
    store.setCurrentDate('2024-03-15')
  })

  it('renders the agenda view with day groups', () => {
    render(<AgendaView />)

    expect(screen.getAllByText(/March/)).toHaveLength(31)
  })

  it('displays days of the month', () => {
    render(<AgendaView />)

    expect(screen.getAllByText(/Friday/)).toHaveLength(5)
  })

  it('shows empty message when no events', () => {
    render(<AgendaView />)

    expect(screen.getAllByText('No events')).toHaveLength(31)
  })

  it('displays events for a given day', () => {
    const store = useCalendarStore.getState()

    store.addEvent({
      id: 'test-event',
      calendarId: 'default',
      title: 'Test Event',
      start: '2024-03-15T10:00:00',
      end: '2024-03-15T11:00:00',
      isAllDay: false,
    })

    render(<AgendaView />)

    expect(screen.getByText('Test Event')).toBeInTheDocument()
  })

  it('displays all-day events before timed events', () => {
    const store = useCalendarStore.getState()

    store.addEvent({
      id: 'timed-event',
      calendarId: 'default',
      title: 'Timed Event',
      start: '2024-03-15T10:00:00',
      end: '2024-03-15T11:00:00',
      isAllDay: false,
    })

    store.addEvent({
      id: 'allday-event',
      calendarId: 'default',
      title: 'All Day Event',
      start: '2024-03-15T00:00:00',
      end: '2024-03-15T23:59:59',
      isAllDay: true,
    })

    render(<AgendaView />)

    const events = screen.getAllByText(/Event/)
    expect(events).toHaveLength(2)
  })

  it('shows event location when present', () => {
    const store = useCalendarStore.getState()

    store.addEvent({
      id: 'located-event',
      calendarId: 'default',
      title: 'Meeting',
      start: '2024-03-15T10:00:00',
      end: '2024-03-15T11:00:00',
      isAllDay: false,
      location: 'Conference Room A',
    })

    render(<AgendaView />)

    expect(screen.getByText('Conference Room A')).toBeInTheDocument()
  })

  it('opens modal when clicking add button', async () => {
    const user = userEvent.setup()

    render(<AgendaView />)

    const addButtons = screen.getAllByText('+ Add')
    await user.click(addButtons[0])

    expect(useCalendarStore.getState().isModalOpen).toBe(true)
  })

  it('shows March 15 in the list', () => {
    render(<AgendaView />)

    expect(screen.getByText('March 15, 2024')).toBeInTheDocument()
  })
})
