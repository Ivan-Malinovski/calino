import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BrowserRouter } from 'react-router'
import { CalendarGrid } from '../CalendarGrid'
import { useCalendarStore } from '@/store/calendarStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { useGestures } from '@/hooks/useGestures'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useIsTallWindow, useIsWideWindow } from '@/hooks/useWindowHeight'

vi.mock('@/features/caldav/hooks/useCalDAV')
vi.mock('@/hooks/useGestures')
vi.mock('@/hooks/useIsMobile')
vi.mock('@/hooks/useWindowHeight')

const mockUseCalDAV = vi.mocked(useCalDAV)
const mockUseGestures = vi.mocked(useGestures)
const mockUseIsMobile = vi.mocked(useIsMobile)
const mockUseIsTallWindow = vi.mocked(useIsTallWindow)
const mockUseIsWideWindow = vi.mocked(useIsWideWindow)

const renderWithRouter = (component: React.ReactElement) => {
  return render(<BrowserRouter>{component}</BrowserRouter>)
}

describe('CalendarGrid', () => {
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
      deleteEvent: vi.fn(),
    } as unknown as ReturnType<typeof useCalDAV>)

    mockUseGestures.mockReturnValue({
      bind: {},
      gestureState: 'idle',
    })

    mockUseIsMobile.mockReturnValue(false)
    mockUseIsTallWindow.mockReturnValue(false)
    mockUseIsWideWindow.mockReturnValue(false)

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
    store.setCurrentDate('2024-03-15')
  })

  it('renders the calendar grid with weekdays', () => {
    renderWithRouter(<CalendarGrid />)
    expect(screen.getByText('Sun')).toBeInTheDocument()
    expect(screen.getByText('Mon')).toBeInTheDocument()
    expect(screen.getByText('Tue')).toBeInTheDocument()
  })

  it('changeMonth reads from store directly instead of lagging ref (Bug #64)', () => {
    renderWithRouter(<CalendarGrid />)

    const store = useCalendarStore.getState()
    expect(store.currentDate).toBe('2024-03-15')

    // Simulate ArrowDown key to trigger changeMonth('down') -> next month
    fireEvent.keyDown(window, { key: 'ArrowDown' })

    const storeAfter = useCalendarStore.getState()
    expect(storeAfter.currentDate).toBe('2024-04-15')
  })

  it('changeMonth navigates to previous month with ArrowUp (Bug #64)', () => {
    renderWithRouter(<CalendarGrid />)

    const store = useCalendarStore.getState()
    expect(store.currentDate).toBe('2024-03-15')

    // Simulate ArrowUp key to trigger changeMonth('up') -> previous month
    fireEvent.keyDown(window, { key: 'ArrowUp' })

    const storeAfter = useCalendarStore.getState()
    expect(storeAfter.currentDate).toBe('2024-02-15')
  })

  it('exposes only the current date as a tab stop (roving tabindex)', () => {
    const { container } = renderWithRouter(<CalendarGrid />)
    const tabbable = container.querySelectorAll('[data-date][tabindex="0"]')
    expect(tabbable).toHaveLength(1)
    expect(tabbable[0].getAttribute('data-date')).toBe('2024-03-15')
  })

  it('ArrowRight moves keyboard focus to the next day cell', () => {
    const { container } = renderWithRouter(<CalendarGrid />)
    const cell = container.querySelector<HTMLElement>('[data-date="2024-03-15"]')!
    cell.focus()
    fireEvent.keyDown(cell, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(container.querySelector('[data-date="2024-03-16"]'))
  })

  it('ArrowDown moves keyboard focus one week down without changing the month', () => {
    const { container } = renderWithRouter(<CalendarGrid />)
    const cell = container.querySelector<HTMLElement>('[data-date="2024-03-15"]')!
    cell.focus()
    fireEvent.keyDown(cell, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(container.querySelector('[data-date="2024-03-22"]'))
    // Focus navigation must not trigger the window-level month change.
    expect(useCalendarStore.getState().currentDate).toBe('2024-03-15')
  })

  it('changeMonth uses current store value not stale ref on rapid calls (Bug #64)', () => {
    renderWithRouter(<CalendarGrid />)

    // Rapidly navigate forward twice - each call should read the current store value
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'ArrowDown' })

    const store = useCalendarStore.getState()
    // Should be May 2024 (two months forward from March)
    expect(store.currentDate).toBe('2024-05-15')
  })

  it('month-view wrapper divs stay mounted after the last event is deleted (so AnimatePresence can run the exit animation)', () => {
    // Regression for: "Deleting doesn't have an animation" in month view.
    // Root cause: the .events and .tasks wrapper divs were wrapped in
    // `{dayEvents.length > 0 && ...}` conditionals. Deleting the LAST
    // event on a day flipped the conditional false, and React unmounted
    // the entire <div> (including its AnimatePresence) before
    // framer-motion could run the exit animation.
    //
    // The fix removes the outer conditional so the wrappers are always
    // rendered. Empty containers collapse to 0 height via flexbox (no
    // visual impact).
    const store = useCalendarStore.getState()
    store.addEvent({
      id: 'last-event-on-day',
      calendarId: 'default',
      title: 'Only Event On Day',
      start: '2024-03-15T09:00:00',
      end: '2024-03-15T10:00:00',
      isAllDay: false,
    })

    const { container } = renderWithRouter(<CalendarGrid />)
    // Before delete: the wrapper div exists.
    const eventsBefore = container.querySelectorAll('[class*="events"]')
    expect(eventsBefore.length).toBeGreaterThan(0)

    // Delete the only event on this day.
    store.deleteEvent('last-event-on-day')

    // After delete: the wrapper divs must STILL be in the DOM so
    // AnimatePresence can intercept the unmount and run the exit.
    // Empty containers are fine — flexbox collapses them to 0 height.
    const eventsAfter = container.querySelectorAll('[class*="events"]')
    expect(eventsAfter.length).toBe(eventsBefore.length)

    // And the data-component="day-tasks" wrapper is always present too.
    expect(container.querySelector('[data-component="day-tasks"]')).toBeInTheDocument()
  })

  it('keeps overlapping multi-day pills in a stable lane across every day they span', () => {
    const store = useCalendarStore.getState()
    const spans = [
      { id: 'long', title: 'Long', start: '2024-03-05', end: '2024-03-12' },
      { id: 'later', title: 'Later', start: '2024-03-08', end: '2024-03-15' },
      { id: 'short', title: 'Short', start: '2024-03-07', end: '2024-03-09' },
    ]
    spans.forEach(({ id, title, start, end }) =>
      store.addEvent({
        id,
        calendarId: 'default',
        title,
        start: `${start}T09:00:00`,
        end: `${end}T10:00:00`,
        isAllDay: false,
      })
    )

    const { container } = renderWithRouter(<CalendarGrid />)

    // Row index of a pill inside a day cell = its position among the stacked
    // children of that cell's events container (spacers included).
    const laneOf = (date: string, title: string) => {
      const cell = container.querySelector(`[data-date="${date}"]`)!
      const rows = Array.from(cell.querySelector('[class*="events"]')!.children)
      return rows.findIndex((row) => row.textContent?.includes(title))
    }

    // Longest span wins the top lane; the equal-length span that starts later
    // sits below it; the short one is pushed to the third lane where it overlaps.
    const laneByTitle = { Long: 0, Later: 1, Short: 2 }
    const daysByTitle = {
      Long: ['05', '06', '07', '08', '09', '10', '11', '12'],
      Later: ['08', '09', '10', '11', '12', '13', '14', '15'],
      Short: ['07', '08', '09'],
    }
    Object.entries(daysByTitle).forEach(([title, days]) => {
      days.forEach((day) => {
        expect(laneOf(`2024-03-${day}`, title)).toBe(laneByTitle[title as keyof typeof laneByTitle])
      })
    })
  })

  it('assigns equal-length overlapping spans by start date, earliest on top', () => {
    const store = useCalendarStore.getState()
    store.addEvent({
      id: 'b-later',
      calendarId: 'default',
      title: 'Later',
      start: '2024-03-06T09:00:00',
      end: '2024-03-08T10:00:00',
      isAllDay: false,
    })
    store.addEvent({
      id: 'a-earlier',
      calendarId: 'default',
      title: 'Earlier',
      start: '2024-03-05T09:00:00',
      end: '2024-03-07T10:00:00',
      isAllDay: false,
    })

    const { container } = renderWithRouter(<CalendarGrid />)
    const rowsOn = (date: string) =>
      Array.from(
        container.querySelector(`[data-date="${date}"]`)!.querySelector('[class*="events"]')!
          .children
      )

    // On the overlap days the earlier-starting span must stay above.
    ;['2024-03-06', '2024-03-07'].forEach((date) => {
      const rows = rowsOn(date)
      expect(rows[0].textContent).toContain('Earlier')
      expect(rows[1].textContent).toContain('Later')
    })
    // On 03-08 "Earlier" has ended, so lane 0 is held open by a spacer and
    // "Later" stays in lane 1 rather than jumping up a row.
    const lastDay = rowsOn('2024-03-08')
    expect(lastDay[0].textContent).toBe('')
    expect(lastDay[1].textContent).toContain('Later')
  })

  it('promotes a single-day event into a lane a fragment leaves empty', () => {
    const store = useCalendarStore.getState()
    // A span occupying lane 1 (lane 0 belongs to the longer span on 03-05..03-06).
    store.addEvent({
      id: 'top-span',
      calendarId: 'default',
      title: 'TopSpan',
      start: '2024-03-05T09:00:00',
      end: '2024-03-06T10:00:00',
      isAllDay: false,
    })
    store.addEvent({
      id: 'low-span',
      calendarId: 'default',
      title: 'LowSpan',
      start: '2024-03-06T09:00:00',
      end: '2024-03-07T10:00:00',
      isAllDay: false,
    })
    // On 03-07 the top lane is free, so this single-day event should fill it
    // instead of the blank spacer. Deliberately a plain timed event: an all-day
    // or recurring one is already forced compact by `compactRecurringEvents`,
    // so it would not exercise the lane-promotion path.
    store.addEvent({
      id: 'filler',
      calendarId: 'default',
      title: 'Filler',
      start: '2024-03-07T14:00:00',
      end: '2024-03-07T15:00:00',
      isAllDay: false,
    })

    const { container } = renderWithRouter(<CalendarGrid />)
    const rows = Array.from(
      container.querySelector('[data-date="2024-03-07"]')!.querySelector('[class*="events"]')!
        .children
    )

    // Without promotion lane 0 would be a blank spacer and the filler would
    // render below the span instead.
    expect(rows[0].textContent).toContain('Filler')
    expect(rows[1].textContent).toContain('LowSpan')
  })
})
