import { describe, it, expect, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from '@/test/caldavRender'
import userEvent from '@testing-library/user-event'
import { DataSettings } from '../components/DataSettings'
import { useCalendarStore } from '@/store/calendarStore'
import type { CalendarEvent, BrokenEvent } from '@/types'

const createBrokenEvent = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'broken-1',
  calendarId: 'default',
  title: 'Broken Event',
  start: '2026-03-10T15:00:00Z',
  end: '2026-03-10T14:00:00Z',
  isAllDay: false,
  ...overrides,
})

describe('DataSettings — broken events section', () => {
  beforeEach(() => {
    useCalendarStore.setState({
      events: [],
      brokenEvents: [],
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

  it('always shows the Data Issues section', () => {
    render(<DataSettings />)
    expect(screen.getByText('Data Issues')).toBeInTheDocument()
  })

  it('shows description when no broken events', () => {
    render(<DataSettings />)
    expect(screen.getByText(/Invalid or broken events/)).toBeInTheDocument()
  })

  it('displays broken events list', () => {
    const brokenEvents: BrokenEvent[] = [
      {
        event: createBrokenEvent({ id: 'broken-1', title: 'Meeting' }),
        reason: 'start > end',
        detectedAt: '2026-03-20T10:00:00Z',
      },
      {
        event: createBrokenEvent({ id: 'broken-2', title: 'Lunch' }),
        reason: 'start > end',
        detectedAt: '2026-03-20T10:00:00Z',
      },
    ]

    useCalendarStore.setState({ brokenEvents })

    render(<DataSettings />)

    expect(screen.getByText('Data Issues')).toBeInTheDocument()
    expect(screen.getByText('Meeting')).toBeInTheDocument()
    expect(screen.getByText('Lunch')).toBeInTheDocument()
  })

  it('displays Fix and Delete buttons for each broken event', () => {
    const brokenEvents: BrokenEvent[] = [
      {
        event: createBrokenEvent({ id: 'broken-1', title: 'Meeting' }),
        reason: 'start > end',
        detectedAt: '2026-03-20T10:00:00Z',
      },
    ]

    useCalendarStore.setState({ brokenEvents })

    render(<DataSettings />)

    const fixButtons = screen.getAllByText('Fix')
    const deleteButtons = screen.getAllByText('Delete')

    expect(fixButtons.length).toBeGreaterThanOrEqual(1)
    expect(deleteButtons.length).toBeGreaterThanOrEqual(1)
  })

  it('removes broken event when Delete is clicked', async () => {
    const user = userEvent.setup()
    const brokenEvents: BrokenEvent[] = [
      {
        event: createBrokenEvent({ id: 'broken-1', title: 'Meeting' }),
        reason: 'start > end',
        detectedAt: '2026-03-20T10:00:00Z',
      },
    ]

    useCalendarStore.setState({ brokenEvents })

    render(<DataSettings />)

    const deleteBtn = screen.getByRole('button', { name: 'Delete' })
    await user.click(deleteBtn)

    const state = useCalendarStore.getState()
    expect(state.brokenEvents).toHaveLength(0)
  })

  it('fixes broken event when Fix is clicked', async () => {
    const user = userEvent.setup()
    const brokenEvent = createBrokenEvent({
      id: 'broken-1',
      title: 'Meeting',
      start: '2026-03-10T15:00:00Z',
      end: '2026-03-10T14:00:00Z',
    })

    const brokenEvents: BrokenEvent[] = [
      {
        event: brokenEvent,
        reason: 'start > end',
        detectedAt: '2026-03-20T10:00:00Z',
      },
    ]

    useCalendarStore.setState({ brokenEvents })

    render(<DataSettings />)

    const fixBtn = screen.getByRole('button', { name: 'Fix' })
    await user.click(fixBtn)

    const state = useCalendarStore.getState()
    expect(state.brokenEvents).toHaveLength(0)
    expect(state.events).toHaveLength(1)
    expect(state.events[0].start).toBe('2026-03-10T14:00:00Z')
    expect(state.events[0].end).toBe('2026-03-10T15:00:00Z')
  })

  it('shows batch actions when multiple broken events', () => {
    const brokenEvents: BrokenEvent[] = [
      {
        event: createBrokenEvent({ id: 'broken-1', title: 'Meeting 1' }),
        reason: 'start > end',
        detectedAt: '2026-03-20T10:00:00Z',
      },
      {
        event: createBrokenEvent({ id: 'broken-2', title: 'Meeting 2' }),
        reason: 'start > end',
        detectedAt: '2026-03-20T10:00:00Z',
      },
    ]

    useCalendarStore.setState({ brokenEvents })

    render(<DataSettings />)

    expect(screen.getByText('Fix All (2)')).toBeInTheDocument()
    expect(screen.getByText('Delete All')).toBeInTheDocument()
  })

  it('fixes all broken events when Fix All is clicked', async () => {
    const user = userEvent.setup()
    const brokenEvents: BrokenEvent[] = [
      {
        event: createBrokenEvent({
          id: 'broken-1',
          title: 'Meeting 1',
          start: '2026-03-10T15:00:00Z',
          end: '2026-03-10T14:00:00Z',
        }),
        reason: 'start > end',
        detectedAt: '2026-03-20T10:00:00Z',
      },
      {
        event: createBrokenEvent({
          id: 'broken-2',
          title: 'Meeting 2',
          start: '2026-03-10T16:00:00Z',
          end: '2026-03-10T15:00:00Z',
        }),
        reason: 'start > end',
        detectedAt: '2026-03-20T10:00:00Z',
      },
    ]

    useCalendarStore.setState({ brokenEvents })

    render(<DataSettings />)

    await user.click(screen.getByText('Fix All (2)'))

    const state = useCalendarStore.getState()
    expect(state.brokenEvents).toHaveLength(0)
    expect(state.events).toHaveLength(2)
  })

  it('deletes all broken events when Delete All is clicked', async () => {
    const user = userEvent.setup()
    const brokenEvents: BrokenEvent[] = [
      {
        event: createBrokenEvent({ id: 'broken-1', title: 'Meeting 1' }),
        reason: 'start > end',
        detectedAt: '2026-03-20T10:00:00Z',
      },
      {
        event: createBrokenEvent({ id: 'broken-2', title: 'Meeting 2' }),
        reason: 'start > end',
        detectedAt: '2026-03-20T10:00:00Z',
      },
    ]

    useCalendarStore.setState({ brokenEvents })

    render(<DataSettings />)

    await user.click(screen.getByText('Delete All'))

    const state = useCalendarStore.getState()
    expect(state.brokenEvents).toHaveLength(0)
    expect(state.events).toHaveLength(0)
  })

  it('does not show batch actions with single broken event', () => {
    const brokenEvents: BrokenEvent[] = [
      {
        event: createBrokenEvent({ id: 'broken-1', title: 'Meeting' }),
        reason: 'start > end',
        detectedAt: '2026-03-20T10:00:00Z',
      },
    ]

    useCalendarStore.setState({ brokenEvents })

    render(<DataSettings />)

    expect(screen.queryByText('Fix All')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Delete All', { selector: '.brokenBatchActions button' })
    ).not.toBeInTheDocument()
  })
})
