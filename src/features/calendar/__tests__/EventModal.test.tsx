import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EventModal } from '../components/EventModal'
import { useCalendarStore } from '@/store/calendarStore'

describe('EventModal', () => {
  beforeEach(() => {
    const store = useCalendarStore.getState()
    store.events.forEach((e) => store.deleteEvent(e.id))
    store.calendars.forEach((c) => store.deleteCalendar(c.id))
    store.categories.forEach((c) => store.deleteCategory(c.id))
    store.addCalendar({
      id: 'default',
      name: 'Default Calendar',
      color: '#4285F4',
      isVisible: true,
      isDefault: true,
      showTasksInViews: true,
    })
    store.closeModal()
  })

  it('does not render when modal is closed', () => {
    render(<EventModal />)
    expect(screen.queryByPlaceholderText('Event title')).not.toBeInTheDocument()
  })

  it('renders title input in header when creating new event', () => {
    const store = useCalendarStore.getState()
    store.openModal()

    render(<EventModal />)
    expect(screen.getByPlaceholderText('Event title')).toBeInTheDocument()
  })

  it('renders title input with event title when editing', () => {
    const store = useCalendarStore.getState()
    store.addEvent({
      id: 'edit-test',
      calendarId: 'default',
      title: 'Existing Event',
      start: '2024-03-15T10:00:00',
      end: '2024-03-15T11:00:00',
      isAllDay: false,
    })
    store.openModal(undefined, undefined, 'edit-test')

    render(<EventModal />)
    expect(screen.getByPlaceholderText('Event title')).toHaveValue('Existing Event')
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
    store.openModal(undefined, undefined, 'edit-test')

    render(<EventModal />)
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
  })

  it('lists direct subtasks when editing a parent task', () => {
    const store = useCalendarStore.getState()
    store.addEvent({ id: 'parent', calendarId: 'default', title: 'Parent task', start: '2024-03-15T10:00:00', end: '2024-03-15T10:00:00', isAllDay: false, type: 'task' })
    store.addEvent({ id: 'child', calendarId: 'default', title: 'Child task', parentTaskId: 'parent', start: '2024-03-15T10:00:00', end: '2024-03-15T10:00:00', isAllDay: false, type: 'task' })
    store.openModal(undefined, undefined, 'parent', 'task')

    render(<EventModal />)

    expect(screen.getByText('Subtasks')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Child task' })).toBeInTheDocument()
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
    expect(screen.getByRole('checkbox', { name: /all day/i })).toBeInTheDocument()
  })

  it('shows recurrence dropdown after enabling Recurring', () => {
    const store = useCalendarStore.getState()
    store.openModal()

    render(<EventModal />)
    fireEvent.click(screen.getByLabelText('Recurring'))
    expect(screen.getByLabelText('Repeat')).toBeInTheDocument()
  })

  it('renders title input', () => {
    const store = useCalendarStore.getState()
    store.openModal()

    render(<EventModal />)
    expect(screen.getByPlaceholderText('Event title')).toBeInTheDocument()
  })

  it('renders location input', () => {
    const store = useCalendarStore.getState()
    store.openModal()

    render(<EventModal />)
    expect(screen.getByPlaceholderText('Location')).toBeInTheDocument()
  })

  it('shows only calendars that support events when creating an event', () => {
    const store = useCalendarStore.getState()
    store.addCalendar({
      id: 'tasks-only',
      name: 'Tasks only',
      color: '#FF0000',
      isVisible: true,
      isDefault: false,
      showTasksInViews: true,
      supportedComponents: ['VTODO'],
    })
    store.openModal()

    render(<EventModal />)

    const calendarSelect = screen
      .getByRole('dialog')
      .querySelector('[data-component="event-calendar-select"]')
    expect(calendarSelect).not.toBeNull()
    expect(calendarSelect).toHaveTextContent('Default Calendar')
    expect(calendarSelect).not.toHaveTextContent('Tasks only')
  })

  it('shows only calendars that support tasks when creating a task', () => {
    const store = useCalendarStore.getState()
    store.updateCalendar('default', { supportedComponents: ['VEVENT'] })
    store.addCalendar({
      id: 'tasks-only',
      name: 'Tasks only',
      color: '#FF0000',
      isVisible: true,
      isDefault: false,
      showTasksInViews: true,
      supportedComponents: ['VTODO'],
    })
    store.openModal(undefined, undefined, undefined, 'task')

    render(<EventModal />)

    const calendarSelect = screen
      .getByRole('dialog')
      .querySelector('[data-component="event-calendar-select"]')
    expect(calendarSelect).not.toBeNull()
    expect(calendarSelect).toHaveTextContent('Tasks only')
    expect(calendarSelect).not.toHaveTextContent('Default Calendar')
  })

  it('renders description textarea', () => {
    const store = useCalendarStore.getState()
    store.openModal()

    render(<EventModal />)
    fireEvent.click(screen.getByRole('button', { name: /add description/i }))
    expect(screen.getByPlaceholderText('Add description...')).toBeInTheDocument()
  })

  it('renders cancel and create buttons', () => {
    const store = useCalendarStore.getState()
    store.openModal()

    render(<EventModal />)
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument()
  })

  it('loads event data when clicking recurring event instance', () => {
    const store = useCalendarStore.getState()
    store.addEvent({
      id: 'recurring-event',
      calendarId: 'default',
      title: 'Weekly Meeting',
      description: 'Original description',
      start: '2024-03-01T10:00:00',
      end: '2024-03-01T11:00:00',
      isAllDay: false,
      recurrence: { frequency: 'weekly', interval: 1 },
    })
    store.openModal(undefined, undefined, 'recurring-event-2024-03-08T10:00:00.000Z')

    render(<EventModal />)

    expect(screen.getByPlaceholderText('Event title')).toHaveValue('Weekly Meeting')
    expect(screen.getByPlaceholderText('Add description...')).toHaveValue('Original description')
  })

  it('does not create event with empty title', () => {
    const store = useCalendarStore.getState()
    store.openModal()

    render(<EventModal />)

    const titleInput = screen.getByPlaceholderText('Event title')
    fireEvent.change(titleInput, { target: { value: '' } })

    const createButton = screen.getByRole('button', { name: /create/i })
    expect(createButton).toBeDisabled()
  })

  it('does not create event with whitespace-only title', () => {
    const store = useCalendarStore.getState()
    store.openModal()

    render(<EventModal />)

    const titleInput = screen.getByPlaceholderText('Event title')
    fireEvent.change(titleInput, { target: { value: '   ' } })

    const createButton = screen.getByRole('button', { name: /create/i })
    expect(createButton).toBeDisabled()
  })

  it('does not create duplicate event when Create is double-clicked rapidly', async () => {
    // Regression: clicking Save while a CalDAV sync is in flight used to create
    // one event per click because `saveEvent` awaited the network round-trip
    // before calling `closeModal()` and the button stayed enabled the whole
    // time.  Fix adds a synchronous re-entrancy guard so the second click is
    // dropped while the first save is still in flight.
    const store = useCalendarStore.getState()
    store.openModal()

    render(<EventModal />)

    fireEvent.change(screen.getByPlaceholderText('Event title'), {
      target: { value: 'Rapid Click Test' },
    })

    const createButton = screen.getByRole('button', { name: /create/i })
    // Three synchronous clicks (user mash) — only one event must result.
    fireEvent.click(createButton)
    fireEvent.click(createButton)
    fireEvent.click(createButton)

    await waitFor(() => {
      const events = useCalendarStore.getState().events
      expect(events.some((e) => e.title === 'Rapid Click Test')).toBe(true)
    })

    // Allow the in-flight CalDAV await (and any pending microtasks) to settle
    // before counting, so the guard isn't masking a duplicate that arrives on
    // a later tick.
    await new Promise((resolve) => setTimeout(resolve, 50))

    const matching = useCalendarStore
      .getState()
      .events.filter((e) => e.title === 'Rapid Click Test')
    expect(matching).toHaveLength(1)
  })

  it('shows a spinner and Saving label while save is in flight', async () => {
    // The disabled :opacity 0.5 fade is fine for the "empty title" / "end
    // before start" states, but while the save is actively in flight the
    // user needs an explicit "this is working" signal — a spinner and a
    // "Saving…" label, with aria-busy for screen readers.
    const store = useCalendarStore.getState()
    store.openModal()

    render(<EventModal />)

    fireEvent.change(screen.getByPlaceholderText('Event title'), {
      target: { value: 'Spinner Test' },
    })

    const createButton = screen.getByRole('button', { name: /create/i })
    fireEvent.click(createButton)

    // While the in-flight CalDAV mock is pending, the button must:
    //   - be re-labelled "Saving…"
    //   - expose aria-busy="true" for assistive tech
    //   - remain disabled (the click is in flight, not the next click)
    //   - contain an aria-hidden spinner span
    const savingButton = await screen.findByRole('button', { name: /saving/i })
    expect(savingButton).toHaveAttribute('aria-busy', 'true')
    expect(savingButton).toBeDisabled()
    const spinner = savingButton.querySelector('span[aria-hidden="true"]')
    expect(spinner).not.toBeNull()

    // Let the save complete cleanly so the next test starts from a fresh
    // modal state.
    await waitFor(() => {
      expect(useCalendarStore.getState().isModalOpen).toBe(false)
    })
  })

  describe('hasChanges with recurrence', () => {
    it('shows recurrence controls when toggling Recurring on a non-recurring event', () => {
      const store = useCalendarStore.getState()
      store.addEvent({
        id: 'non-recurring',
        calendarId: 'default',
        title: 'Plain Event',
        start: '2024-03-15T10:00:00',
        end: '2024-03-15T11:00:00',
        isAllDay: false,
      })
      store.openModal(undefined, undefined, 'non-recurring')

      render(<EventModal />)

      // Recurrence controls should not be visible initially
      expect(screen.queryByLabelText('Repeat')).not.toBeInTheDocument()

      // Toggle Recurring on — this also opens the More panel
      fireEvent.click(screen.getByLabelText('Recurring'))

      // Recurrence controls should now be visible
      expect(screen.getByLabelText('Repeat')).toBeInTheDocument()
    })

    it('pre-populates recurrence data when editing a recurring event', () => {
      const store = useCalendarStore.getState()
      store.addEvent({
        id: 'recurring-prepop',
        calendarId: 'default',
        title: 'Weekly Meeting',
        start: '2024-03-01T10:00:00',
        end: '2024-03-01T11:00:00',
        isAllDay: false,
        recurrence: { frequency: 'weekly', interval: 2 },
      })
      store.openModal(undefined, undefined, 'recurring-prepop')

      render(<EventModal />)

      // Recurring checkbox should be checked
      expect(screen.getByLabelText('Recurring')).toBeChecked()

      // Click More to open the recurrence panel
      fireEvent.click(screen.getByRole('button', { name: /more/i }))

      // The recurrence select should show weekly
      expect(screen.getByLabelText('Repeat')).toHaveValue('weekly')
    })

    it('does not show RecurrenceDialog when submitting unchanged recurring event', () => {
      const store = useCalendarStore.getState()
      store.addEvent({
        id: 'recurring-unchanged',
        calendarId: 'default',
        title: 'Unchanged Meeting',
        start: '2024-03-01T10:00:00',
        end: '2024-03-01T11:00:00',
        isAllDay: false,
        recurrence: { frequency: 'weekly', interval: 1, endDate: '2024-04-01T23:59:59' },
      })
      store.openModal(undefined, undefined, 'recurring-unchanged')

      render(<EventModal />)

      // Click Save without any changes
      fireEvent.click(screen.getByRole('button', { name: /save/i }))

      // RecurrenceDialog should NOT appear (hasChanges is false)
      expect(screen.queryByText('Edit recurring event')).not.toBeInTheDocument()
    })

    it('shows RecurrenceDialog when changing interval on recurring event', () => {
      const store = useCalendarStore.getState()
      store.addEvent({
        id: 'recurring-change-interval',
        calendarId: 'default',
        title: 'Interval Meeting',
        start: '2024-03-01T10:00:00',
        end: '2024-03-01T11:00:00',
        isAllDay: false,
        recurrence: { frequency: 'weekly', interval: 1 },
      })
      store.openModal(undefined, undefined, 'recurring-change-interval')

      render(<EventModal />)

      // Click More to open recurrence controls
      fireEvent.click(screen.getByRole('button', { name: /more/i }))

      // Change interval from 1 to 2
      const intervalInput = screen.getByLabelText('Repeat interval')
      fireEvent.change(intervalInput, { target: { value: '2' } })

      // Click Save
      fireEvent.click(screen.getByRole('button', { name: /save/i }))

      // RecurrenceDialog should appear (hasChanges is true and it is a recurring event)
      expect(screen.getByText('Edit recurring event')).toBeInTheDocument()
    })

    it('shows RecurrenceDialog when toggling recurring off on a recurring event', () => {
      const store = useCalendarStore.getState()
      store.addEvent({
        id: 'recurring-toggle-off',
        calendarId: 'default',
        title: 'Toggle Off Meeting',
        start: '2024-03-01T10:00:00',
        end: '2024-03-01T11:00:00',
        isAllDay: false,
        recurrence: { frequency: 'weekly', interval: 1 },
      })
      store.openModal(undefined, undefined, 'recurring-toggle-off')

      render(<EventModal />)

      // Toggle recurring off
      fireEvent.click(screen.getByLabelText('Recurring'))

      // Click Save
      fireEvent.click(screen.getByRole('button', { name: /save/i }))

      // RecurrenceDialog should appear (recurring changed from true to false)
      expect(screen.getByText('Edit recurring event')).toBeInTheDocument()
    })

    it('shows RecurrenceDialog when changing end condition on recurring event', () => {
      const store = useCalendarStore.getState()
      store.addEvent({
        id: 'recurring-end-cond',
        calendarId: 'default',
        title: 'End Condition Meeting',
        start: '2024-03-01T10:00:00',
        end: '2024-03-01T11:00:00',
        isAllDay: false,
        recurrence: { frequency: 'weekly', interval: 1 },
      })
      store.openModal(undefined, undefined, 'recurring-end-cond')

      render(<EventModal />)

      // Click More to open recurrence controls
      fireEvent.click(screen.getByRole('button', { name: /more/i }))

      // Change end condition from 'never' to 'after'
      fireEvent.change(screen.getByLabelText('Ends'), {
        target: { value: 'after' },
      })

      // Click Save
      fireEvent.click(screen.getByRole('button', { name: /save/i }))

      // RecurrenceDialog should appear
      expect(screen.getByText('Edit recurring event')).toBeInTheDocument()
    })
  })

  describe('recurrence edit modes', () => {
    const seedSeries = () => {
      const store = useCalendarStore.getState()
      store.addEvent({
        id: 'series-master',
        calendarId: 'default',
        title: 'Original Title',
        start: '2024-03-01T10:00:00',
        end: '2024-03-01T11:00:00',
        isAllDay: false,
        recurrence: { frequency: 'weekly', interval: 1 },
      })
      // Open the 3rd occurrence (2024-03-15) as a recurring instance
      store.openModal(undefined, undefined, 'series-master-2024-03-15T10:00:00.000Z')
    }

    it('"This and following events" splits the series without touching past occurrences', async () => {
      seedSeries()
      render(<EventModal />)

      fireEvent.change(screen.getByPlaceholderText('Event title'), {
        target: { value: 'New Title' },
      })
      fireEvent.click(screen.getByRole('button', { name: /save/i }))
      fireEvent.click(screen.getByRole('button', { name: /this and following events/i }))

      await waitFor(() => {
        const events = useCalendarStore.getState().events
        // Master keeps the old title and is truncated to before the split date.
        const master = events.find((e) => e.id === 'series-master')
        expect(master?.title).toBe('Original Title')
        expect(master?.recurrence?.endDate).toContain('2024-03-14')
        // A new series carries the new title and starts on the clicked occurrence.
        const newSeries = events.find((e) => e.id !== 'series-master' && e.title === 'New Title')
        expect(newSeries).toBeDefined()
        expect(newSeries?.start).toContain('2024-03-15')
        expect(newSeries?.recurrence?.frequency).toBe('weekly')
      })
    })

    it('"This event only" creates an exception on the clicked occurrence date, not the master start', async () => {
      seedSeries()
      render(<EventModal />)

      fireEvent.change(screen.getByPlaceholderText('Event title'), {
        target: { value: 'Just This One' },
      })
      fireEvent.click(screen.getByRole('button', { name: /save/i }))
      fireEvent.click(screen.getByRole('button', { name: /this event only/i }))

      await waitFor(() => {
        const events = useCalendarStore.getState().events
        // Master title unchanged; the occurrence is excluded from expansion.
        const master = events.find((e) => e.id === 'series-master')
        expect(master?.title).toBe('Original Title')
        expect(master?.excludedDates ?? []).not.toContain('2024-03-15T10:00:00.000Z')
        // Exception event lands on the clicked date (2024-03-15), not 2024-03-01.
        const exception = events.find((e) => e.title === 'Just This One')
        expect(exception).toBeDefined()
        expect(exception?.start).toContain('2024-03-15')
        expect(exception?.recurrence).toBeUndefined()
      })
    })

    it('keeps the selected category on a single-occurrence exception', async () => {
      const store = useCalendarStore.getState()
      store.addCategory({ id: 'work-category', name: 'Work', color: '#4285F4' })
      seedSeries()
      render(<EventModal />)

      fireEvent.click(screen.getByRole('button', { name: 'Work' }))
      fireEvent.click(screen.getByRole('button', { name: /save/i }))
      fireEvent.click(screen.getByRole('button', { name: /this event only/i }))

      await waitFor(() => {
        const exception = useCalendarStore
          .getState()
          .events.find((event) => event.recurrenceId === '2024-03-15T10:00:00.000Z')
        expect(exception?.categories).toEqual(['Work'])
      })
    })

    it('re-edits an existing exception without changing the recurrence master', async () => {
      const store = useCalendarStore.getState()
      store.addCategory({ id: 'work-category', name: 'Work', color: '#4285F4' })
      store.addEvent({
        id: 'series-master', uid: 'series-master', calendarId: 'default', title: 'Master title',
        start: '2024-03-01T10:00:00', end: '2024-03-01T11:00:00', isAllDay: false,
        recurrence: { frequency: 'weekly', interval: 1 },
      })
      store.addEvent({
        id: 'series-master-2024-03-15T10:00:00.000Z', uid: 'series-master', calendarId: 'default',
        title: 'Edited occurrence', start: '2024-03-15T10:00:00.000Z',
        end: '2024-03-15T11:00:00.000Z', isAllDay: false,
        recurrenceId: '2024-03-15T10:00:00.000Z', recurrenceMasterId: 'series-master',
      })
      store.openModal(undefined, undefined, 'series-master-2024-03-15T10:00:00.000Z')
      render(<EventModal />)

      fireEvent.click(screen.getByRole('button', { name: 'Work' }))
      fireEvent.click(screen.getByRole('button', { name: /save/i }))

      expect(screen.queryByText('Edit recurring event')).not.toBeInTheDocument()
      await waitFor(() => {
        const events = useCalendarStore.getState().events
        expect(events.find((event) => event.id === 'series-master')?.categories).toEqual([])
        expect(events.find((event) => event.recurrenceId)?.categories).toEqual(['Work'])
      })
    })
  })

  describe('date field changes preserve start<=end (issue #44)', () => {
    it('shifts the end date along with the start date for an overnight event, keeping the range valid', () => {
      const store = useCalendarStore.getState()
      // Overnight event: starts 23:00 on the 13th, ends 01:00 on the 14th.
      store.addEvent({
        id: 'overnight-event',
        calendarId: 'default',
        title: 'Overnight Event',
        start: '2024-03-13T23:00:00',
        end: '2024-03-14T01:00:00',
        isAllDay: false,
      })
      store.openModal(undefined, undefined, 'overnight-event')
      render(<EventModal />)

      // Move the start date forward by one day (14th). The naive "clamp end
      // to start only if start>end" logic left the end date at the 14th,
      // producing start(14th 23:00) > end(14th 01:00) — an invalid range
      // that used to be silently possible. The fix must shift the end date
      // to the 15th too, preserving the original overnight span.
      const startDateInput = document.querySelector(
        '[data-component="event-start-date"]'
      ) as HTMLInputElement
      fireEvent.change(startDateInput, { target: { value: '2024-03-14' } })

      const endDateInput = document.querySelector(
        '[data-component="event-end-date"]'
      ) as HTMLInputElement
      expect(endDateInput.value).toBe('2024-03-15')

      const saveButton = screen.getByRole('button', { name: /save/i })
      expect(saveButton).not.toBeDisabled()
    })
  })
})
