import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IcsImportModal } from '../IcsImportModal'
import { useCalendarStore } from '@/store/calendarStore'

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:evt-1@example.com
DTSTART:20260301T100000Z
DTEND:20260301T110000Z
SUMMARY:Kickoff
END:VEVENT
BEGIN:VTODO
UID:todo-1@example.com
DTSTAMP:20260301T090000Z
SUMMARY:Send agenda
END:VTODO
END:VCALENDAR`

function setupStore(): void {
  useCalendarStore.setState({
    events: [],
    calendars: [
      {
        id: 'work',
        name: 'Work',
        color: '#4285F4',
        isVisible: true,
        isDefault: true,
        showTasksInViews: true,
      },
      {
        id: 'holidays',
        name: 'Holidays',
        color: '#0f9d58',
        isVisible: true,
        isDefault: false,
        showTasksInViews: true,
        readOnly: true,
      },
    ],
  })
}

describe('IcsImportModal', () => {
  beforeEach(() => {
    setupStore()
  })

  it('previews the parsed items, including tasks', () => {
    render(<IcsImportModal isOpen icsText={ICS} fileName="team.ics" onClose={vi.fn()} />)

    expect(screen.getByText(/import 2 items/i)).toBeInTheDocument()
    expect(screen.getByText('Kickoff')).toBeInTheDocument()
    expect(screen.getByText('Send agenda')).toBeInTheDocument()
    expect(screen.getByText('Task')).toBeInTheDocument()
    expect(screen.getByText('team.ics')).toBeInTheDocument()
  })

  it('offers only writable calendars as targets', () => {
    render(<IcsImportModal isOpen icsText={ICS} fileName="team.ics" onClose={vi.fn()} />)

    const select = screen.getByTestId('ics-import-calendar-select')
    expect(select).toHaveValue('work')
    expect(screen.getByRole('option', { name: 'Work' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Holidays' })).not.toBeInTheDocument()
  })

  it('imports into the selected calendar', async () => {
    const user = userEvent.setup()
    const onImported = vi.fn()
    render(
      <IcsImportModal
        isOpen
        icsText={ICS}
        fileName="team.ics"
        onClose={vi.fn()}
        onImported={onImported}
      />
    )

    await user.click(screen.getByTestId('ics-import-confirm'))

    await waitFor(() => {
      const events = useCalendarStore.getState().events
      expect(events).toHaveLength(2)
      expect(events.every((e) => e.calendarId === 'work')).toBe(true)
    })
    expect(onImported).toHaveBeenCalledWith(2, 'Work')
  })

  it('creates a new calendar when that branch is chosen', async () => {
    const user = userEvent.setup()
    render(<IcsImportModal isOpen icsText={ICS} fileName="team.ics" onClose={vi.fn()} />)

    await user.selectOptions(screen.getByTestId('ics-import-calendar-select'), '__new__')
    await user.type(screen.getByTestId('ics-import-new-calendar-name'), 'Team stuff')
    await user.click(screen.getByTestId('ics-import-confirm'))

    await waitFor(() => {
      const { events, calendars } = useCalendarStore.getState()
      const created = calendars.find((c) => c.name === 'Team stuff')
      expect(created).toBeDefined()
      expect(events).toHaveLength(2)
      expect(events.every((e) => e.calendarId === created?.id)).toBe(true)
    })
  })

  it('falls back to the filename when the new calendar is left unnamed', async () => {
    const user = userEvent.setup()
    render(<IcsImportModal isOpen icsText={ICS} fileName="team.ics" onClose={vi.fn()} />)

    await user.selectOptions(screen.getByTestId('ics-import-calendar-select'), '__new__')
    await user.click(screen.getByTestId('ics-import-confirm'))

    await waitFor(() => {
      expect(useCalendarStore.getState().calendars.some((c) => c.name === 'team')).toBe(true)
    })
  })

  it('skips items whose UID already exists in the target calendar', async () => {
    useCalendarStore.setState({
      events: [
        {
          id: 'evt-1@example.com',
          uid: 'evt-1@example.com',
          calendarId: 'work',
          title: 'Kickoff',
          start: '2026-03-01T10:00:00.000Z',
          end: '2026-03-01T11:00:00.000Z',
          isAllDay: false,
        },
      ],
    })

    const user = userEvent.setup()
    render(<IcsImportModal isOpen icsText={ICS} fileName="team.ics" onClose={vi.fn()} />)

    expect(screen.getByText(/1 of these is already in this calendar/i)).toBeInTheDocument()

    await user.click(screen.getByTestId('ics-import-confirm'))

    await waitFor(() => {
      // The pre-existing event plus the one new VTODO — the duplicate VEVENT
      // is not appended a second time.
      expect(useCalendarStore.getState().events).toHaveLength(2)
    })
  })

  it('does not flag duplicates when creating a new calendar', async () => {
    useCalendarStore.setState({
      events: [
        {
          id: 'evt-1@example.com',
          uid: 'evt-1@example.com',
          calendarId: 'work',
          title: 'Kickoff',
          start: '2026-03-01T10:00:00.000Z',
          end: '2026-03-01T11:00:00.000Z',
          isAllDay: false,
        },
      ],
    })

    const user = userEvent.setup()
    render(<IcsImportModal isOpen icsText={ICS} fileName="team.ics" onClose={vi.fn()} />)
    await user.selectOptions(screen.getByTestId('ics-import-calendar-select'), '__new__')

    expect(screen.queryByText(/already in this calendar/i)).not.toBeInTheDocument()
  })

  it('reports an empty file rather than an error', () => {
    render(<IcsImportModal isOpen icsText="not a calendar" fileName="x.ics" onClose={vi.fn()} />)

    expect(screen.getByText(/no events, tasks, or journal entries/i)).toBeInTheDocument()
  })

  it('closes without importing on cancel', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<IcsImportModal isOpen icsText={ICS} fileName="team.ics" onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalled()
    expect(useCalendarStore.getState().events).toHaveLength(0)
  })

  it('renders nothing when closed', () => {
    const { container } = render(
      <IcsImportModal isOpen={false} icsText={ICS} onClose={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId('ics-import-confirm')).not.toBeInTheDocument()
  })
})
