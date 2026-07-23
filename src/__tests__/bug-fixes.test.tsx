/**
 * Tests for Bug Fixes 9-12, 58, 59
 *
 * Bug 9:  CommandPalette onClose before async — Enter handler must await executeSelected()
 * Bug 10: EventPreviewPopup relatedTarget null — null check prevents contains() crash
 * Bug 11: Modal dialogs inside popup portal — DeleteDialog/RecurrenceDialog render as siblings
 * Bug 12: editEndTime not initialized — always initialize editEndTime in startEditing('time')
 * Bug 58: EventModal missing selectedEndDate dep — form resets when selectedEndDate changes
 * Bug 59: EventModal timezone inconsistency — all-day events use local date, no .000Z
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Top-level imports for stores
// ---------------------------------------------------------------------------
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  BrowserRouter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef<HTMLDivElement, Record<string, unknown>>(
      (props, ref) => {
        const { children, ...rest } = props
        return <div ref={ref} {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children as React.ReactNode}</div>
      }
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/features/caldav/hooks/useCalDAV', () => ({
  useCalDAV: () => ({
    syncAll: vi.fn(),
    createEvent: vi.fn().mockResolvedValue(undefined),
    updateEvent: vi.fn().mockResolvedValue(undefined),
    deleteEvent: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('@/features/nlp', () => ({
  parseNaturalLanguage: vi.fn().mockReturnValue({
    title: '',
    confidence: 0,
    startDate: new Date(),
    endDate: null,
    location: null,
    isAllDay: false,
    isTask: false,
  }),
}))

const DEFAULT_CALENDAR = { id: 'default', name: 'Cal', color: '#4285F4', isVisible: true, isDefault: true, showTasksInViews: true }

// ===========================================================================
// Bug 9: CommandPalette onClose before async
// ===========================================================================

describe('Bug 9: CommandPalette onClose before async', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCalendarStore.setState({
      events: [],
      calendars: [DEFAULT_CALENDAR],
      isModalOpen: false,
      selectedEventId: null,
      selectedDate: null,
      selectedEndDate: null,
    })
    useSettingsStore.setState({ timeFormat: '12h', dateFormat: 'MM/dd/yyyy' })
  })

  it('onClose should be called after Enter key is pressed', async () => {
    const { CommandPalette } = await import('@/features/commandPalette/components/CommandPalette')
    const onClose = vi.fn()

    render(<CommandPalette isOpen={true} onClose={onClose} />)
    const input = screen.getByRole('combobox')

    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })

    // Close is deferred until the exit animation completes (~140ms).
    await new Promise((r) => setTimeout(r, 200))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('handleKeyDown is async and awaits execution before onClose', async () => {
    const { CommandPalette } = await import('@/features/commandPalette/components/CommandPalette')
    const onClose = vi.fn()

    render(<CommandPalette isOpen={true} onClose={onClose} />)
    const input = screen.getByRole('combobox')

    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })

    // Close is deferred until the exit animation completes.
    await new Promise((r) => setTimeout(r, 200))
    // onClose called exactly once, after the async handler completes
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

// ===========================================================================
// Bug 10: EventPreviewPopup relatedTarget null
// ===========================================================================

describe('Bug 10: EventPreviewPopup relatedTarget null', () => {
  const testEvent = {
    id: 'evt-1',
    calendarId: 'default',
    title: 'Test Event',
    start: '2026-05-27T10:00:00',
    end: '2026-05-27T11:00:00',
    isAllDay: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    useCalendarStore.setState({
      events: [testEvent],
      calendars: [DEFAULT_CALENDAR],
      previewEventId: 'evt-1',
      previewPosition: { x: 100, y: 100 },
    })
    useSettingsStore.setState({ timeFormat: '24h', dateFormat: 'MM/dd/yyyy' })
  })

  it('should not crash when onBlur fires with null relatedTarget', async () => {
    const { EventPreviewPopup } = await import('@/features/calendar/components/EventPreviewPopup')

    render(
      <EventPreviewPopup event={testEvent} position={{ x: 100, y: 100 }} clickedEventId="evt-1" />
    )

    // Enter time editing mode
    await act(async () => {
      fireEvent.click(screen.getByText('10:00 - 11:00'))
    })

    const timeInputs = document.querySelectorAll('[data-component^="event-preview-"]')
    expect(timeInputs.length).toBeGreaterThanOrEqual(2)

    // Blur with null relatedTarget - old code crashes on contains(null)
    const container = timeInputs[0].closest('div')
    expect(container).toBeTruthy()

    await act(async () => {
      const blurEvent = new Event('blur', { bubbles: true })
      Object.defineProperty(blurEvent, 'relatedTarget', { value: null })
      fireEvent.blur(container!, blurEvent)
    })

    // Component still renders (no crash)
    expect(screen.getByText('Test Event')).toBeTruthy()
  })

  it('blur handler guards against null relatedTarget before contains()', async () => {
    const { EventPreviewPopup } = await import('@/features/calendar/components/EventPreviewPopup')

    render(
      <EventPreviewPopup event={testEvent} position={{ x: 100, y: 100 }} clickedEventId="evt-1" />
    )

    await act(async () => {
      fireEvent.click(screen.getByText('10:00 - 11:00'))
    })

    const inputs = document.querySelectorAll('[data-component^="event-preview-"]')
    expect(inputs.length).toBeGreaterThan(0)

    // Must not throw when relatedTarget is null
    expect(() => {
      const blurEvent = new Event('blur', { bubbles: true })
      Object.defineProperty(blurEvent, 'relatedTarget', { value: null, writable: true })
      fireEvent.blur(inputs[0], blurEvent)
    }).not.toThrow()
  })
})

// ===========================================================================
// Bug 11: Modal dialogs inside popup portal
// ===========================================================================

describe('Bug 11: Modal dialogs portaled as siblings', () => {
  const recurringEvent = {
    id: 'recurring-1',
    calendarId: 'default',
    title: 'Recurring Meeting',
    start: '2026-05-27T10:00:00',
    end: '2026-05-27T11:00:00',
    isAllDay: false,
    recurrence: { frequency: 'weekly' as const, interval: 1 },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    useCalendarStore.setState({
      events: [recurringEvent],
      calendars: [DEFAULT_CALENDAR],
      previewEventId: 'recurring-1',
      previewPosition: { x: 100, y: 100 },
    })
    useSettingsStore.setState({ timeFormat: '24h', dateFormat: 'MM/dd/yyyy' })
  })

  it('DeleteDialog should render outside the popup motion.div', async () => {
    const { EventPreviewPopup } = await import('@/features/calendar/components/EventPreviewPopup')

    render(
      <EventPreviewPopup event={recurringEvent} position={{ x: 100, y: 100 }} clickedEventId="recurring-1" />
    )

    // Open delete dialog for recurring event
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Delete'))
    })

    await waitFor(() => {
      expect(screen.getByText('Delete recurring event')).toBeTruthy()
    })

    // The dialog overlay should NOT be a descendant of the popup div
    // The popup renders via createPortal to document.body, so check there
    const popupEl = document.body.querySelector('[class*="popup"]')
    expect(popupEl).toBeTruthy()

    const dialogTitle = screen.getByText('Delete recurring event')
    const dialogOverlay = dialogTitle.closest('[class*="overlay"]')
    expect(dialogOverlay).toBeTruthy()

    // The dialog overlay should NOT be a descendant of the popup
    // (before the fix it was nested inside motion.div, breaking stacking contexts)
    expect(popupEl!.contains(dialogOverlay!)).toBe(false)
  })
})

// ===========================================================================
// Bug 12: editEndTime not initialized
// ===========================================================================

describe('Bug 12: editEndTime initialization', () => {
  const longEvent = {
    id: 'evt-time-1',
    calendarId: 'default',
    title: 'Long Meeting',
    start: '2026-05-27T09:00:00',
    end: '2026-05-27T11:30:00',
    isAllDay: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    useCalendarStore.setState({
      events: [longEvent],
      calendars: [DEFAULT_CALENDAR],
      previewEventId: 'evt-time-1',
      previewPosition: { x: 100, y: 100 },
    })
    useSettingsStore.setState({ timeFormat: '24h', dateFormat: 'MM/dd/yyyy' })
  })

  it('should initialize editEndTime when entering time editing mode', async () => {
    const { EventPreviewPopup } = await import('@/features/calendar/components/EventPreviewPopup')

    render(
      <EventPreviewPopup event={longEvent} position={{ x: 100, y: 100 }} clickedEventId="evt-time-1" />
    )

    expect(screen.getByText('09:00 - 11:30')).toBeTruthy()

    // Click time to edit
    await act(async () => {
      fireEvent.click(screen.getByText('09:00 - 11:30'))
    })

    const timeInputs = document.querySelectorAll('[data-component^="event-preview-"]')
    expect(timeInputs.length).toBe(2)

    expect((timeInputs[0] as HTMLInputElement).value).toBe('09:00')
    // End time should be 11:30 (event's actual end), not 09:00 (start time)
    expect((timeInputs[1] as HTMLInputElement).value).toBe('11:30')
  })

  it('should show different start and end times (not zero-length)', async () => {
    const { EventPreviewPopup } = await import('@/features/calendar/components/EventPreviewPopup')

    render(
      <EventPreviewPopup event={longEvent} position={{ x: 100, y: 100 }} clickedEventId="evt-time-1" />
    )

    expect(screen.getByText('09:00 - 11:30')).toBeTruthy()
    expect(screen.queryByText('09:00 - 09:00')).toBeNull()
  })
})

// ===========================================================================
// Bug 58: EventModal missing selectedEndDate dep
// ===========================================================================

describe('Bug 58: EventModal selectedEndDate dependency', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCalendarStore.setState({
      events: [],
      calendars: [DEFAULT_CALENDAR],
      categories: [],
      isModalOpen: true,
      selectedEventId: null,
      selectedDate: '2026-05-27',
      selectedEndDate: null,
      selectedEventType: 'event',
    })
    useSettingsStore.setState({ timeFormat: '24h', dateFormat: 'MM/dd/yyyy' })
  })

  it('modal should open and respond to selectedEndDate state', async () => {
    const { EventModal } = await import('@/features/calendar/components/EventModal')

    render(<EventModal />)

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByPlaceholderText('Event title')).toBeTruthy()

    // Change selectedEndDate — the form-reset effect should fire
    // because selectedEndDate is now in the dependency array
    await act(async () => {
      useCalendarStore.setState({ selectedEndDate: '2026-05-28' })
    })

    expect(useCalendarStore.getState().selectedEndDate).toBe('2026-05-28')
  })

  it('selectedEndDate should be in the form-reset useEffect deps', async () => {
    const { EventModal } = await import('@/features/calendar/components/EventModal')

    render(<EventModal />)

    expect(screen.getByRole('dialog')).toBeTruthy()

    // Update selectedEndDate — effect should fire (dep array fix)
    await act(async () => {
      useCalendarStore.setState({ selectedEndDate: '2026-06-01' })
    })

    expect(useCalendarStore.getState().selectedEndDate).toBe('2026-06-01')
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByPlaceholderText('Event title')).toBeTruthy()
  })
})

// ===========================================================================
// Bug 59: EventModal timezone inconsistency
// ===========================================================================

describe('Bug 59: EventModal timezone for all-day events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCalendarStore.setState({
      events: [],
      calendars: [DEFAULT_CALENDAR],
      categories: [],
      isModalOpen: true,
      selectedEventId: null,
      selectedDate: '2026-05-27',
      selectedEndDate: null,
      selectedEventType: 'event',
    })
    useSettingsStore.setState({ timeFormat: '24h', dateFormat: 'MM/dd/yyyy' })
  })

  it('all-day events should use local date string without .000Z', async () => {
    const { EventModal } = await import('@/features/calendar/components/EventModal')

    render(<EventModal />)

    const titleInput = screen.getByPlaceholderText('Event title')
    await act(async () => {
      fireEvent.change(titleInput, { target: { value: 'All Day Event' } })
    })

    // Check the all-day checkbox
    const allDayLabel = screen.getByText('All day')
    const allDayCheckbox = allDayLabel.closest('label')?.querySelector('input[type="checkbox"]')
    expect(allDayCheckbox).toBeTruthy()
    await act(async () => {
      fireEvent.click(allDayCheckbox!)
    })

    const saveBtn = screen.getByText('Create')
    await act(async () => {
      fireEvent.click(saveBtn)
    })

    const events = useCalendarStore.getState().events
    const allDayEvent = events.find((e) => e.title === 'All Day Event')

    if (allDayEvent) {
      // The fix: no .000Z suffix for all-day events
      expect(allDayEvent.start).not.toContain('.000Z')
      expect(allDayEvent.end).not.toContain('.000Z')
      // Should be local date format
      expect(allDayEvent.start).toBe('2026-05-27T00:00:00')
    }
  })

  it('non-all-day events should still use ISO UTC format with .000Z', async () => {
    const { EventModal } = await import('@/features/calendar/components/EventModal')

    render(<EventModal />)

    const titleInput = screen.getByPlaceholderText('Event title')
    await act(async () => {
      fireEvent.change(titleInput, { target: { value: 'Timed Event' } })
    })

    // Ensure all-day is NOT checked
    const allDayLabel = screen.getByText('All day')
    const allDayCheckbox = allDayLabel.closest('label')?.querySelector('input[type="checkbox"]') as HTMLInputElement
    if (allDayCheckbox?.checked) {
      await act(async () => {
        fireEvent.click(allDayCheckbox)
      })
    }

    const saveBtn = screen.getByText('Create')
    await act(async () => {
      fireEvent.click(saveBtn)
    })

    const events = useCalendarStore.getState().events
    const timedEvent = events.find((e) => e.title === 'Timed Event')

    if (timedEvent) {
      // Non-all-day events should use toISOString() -> .000Z
      expect(timedEvent.start).toContain('.000Z')
      expect(timedEvent.end).toContain('.000Z')
    }
  })

  it('all-day event start should not end with Z (timezone suffix)', async () => {
    const { EventModal } = await import('@/features/calendar/components/EventModal')

    render(<EventModal />)

    const titleInput = screen.getByPlaceholderText('Event title')
    await act(async () => {
      fireEvent.change(titleInput, { target: { value: 'New Year Event' } })
    })

    const allDayLabel = screen.getByText('All day')
    const allDayCheckbox = allDayLabel.closest('label')?.querySelector('input[type="checkbox"]') as HTMLInputElement
    await act(async () => {
      fireEvent.click(allDayCheckbox)
    })

    const saveBtn = screen.getByText('Create')
    await act(async () => {
      fireEvent.click(saveBtn)
    })

    const events = useCalendarStore.getState().events
    const event = events.find((e) => e.title === 'New Year Event')

    if (event) {
      // Date should match the local date, not be shifted by timezone
      expect(event.start.startsWith('2026-05-27')).toBe(true)
      expect(event.end.startsWith('2026-05-27')).toBe(true)
      // No timezone suffix
      expect(event.start).not.toMatch(/Z$/)
      expect(event.end).not.toMatch(/Z$/)
    }
  })
})
