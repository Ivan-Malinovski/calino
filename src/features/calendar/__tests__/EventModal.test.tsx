import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EventModal } from '../components/EventModal'
import { useCalendarStore } from '@/store/calendarStore'

describe('EventModal', () => {
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
    store.closeModal()
  })

  it('does not render when modal is closed', () => {
    render(<EventModal />)
    expect(screen.queryByRole('heading', { name: /create event/i })).not.toBeInTheDocument()
  })

  it('renders create event title when creating new event', () => {
    const store = useCalendarStore.getState()
    store.openModal()

    render(<EventModal />)
    expect(screen.getByRole('heading', { name: /create event/i })).toBeInTheDocument()
  })

  it('renders edit event title when editing', () => {
    const store = useCalendarStore.getState()
    store.addEvent({
      id: 'edit-test',
      calendarId: 'default',
      title: 'Existing Event',
      start: '2024-03-15T10:00:00',
      end: '2024-03-15T11:00:00',
      isAllDay: false,
    })
    store.setSelectedEventId('edit-test')
    store.openModal()

    render(<EventModal />)
    expect(screen.getByRole('heading', { name: /edit event/i })).toBeInTheDocument()
  })

  it('shows delete button when editing', () => {
    const store = useCalendarStore.getState()
    store.addEvent({
      id: 'edit-test',
      calendarId: 'default',
      title: 'Existing Event',
      start: '2024-03-15T10:00:00',
      end: '2024-03-15T11:00:00',
      isAllDay: false,
    })
    store.setSelectedEventId('edit-test')
    store.openModal()

    render(<EventModal />)
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
  })

  it('does not show delete button when creating', () => {
    const store = useCalendarStore.getState()
    store.openModal()

    render(<EventModal />)
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
  })

  it('shows all-day checkbox', () => {
    const store = useCalendarStore.getState()
    store.openModal()

    render(<EventModal />)
    expect(screen.getByRole('checkbox')).toBeInTheDocument()
  })

  it('shows recurrence dropdown', () => {
    const store = useCalendarStore.getState()
    store.openModal()

    render(<EventModal />)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('renders title input', () => {
    const store = useCalendarStore.getState()
    store.openModal()

    render(<EventModal />)
    expect(screen.getByPlaceholderText('Title')).toBeInTheDocument()
  })

  it('renders location input', () => {
    const store = useCalendarStore.getState()
    store.openModal()

    render(<EventModal />)
    expect(screen.getByPlaceholderText('Location')).toBeInTheDocument()
  })

  it('renders description textarea', () => {
    const store = useCalendarStore.getState()
    store.openModal()

    render(<EventModal />)
    expect(screen.getByPlaceholderText('Description')).toBeInTheDocument()
  })

  it('renders cancel and create buttons', () => {
    const store = useCalendarStore.getState()
    store.openModal()

    render(<EventModal />)
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument()
  })
})
