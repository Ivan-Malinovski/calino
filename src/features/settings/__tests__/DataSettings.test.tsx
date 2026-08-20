import { describe, it, expect, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render } from '@/test/caldavRender'
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
        {
          id: 'default',
          name: 'My Calendar',
          color: '#4285F4',
          isVisible: true,
          isDefault: true,
          showTasksInViews: true,
        },
      ],
    })
  })

  it('renders import button', () => {
    render(<DataSettings />)

    // Both calendar and contacts import buttons exist
    expect(screen.getByTestId('import-calendar-input')).toBeInTheDocument()
    expect(screen.getByTestId('import-contacts-input')).toBeInTheDocument()
  })

  it('shows a calendar picker before importing, defaulting to the default calendar', async () => {
    const user = userEvent.setup()
    render(<DataSettings />)

    const file = new File([mockICALEvent], 'test.ics', { type: 'text/calendar' })
    const input = screen.getByTestId('import-calendar-input') as HTMLInputElement

    await user.upload(input, file)

    await waitFor(() => {
      expect(screen.getByTestId('ics-import-calendar-select')).toBeInTheDocument()
    })
    expect(useCalendarStore.getState().events).toHaveLength(0)
    expect(screen.getByTestId('ics-import-calendar-select')).toHaveValue('default')
    expect(screen.getByText(/import 2 events/i)).toBeInTheDocument()
  })

  it('imports ICS file into the selected existing calendar', async () => {
    const user = userEvent.setup()
    render(<DataSettings />)

    const file = new File([mockICALEvent], 'test.ics', { type: 'text/calendar' })
    const input = screen.getByTestId('import-calendar-input') as HTMLInputElement
    await user.upload(input, file)

    await waitFor(() => {
      expect(screen.getByTestId('ics-import-calendar-select')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('ics-import-confirm'))

    await waitFor(() => {
      const events = useCalendarStore.getState().events
      expect(events).toHaveLength(2)
      expect(events[0].title).toBe('Test Event')
      expect(events[0].location).toBe('Test Location')
      expect(events[0].calendarId).toBe('default')
      expect(events[1].title).toBe('All Day Event')
      expect(events[1].isAllDay).toBe(true)
    })
    expect(screen.getByText(/imported 2 events/i)).toBeInTheDocument()
  })

  it('creates a new calendar for the import when requested', async () => {
    const user = userEvent.setup()
    render(<DataSettings />)

    const file = new File([mockICALEvent], 'test.ics', { type: 'text/calendar' })
    const input = screen.getByTestId('import-calendar-input') as HTMLInputElement
    await user.upload(input, file)

    await waitFor(() => {
      expect(screen.getByTestId('ics-import-calendar-select')).toBeInTheDocument()
    })
    await user.selectOptions(screen.getByTestId('ics-import-calendar-select'), '__new__')
    await user.clear(screen.getByTestId('ics-import-new-calendar-name'))
    await user.type(screen.getByTestId('ics-import-new-calendar-name'), 'Imported Holidays')
    await user.click(screen.getByTestId('ics-import-confirm'))

    await waitFor(() => {
      const { events, calendars: allCalendars } = useCalendarStore.getState()
      const newCalendar = allCalendars.find((c) => c.name === 'Imported Holidays')
      expect(newCalendar).toBeDefined()
      expect(events).toHaveLength(2)
      expect(events.every((e) => e.calendarId === newCalendar?.id)).toBe(true)
    })
  })

  it('cancels the ICS import without adding events', async () => {
    const user = userEvent.setup()
    render(<DataSettings />)

    const file = new File([mockICALEvent], 'test.ics', { type: 'text/calendar' })
    const input = screen.getByTestId('import-calendar-input') as HTMLInputElement
    await user.upload(input, file)

    await waitFor(() => {
      expect(screen.getByTestId('ics-import-calendar-select')).toBeInTheDocument()
    })
    await user.click(screen.getByText('Cancel'))

    expect(screen.queryByTestId('ics-import-calendar-select')).not.toBeInTheDocument()
    expect(useCalendarStore.getState().events).toHaveLength(0)
  })

  it('shows message when ICS file has no events', async () => {
    const user = userEvent.setup()
    render(<DataSettings />)

    const invalidFile = new File(['invalid content'], 'test.ics', { type: 'text/calendar' })
    const input = screen.getByTestId('import-calendar-input') as HTMLInputElement

    await user.upload(input, invalidFile)

    await waitFor(() => {
      expect(screen.getByText(/import 0 events/i)).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('ics-import-confirm'))
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
    const input = screen.getByTestId('import-calendar-input') as HTMLInputElement

    await user.upload(input, jsonFile)

    await waitFor(() => {
      expect(screen.getByText(/no events found/i)).toBeInTheDocument()
    })
  })
})
