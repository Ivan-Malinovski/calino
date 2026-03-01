import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DataSettings } from '../components/DataSettings'
import { useCalendarStore } from '@/store/calendarStore'

const mockICALEvent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:test-1@example.com
DTSTART:20260301T100000Z
DTEND:20260301T110000Z
SUMMARY:Test Event
DESCRIPTION:A test event
LOCATION:Test Location
END:VEVENT
BEGIN:VEVENT
UID:test-2@example.com
DTSTART;VALUE=DATE:20260305
DTEND;VALUE=DATE:20260306
SUMMARY:All Day Event
DESCRIPTION:An all day event
END:VEVENT
END:VCALENDAR`

describe('DataSettings - ICS Import', () => {
  beforeEach(() => {
    useCalendarStore.setState({
      events: [],
      calendars: [
        { id: 'default', name: 'My Calendar', color: '#4285F4', isVisible: true, isDefault: true },
      ],
    })
  })

  it('renders import buttons', () => {
    render(<DataSettings />)

    expect(screen.getByRole('button', { name: /import json/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /import ics/i })).toBeInTheDocument()
  })

  it('imports ICS file and adds events to store', async () => {
    const user = userEvent.setup()
    render(<DataSettings />)

    const file = new File([mockICALEvent], 'test.ics', { type: 'text/calendar' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    await user.upload(input, file)

    await waitFor(() => {
      const events = useCalendarStore.getState().events
      expect(events).toHaveLength(2)
      expect(events[0].title).toBe('Test Event')
      expect(events[0].location).toBe('Test Location')
      expect(events[1].title).toBe('All Day Event')
      expect(events[1].isAllDay).toBe(true)
    })
  })

  it('shows success message after importing ICS', async () => {
    const user = userEvent.setup()
    render(<DataSettings />)

    const file = new File([mockICALEvent], 'test.ics', { type: 'text/calendar' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    await user.upload(input, file)

    await waitFor(() => {
      expect(screen.getByText(/imported 2 events from ics/i)).toBeInTheDocument()
    })
  })

  it('shows message when ICS file has no events', async () => {
    const user = userEvent.setup()
    render(<DataSettings />)

    const invalidFile = new File(['invalid content'], 'test.ics', { type: 'text/calendar' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    await user.upload(input, invalidFile)

    await waitFor(() => {
      expect(screen.getByText(/imported 0 events/i)).toBeInTheDocument()
    })
  })

  it('shows error for JSON without events', async () => {
    const user = userEvent.setup()
    render(<DataSettings />)

    const jsonFile = new File([JSON.stringify({ version: 1 })], 'test.json', {
      type: 'application/json',
    })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    await user.upload(input, jsonFile)

    await waitFor(() => {
      expect(screen.getByText(/no events found/i)).toBeInTheDocument()
    })
  })
})
