import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { AttendeeSection } from '../AttendeeSection'
import type { CalendarAttendee, CalendarOrganizer } from '@/types'

function renderAttendeeSection(
  overrides: {
    attendees?: CalendarAttendee[]
    organizer?: CalendarOrganizer
    onAttendeesChange?: (a: CalendarAttendee[]) => void
  } = {}
) {
  const defaultProps = {
    attendees: overrides.attendees ?? [],
    onAttendeesChange: overrides.onAttendeesChange ?? vi.fn(),
    organizer: overrides.organizer,
  }
  return { ...render(<AttendeeSection {...defaultProps} />), ...defaultProps }
}

describe('AttendeeSection', () => {
  it('renders the attendees label', () => {
    renderAttendeeSection()
    expect(screen.getByText('Attendees')).toBeInTheDocument()
  })

  it('renders empty state with no attendees', () => {
    renderAttendeeSection()
    expect(screen.getByPlaceholderText('Add attendee email...')).toBeInTheDocument()
    expect(screen.getByText('Add')).toBeInTheDocument()
  })

  it('renders existing attendees', () => {
    const attendees: CalendarAttendee[] = [
      { email: 'alice@example.com', name: 'Alice', partstat: 'ACCEPTED', role: 'REQ-PARTICIPANT' },
      {
        email: 'bob@example.com',
        name: 'Bob',
        partstat: 'NEEDS-ACTION',
        role: 'REQ-PARTICIPANT',
        rsvp: true,
      },
    ]
    renderAttendeeSection({ attendees })

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('bob@example.com')).toBeInTheDocument()
  })

  it('displays partstat badges with correct labels', () => {
    const attendees: CalendarAttendee[] = [
      { email: 'a@test.com', partstat: 'ACCEPTED' },
      { email: 'b@test.com', partstat: 'DECLINED' },
      { email: 'c@test.com', partstat: 'TENTATIVE' },
      { email: 'd@test.com', partstat: 'NEEDS-ACTION' },
      { email: 'e@test.com', partstat: 'DELEGATED' },
    ]
    renderAttendeeSection({ attendees })

    expect(screen.getByTestId('partstat-ACCEPTED')).toHaveTextContent('Accepted')
    expect(screen.getByTestId('partstat-DECLINED')).toHaveTextContent('Declined')
    expect(screen.getByTestId('partstat-TENTATIVE')).toHaveTextContent('Tentative')
    expect(screen.getByTestId('partstat-NEEDS-ACTION')).toHaveTextContent('Pending')
    expect(screen.getByTestId('partstat-DELEGATED')).toHaveTextContent('Delegated')
  })

  it('displays organizer badge', () => {
    const organizer: CalendarOrganizer = { email: 'organizer@test.com', name: 'Organizer' }
    renderAttendeeSection({ organizer })

    // Both the label and name contain "Organizer" — verify via the email and the container
    expect(screen.getByText('organizer@test.com')).toBeInTheDocument()
    const badgeContainer = screen.getByText('organizer@test.com').closest('div')!
    expect(within(badgeContainer).getAllByText('Organizer')).toHaveLength(2) // label + name
  })

  it('does not display organizer badge when organizer is undefined', () => {
    renderAttendeeSection()
    expect(screen.queryByText('Organizer')).not.toBeInTheDocument()
  })

  it('adds an attendee by email on button click', async () => {
    const user = userEvent.setup()
    const onAttendeesChange = vi.fn()
    renderAttendeeSection({ onAttendeesChange })

    const input = screen.getByPlaceholderText('Add attendee email...')
    await user.type(input, 'new@example.com')
    await user.click(screen.getByText('Add'))

    expect(onAttendeesChange).toHaveBeenCalledWith([
      { email: 'new@example.com', role: 'REQ-PARTICIPANT', partstat: 'NEEDS-ACTION', rsvp: true },
    ])
  })

  it('adds an attendee by pressing Enter', async () => {
    const user = userEvent.setup()
    const onAttendeesChange = vi.fn()
    renderAttendeeSection({ onAttendeesChange })

    const input = screen.getByPlaceholderText('Add attendee email...')
    await user.type(input, 'enter@example.com{Enter}')

    expect(onAttendeesChange).toHaveBeenCalledWith([
      { email: 'enter@example.com', role: 'REQ-PARTICIPANT', partstat: 'NEEDS-ACTION', rsvp: true },
    ])
  })

  it('does not add duplicate emails', async () => {
    const user = userEvent.setup()
    const onAttendeesChange = vi.fn()
    const attendees: CalendarAttendee[] = [{ email: 'existing@example.com', partstat: 'ACCEPTED' }]
    renderAttendeeSection({ attendees, onAttendeesChange })

    const input = screen.getByPlaceholderText('Add attendee email...')
    await user.type(input, 'existing@example.com{Enter}')

    expect(onAttendeesChange).not.toHaveBeenCalled()
    expect(screen.getByText('Already added')).toBeInTheDocument()
  })

  it('rejects invalid email format', async () => {
    const user = userEvent.setup()
    const onAttendeesChange = vi.fn()
    renderAttendeeSection({ onAttendeesChange })

    const input = screen.getByPlaceholderText('Add attendee email...')
    await user.type(input, 'not-an-email{Enter}')

    expect(onAttendeesChange).not.toHaveBeenCalled()
    expect(screen.getByText('Invalid email address')).toBeInTheDocument()
  })

  it('removes an attendee', async () => {
    const user = userEvent.setup()
    const onAttendeesChange = vi.fn()
    const attendees: CalendarAttendee[] = [
      { email: 'remove@example.com', name: 'Remove Me', partstat: 'ACCEPTED' },
    ]
    renderAttendeeSection({ attendees, onAttendeesChange })

    await user.click(screen.getByLabelText('Remove Remove Me'))

    expect(onAttendeesChange).toHaveBeenCalledWith([])
  })

  it('removes attendee by email when no name is set', async () => {
    const user = userEvent.setup()
    const onAttendeesChange = vi.fn()
    const attendees: CalendarAttendee[] = [{ email: 'noname@example.com', partstat: 'ACCEPTED' }]
    renderAttendeeSection({ attendees, onAttendeesChange })

    await user.click(screen.getByLabelText('Remove noname@example.com'))

    expect(onAttendeesChange).toHaveBeenCalledWith([])
  })

  it('shows initials from email when no name is provided', () => {
    const attendees: CalendarAttendee[] = [{ email: 'test@example.com', partstat: 'ACCEPTED' }]
    renderAttendeeSection({ attendees })

    expect(screen.getByText('TE')).toBeInTheDocument()
  })

  it('shows initials from name when name is provided', () => {
    const attendees: CalendarAttendee[] = [
      { email: 'alice@example.com', name: 'Alice Brown', partstat: 'ACCEPTED' },
    ]
    renderAttendeeSection({ attendees })

    expect(screen.getByText('AB')).toBeInTheDocument()
  })

  it('shows display name from email local part when no name', () => {
    const attendees: CalendarAttendee[] = [{ email: 'john.doe@example.com', partstat: 'ACCEPTED' }]
    renderAttendeeSection({ attendees })

    expect(screen.getByText('John Doe')).toBeInTheDocument()
  })

  it('clears input error when user starts typing', async () => {
    const user = userEvent.setup()
    renderAttendeeSection()

    const input = screen.getByPlaceholderText('Add attendee email...')
    await user.type(input, 'bad{Enter}')
    expect(screen.getByText('Invalid email address')).toBeInTheDocument()

    await user.type(input, 'x')
    expect(screen.queryByText('Invalid email address')).not.toBeInTheDocument()
  })

  it('does not add empty input', async () => {
    const user = userEvent.setup()
    const onAttendeesChange = vi.fn()
    renderAttendeeSection({ onAttendeesChange })

    const addButton = screen.getByText('Add')
    expect(addButton).toBeDisabled()

    await user.click(addButton)
    expect(onAttendeesChange).not.toHaveBeenCalled()
  })

  it('displays multiple attendees with different partstat statuses', () => {
    const attendees: CalendarAttendee[] = [
      { email: 'a@test.com', name: 'Alice', partstat: 'ACCEPTED' },
      { email: 'b@test.com', name: 'Bob', partstat: 'DECLINED' },
      { email: 'c@test.com', name: 'Carol', partstat: 'TENTATIVE' },
    ]
    renderAttendeeSection({ attendees })

    const rows = screen.getAllByText(/@test\.com/)
    expect(rows).toHaveLength(3)
  })
})
