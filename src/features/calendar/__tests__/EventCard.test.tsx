import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Profiler } from 'react'
import { act, render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EventCard } from '../components/EventCard'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import type { CalendarEvent } from '@/types'

vi.mock('@/features/caldav/hooks/useCalDAV')

const mockUseCalDAV = vi.mocked(useCalDAV)

const mockEvent: CalendarEvent = {
  id: 'test-event-1',
  calendarId: 'caldav-calendar',
  title: 'Test Meeting',
  start: '2024-03-15T10:00:00',
  end: '2024-03-15T11:00:00',
  isAllDay: false,
}

describe('EventCard', () => {
  const mockDeleteCalDAVEvent = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseCalDAV.mockReturnValue({
      accounts: [],
      calendars: [],
      syncState: { status: 'idle', lastSyncAt: null, error: null, pendingChanges: 0 },
      addAccount: vi.fn(),
      removeAccount: vi.fn(),
      syncAccount: vi.fn(),
      syncAll: vi.fn(),
      createEvent: vi.fn(),
      updateEvent: vi.fn(),
      deleteEvent: mockDeleteCalDAVEvent,
    } as unknown as ReturnType<typeof useCalDAV>)

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
    useSettingsStore.setState({ useCategoryColors: true })
  })

  it('renders event title', () => {
    render(<EventCard event={mockEvent} />)
    expect(screen.getByText('Test Meeting')).toBeInTheDocument()
  })

  it('uses event color, then category color, then calendar color', () => {
    const store = useCalendarStore.getState()
    store.addCategory({ id: 'work', name: 'Work', color: '#00AA00' })

    const { container, rerender } = render(
      <EventCard event={{ ...mockEvent, categories: ['Work'] }} />
    )
    const card = () => container.querySelector<HTMLElement>('[data-component="event-card"]')!

    expect(card().style.getPropertyValue('--event-color')).toBe('#00AA00')

    act(() => {
      store.updateCategory('work', { color: '#00BB00' })
    })
    expect(card().style.getPropertyValue('--event-color')).toBe('#00BB00')

    rerender(<EventCard event={{ ...mockEvent, color: '#AA0000', categories: ['Work'] }} />)
    expect(card().style.getPropertyValue('--event-color')).toBe('#AA0000')

    rerender(<EventCard event={{ ...mockEvent, categories: ['Unknown'] }} />)
    expect(card().style.getPropertyValue('--event-color')).toBe('#4285F4')
  })

  it('does not rerender for unrelated calendar or category updates', () => {
    const store = useCalendarStore.getState()
    store.addCalendar({
      id: 'unrelated-calendar',
      name: 'Unrelated',
      color: '#111111',
      isVisible: true,
      isDefault: false,
      showTasksInViews: true,
    })
    store.addCategory({ id: 'unrelated-category', name: 'Unrelated', color: '#222222' })

    const commits: number[] = []
    render(
      <Profiler id="event-card" onRender={() => commits.push(1)}>
        <EventCard event={mockEvent} />
      </Profiler>
    )
    commits.length = 0

    store.updateCalendar('unrelated-calendar', { color: '#333333' })
    store.updateCategory('unrelated-category', { color: '#444444' })

    expect(commits).toHaveLength(0)
  })

  it('rerenders when the selected calendar changes', () => {
    const store = useCalendarStore.getState()
    store.updateCalendar('default', { readOnly: false, color: '#123456' })
    const commits: number[] = []

    render(
      <Profiler id="event-card" onRender={() => commits.push(1)}>
        <EventCard event={{ ...mockEvent, calendarId: 'default' }} />
      </Profiler>
    )
    commits.length = 0

    act(() => {
      store.updateCalendar('default', { color: '#654321', readOnly: true })
    })

    expect(commits.length).toBeGreaterThan(0)
  })

  it('updates task disclosure controls when their props change', () => {
    const task: CalendarEvent = {
      ...mockEvent,
      type: 'task',
      title: 'Disclosure task',
    }
    const toggle = vi.fn()
    const { rerender } = render(<EventCard event={task} />)

    expect(
      screen.queryByRole('button', { name: /subtasks for "Disclosure task"/ })
    ).not.toBeInTheDocument()

    rerender(
      <EventCard
        event={task}
        taskHasSubtasks
        taskSubtasksCollapsed
        taskSubtaskCount={3}
        onToggleTaskSubtasks={toggle}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Expand subtasks for "Disclosure task" (3 hidden)' })
    ).toHaveAttribute('aria-expanded', 'false')
  })

  it('marks a child task in month view', () => {
    const subtask: CalendarEvent = {
      ...mockEvent,
      id: 'subtask',
      title: 'Child task',
      type: 'task',
      parentTaskId: 'parent',
    }

    render(<EventCard event={subtask} compact monthView />)

    expect(screen.getByRole('button', { name: /Child task.*subtask/i })).toBeInTheDocument()
    expect(screen.getByTitle('Subtask')).toBeInTheDocument()
  })

  it('renders a chevron for a task with subtasks without opening the card', async () => {
    const user = userEvent.setup()
    const handleClick = vi.fn()
    const toggle = vi.fn()
    const task: CalendarEvent = {
      ...mockEvent,
      type: 'task',
      title: 'Parent task',
    }

    render(
      <EventCard
        event={task}
        onClick={handleClick}
        taskHasSubtasks
        taskSubtasksCollapsed
        taskSubtaskCount={4}
        onToggleTaskSubtasks={toggle}
      />
    )

    const chevron = screen.getByRole('button', {
      name: 'Expand subtasks for "Parent task" (4 hidden)',
    })
    expect(chevron).toHaveAttribute('aria-expanded', 'false')

    await user.click(chevron)

    expect(toggle).toHaveBeenCalledOnce()
    expect(handleClick).not.toHaveBeenCalled()
  })

  it('keeps the mobile month collapse control visible on a task dot', () => {
    const task: CalendarEvent = {
      ...mockEvent,
      type: 'task',
      title: 'Mobile parent task',
    }

    render(
      <EventCard
        event={task}
        dotMode
        clickDisabled
        taskHasSubtasks
        taskSubtasksCollapsed
        taskSubtaskCount={4}
        onToggleTaskSubtasks={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: /Expand subtasks for "Mobile parent task"/ })
    ).toBeVisible()
  })

  it('disables task completion on read-only calendars', () => {
    const store = useCalendarStore.getState()
    store.updateCalendar('default', { readOnly: true })
    const task: CalendarEvent = {
      ...mockEvent,
      calendarId: 'default',
      type: 'task',
      title: 'Read-only task',
    }

    render(<EventCard event={task} />)

    expect(screen.getByRole('button', { name: 'Toggle completion' })).toBeDisabled()
  })

  it('renders event time when not all-day', () => {
    render(<EventCard event={mockEvent} />)
    expect(screen.getByText(/10:00.*11:00/)).toBeInTheDocument()
  })

  it('renders "All day" for all-day events', () => {
    const allDayEvent: CalendarEvent = {
      ...mockEvent,
      isAllDay: true,
    }
    render(<EventCard event={allDayEvent} />)
    expect(screen.getByText('All day')).toBeInTheDocument()
  })

  it('renders location when present', () => {
    const eventWithLocation: CalendarEvent = {
      ...mockEvent,
      location: 'Conference Room A',
    }
    render(<EventCard event={eventWithLocation} />)
    expect(screen.getByText('Conference Room A')).toBeInTheDocument()
  })

  it('does not show time in compact mode', () => {
    render(<EventCard event={mockEvent} compact />)
    expect(screen.queryByText(/10:00/)).not.toBeInTheDocument()
  })

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup()
    const handleClick = vi.fn()

    render(<EventCard event={mockEvent} onClick={handleClick} />)

    await user.click(screen.getByText('Test Meeting'))

    expect(handleClick).toHaveBeenCalledWith(mockEvent)
  })

  it('deletes event from CalDAV when using context menu delete', async () => {
    const user = userEvent.setup()
    const store = useCalendarStore.getState()
    store.addEvent(mockEvent)

    render(<EventCard event={mockEvent} />)

    // Trigger context menu (right-click). button: 2 distinguishes a real
    // right-click from the contextmenu event Android's WebView synthesizes
    // from a touch long-press (button 0), which EventCard now ignores.
    const card = screen.getByText('Test Meeting')
    fireEvent.contextMenu(card, { button: 2 })

    // Click delete in context menu
    const deleteButton = screen.getByText('Delete')
    await user.click(deleteButton)

    expect(mockDeleteCalDAVEvent).toHaveBeenCalledWith('caldav-calendar', 'test-event-1')
  })

  it('removes old resize listeners before adding new ones (Bug #61)', () => {
    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')

    const { unmount } = render(<EventCard event={mockEvent} />)

    // Find the resize handle
    const resizeHandle = document.querySelector('[class*="resizeHandle"]')
    expect(resizeHandle).toBeInTheDocument()

    // Simulate first resize start
    fireEvent.pointerDown(resizeHandle!, {
      clientX: 100,
      clientY: 200,
      bubbles: true,
    })

    // Should have added pointermove and pointerup listeners
    const pointermoveCallsAfterFirst = addSpy.mock.calls.filter((c) => c[0] === 'pointermove')
    const pointerupCallsAfterFirst = addSpy.mock.calls.filter((c) => c[0] === 'pointerup')
    expect(pointermoveCallsAfterFirst.length).toBeGreaterThanOrEqual(1)
    expect(pointerupCallsAfterFirst.length).toBeGreaterThanOrEqual(1)

    const firstMoveHandler = pointermoveCallsAfterFirst[pointermoveCallsAfterFirst.length - 1][1]
    const firstUpHandler = pointerupCallsAfterFirst[pointerupCallsAfterFirst.length - 1][1]

    // Simulate second resize start (without ending the first)
    addSpy.mockClear()
    removeSpy.mockClear()

    fireEvent.pointerDown(resizeHandle!, {
      clientX: 100,
      clientY: 200,
      bubbles: true,
    })

    // The old listeners should have been removed before new ones were added
    expect(removeSpy).toHaveBeenCalledWith('pointermove', firstMoveHandler)
    expect(removeSpy).toHaveBeenCalledWith('pointerup', firstUpHandler)

    // New listeners should have been added
    const pointermoveCallsAfterSecond = addSpy.mock.calls.filter((c) => c[0] === 'pointermove')
    const pointerupCallsAfterSecond = addSpy.mock.calls.filter((c) => c[0] === 'pointerup')
    expect(pointermoveCallsAfterSecond.length).toBe(1)
    expect(pointerupCallsAfterSecond.length).toBe(1)

    addSpy.mockRestore()
    removeSpy.mockRestore()
    unmount()
  })

  describe('recurring event drag-and-drop is disabled', () => {
    const recurringEvent: CalendarEvent = {
      ...mockEvent,
      id: 'recurring-master',
      recurrence: { frequency: 'weekly', interval: 1 },
    }

    it('marks a recurring master event as data-no-drag', () => {
      const { container } = render(<EventCard event={recurringEvent} />)
      const card = container.querySelector('[data-component="event-card"]')
      expect(card).toHaveAttribute('data-no-drag')
    })

    it('does not mark a non-recurring event as data-no-drag', () => {
      const { container } = render(<EventCard event={mockEvent} />)
      const card = container.querySelector('[data-component="event-card"]')
      expect(card).not.toHaveAttribute('data-no-drag')
    })

    it('marks a generated recurring instance as data-no-drag', () => {
      // Generated instances have an id like `master-2024-03-15T10:00:00.000Z`.
      // The event itself doesn't carry `recurrence`/`rruleString` (the master
      // does), so the disable check has to also catch this id pattern.
      const instanceEvent: CalendarEvent = {
        ...mockEvent,
        id: 'recurring-master-2024-03-15T10:00:00.000Z',
      }
      const { container } = render(<EventCard event={instanceEvent} />)
      const card = container.querySelector('[data-component="event-card"]')
      expect(card).toHaveAttribute('data-no-drag')
    })

    it('hides the resize handle for recurring events', () => {
      const { container } = render(<EventCard event={recurringEvent} />)
      const resizeHandle = container.querySelector('[class*="resizeHandle"]')
      expect(resizeHandle).not.toBeInTheDocument()
    })

    it('shows the resize handle for non-recurring events', () => {
      const { container } = render(<EventCard event={mockEvent} />)
      const resizeHandle = container.querySelector('[class*="resizeHandle"]')
      expect(resizeHandle).toBeInTheDocument()
    })

    it('sets cursor to pointer on a recurring card (not grab)', () => {
      const { container } = render(<EventCard event={recurringEvent} />)
      const card = container.querySelector('[data-component="event-card"]') as HTMLElement
      // Inline style.cursor takes precedence over CSS for dnd-kit. We assert
      // the value is `pointer` (not `grab`) so the user understands the card
      // isn't draggable.
      expect(card.style.cursor).toBe('pointer')
    })

    it('shows a tooltip explaining why drag is disabled', () => {
      const { container } = render(<EventCard event={recurringEvent} />)
      const card = container.querySelector('[data-component="event-card"]')
      expect(card).toHaveAttribute('title', 'Click to edit (recurring event)')
    })
  })
})
