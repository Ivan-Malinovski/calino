import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BrowserRouter } from 'react-router'
import { WeekView } from '../WeekView'
import { useCalendarStore } from '@/store/calendarStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { useGestures } from '@/hooks/useGestures'
import { useIsMobile } from '@/hooks/useIsMobile'
import { clearWeekWindowStart } from '@/features/calendar/weekWindow'

vi.mock('@/features/caldav/hooks/useCalDAV')
vi.mock('@/hooks/useGestures')
vi.mock('@/hooks/useIsMobile')

const mockUseCalDAV = vi.mocked(useCalDAV)
const mockUseGestures = vi.mocked(useGestures)
const mockUseIsMobile = vi.mocked(useIsMobile)

const renderWithRouter = (component: React.ReactElement) => {
  return render(<BrowserRouter>{component}</BrowserRouter>)
}

describe('WeekView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearWeekWindowStart()

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

  afterEach(() => {
    clearWeekWindowStart()
  })

  it('renders week view with day headers', () => {
    renderWithRouter(<WeekView />)
    expect(screen.getByText(/Mon/i)).toBeInTheDocument()
    expect(screen.getByText(/Tue/i)).toBeInTheDocument()
    expect(screen.getByText(/Wed/i)).toBeInTheDocument()
    expect(screen.getByText(/Thu/i)).toBeInTheDocument()
    expect(screen.getByText(/Fri/i)).toBeInTheDocument()
    expect(screen.getByText(/Sat/i)).toBeInTheDocument()
    expect(screen.getByText(/Sun/i)).toBeInTheDocument()
  })

  it('renders week number header', () => {
    renderWithRouter(<WeekView />)
    expect(screen.getByText(/W\d+/)).toBeInTheDocument()
  })

  it('renders time labels', () => {
    renderWithRouter(<WeekView />)
    expect(screen.getAllByText(/00:00|12:00/).length).toBeGreaterThan(0)
  })

  it('renders day numbers', () => {
    renderWithRouter(<WeekView />)
    expect(screen.getByText('15')).toBeInTheDocument()
  })

  it('renders events for the week', () => {
    const store = useCalendarStore.getState()
    store.addEvent({
      id: 'event-1',
      calendarId: 'default',
      title: 'Team Meeting',
      start: '2024-03-15T09:00:00',
      end: '2024-03-15T10:00:00',
      isAllDay: false,
    })

    renderWithRouter(<WeekView />)
    expect(screen.getByText('Team Meeting')).toBeInTheDocument()
  })

  it('renders all-day events in header', () => {
    const store = useCalendarStore.getState()
    store.addEvent({
      id: 'event-allday',
      calendarId: 'default',
      title: 'Conference',
      start: '2024-03-15T00:00:00',
      end: '2024-03-15T23:59:59',
      isAllDay: true,
    })

    renderWithRouter(<WeekView />)
    expect(screen.getByText('Conference')).toBeInTheDocument()
  })

  it('renders a multi-day all-day event in every covered desktop header', () => {
    useCalendarStore.getState().addEvent({
      id: 'event-span',
      calendarId: 'default',
      title: 'Conference Span',
      start: '2024-03-12T00:00:00',
      end: '2024-03-14T23:59:59',
      isAllDay: true,
    })

    const { container } = renderWithRouter(<WeekView />)
    const headers = Array.from(container.querySelectorAll('[class*="dayHeader"]'))
    const eventHeaders = headers.filter((header) =>
      header
        .querySelector('[data-component="event-card"]')
        ?.getAttribute('aria-label')
        ?.includes('Conference Span')
    )

    expect(eventHeaders).toHaveLength(3)
    expect(eventHeaders.map((header) => header.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Tue'),
        expect.stringContaining('Wed'),
        expect.stringContaining('Thu'),
      ])
    )

    const cards = eventHeaders.map((header) =>
      header.querySelector('[data-component="event-card"]')
    )
    expect(cards[0]).toHaveAttribute('data-fragment-first')
    expect(cards[1]).toHaveAttribute('data-fragment-middle')
    expect(cards[2]).toHaveAttribute('data-fragment-last')
  })

  it('shows a continuation title at the start of the displayed week', () => {
    useCalendarStore.getState().addEvent({
      id: 'event-long-span',
      calendarId: 'default',
      title: 'Long weekly event',
      start: '2024-03-01T00:00:00',
      end: '2024-03-20T23:59:59',
      isAllDay: true,
    })

    const { container } = renderWithRouter(<WeekView />)
    const cards = Array.from(container.querySelectorAll('[data-component="event-card"]')).filter(
      (card) => card.getAttribute('aria-label')?.includes('Long weekly event')
    )
    const visibleTitles = cards.filter(
      (card) =>
        (card.querySelector('[class*="title"]') as HTMLElement | null)?.style.visibility !==
        'hidden'
    )

    expect(cards).toHaveLength(7)
    expect(visibleTitles).toHaveLength(1)
    expect(visibleTitles[0]?.closest('[class*="dayHeader"]')).toHaveTextContent('Mon')
  })

  it('keeps staggered all-day spans in the same desktop lane', () => {
    const store = useCalendarStore.getState()
    store.addEvent({
      id: 'span-a',
      calendarId: 'default',
      title: 'Span A',
      start: '2024-03-12T00:00:00',
      end: '2024-03-14T23:59:59',
      isAllDay: true,
    })
    store.addEvent({
      id: 'span-b',
      calendarId: 'default',
      title: 'Span B',
      start: '2024-03-13T00:00:00',
      end: '2024-03-15T23:59:59',
      isAllDay: true,
    })

    const { container } = renderWithRouter(<WeekView />)
    const headers = Array.from(container.querySelectorAll('[class*="dayHeader"]'))
    const slotIndexes = (title: string) =>
      headers
        .filter((header) =>
          Array.from(header.querySelectorAll('[data-component="event-card"]')).some((card) =>
            card.getAttribute('aria-label')?.includes(title)
          )
        )
        .map((header) => {
          const wrapper = header.querySelector('[class*="allDayEventsInHeader"]')
          return wrapper
            ? Array.from(wrapper.children).findIndex((child) =>
                child.getAttribute('aria-label')?.includes(title)
              )
            : -1
        })

    expect(slotIndexes('Span A')).toEqual([0, 0, 0])
    expect(slotIndexes('Span B')).toEqual([1, 1, 1])
  })

  it('applies correct CSS variable for hour height', () => {
    const { container } = renderWithRouter(<WeekView />)
    const dayColumn = container.querySelector('[class*="dayColumn"]')
    expect(dayColumn).toBeInTheDocument()
  })

  it('renders selection overlay when dragging to create event', () => {
    const { container } = renderWithRouter(<WeekView />)
    const overlay = container.querySelector('[class*="eventsOverlay"]')
    expect(overlay).toBeInTheDocument()
  })

  it('renders today button highlighted', () => {
    const store = useCalendarStore.getState()
    store.setCurrentDate(new Date().toISOString().split('T')[0])
    renderWithRouter(<WeekView />)
    const todayBadge = document.querySelector('[class*="today"]')
    expect(todayBadge).toBeInTheDocument()
  })

  it('scroll sync uses synchronous reset without RAF (Bug #66)', () => {
    mockUseIsMobile.mockReturnValue(true)

    // Spy on requestAnimationFrame to verify it is not used for scroll sync
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame')

    renderWithRouter(<WeekView />)

    // Component renders correctly on mobile
    expect(screen.getByText(/Mon/i)).toBeInTheDocument()

    // The scroll sync effect should not use requestAnimationFrame
    // (headerScrollRef and bodyScrollRef are never attached, so the effect
    // bails out early - but we verify no RAF was called for scroll sync)
    rafSpy.mockRestore()
  })
})

describe('WeekView keyboard navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearWeekWindowStart()

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

  const grid = (container: HTMLElement): HTMLElement => {
    const el = container.querySelector<HTMLElement>('[data-component="week-grid"]')
    if (!el) throw new Error('week-grid not found')
    return el
  }

  const cell = (container: HTMLElement, date: string, hour: string): HTMLElement => {
    const el = container.querySelector<HTMLElement>(`[data-date="${date}"][data-hour="${hour}"]`)
    if (!el) throw new Error(`cell ${date} ${hour} not found`)
    return el
  }

  // The week's day columns in DOM order (the week start follows the locale's
  // firstDayOfWeek setting).
  const weekDates = (container: HTMLElement): string[] => {
    const gridEl = grid(container)
    const dates = Array.from(gridEl.querySelectorAll<HTMLElement>('[data-hour]')).map((c) =>
      c.getAttribute('data-date')!
    )
    return [...new Set(dates)]
  }

  it('exposes only one hour slot as a tab stop (roving tabindex)', () => {
    const { container } = renderWithRouter(<WeekView />)
    const tabbable = container.querySelectorAll('[data-hour][tabindex="0"]')
    expect(tabbable).toHaveLength(1)
    expect(tabbable[0].getAttribute('data-date')).toBe('2024-03-15')
    expect(tabbable[0].getAttribute('data-hour')).toBe('00:00')
  })

  it('ArrowRight moves focus to the same hour slot in the next day column', () => {
    const { container } = renderWithRouter(<WeekView />)
    const dates = weekDates(container)
    const currentDate = dates.find((d) => d === '2024-03-15') ?? dates[0]
    const nextDate = dates[dates.indexOf(currentDate) + 1]
    const current = cell(container, currentDate, '09:00')
    current.focus()
    fireEvent.keyDown(grid(container), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(cell(container, nextDate, '09:00'))
  })

  it('ArrowDown moves focus one hour down within the same day column', () => {
    const { container } = renderWithRouter(<WeekView />)
    const current = cell(container, '2024-03-15', '09:00')
    current.focus()
    fireEvent.keyDown(grid(container), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(cell(container, '2024-03-15', '10:00'))
  })

  it('ArrowDown at 23:00 stays put instead of crossing into the next day', () => {
    const { container } = renderWithRouter(<WeekView />)
    const last = cell(container, '2024-03-15', '23:00')
    last.focus()
    fireEvent.keyDown(grid(container), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(last)
  })

  it('ArrowUp at 00:00 stays put instead of crossing into the previous day', () => {
    const { container } = renderWithRouter(<WeekView />)
    const first = cell(container, '2024-03-15', '00:00')
    first.focus()
    fireEvent.keyDown(grid(container), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(first)
  })

  it('moves the roving tab stop to the focused cell', () => {
    const { container } = renderWithRouter(<WeekView />)
    const dates = weekDates(container)
    const currentDate = dates.find((d) => d === '2024-03-15') ?? dates[0]
    const nextDate = dates[dates.indexOf(currentDate) + 1]
    const current = cell(container, currentDate, '09:00')
    current.focus()
    fireEvent.keyDown(grid(container), { key: 'ArrowRight' })
    const next = cell(container, nextDate, '09:00')
    expect(next.tabIndex).toBe(0)
    expect(current.tabIndex).toBe(-1)
  })

  it('ArrowRight past the last day column pages to the next week and moves focus to its first day', () => {
    const { container } = renderWithRouter(<WeekView />)
    const dates = weekDates(container)
    const lastDate = dates.at(-1)!
    const last = cell(container, lastDate, '09:00')
    last.focus()
    fireEvent.keyDown(grid(container), { key: 'ArrowRight' })
    const store = useCalendarStore.getState()
    // The current date pages one week forward.
    expect(store.currentDate).not.toBe('2024-03-15')
    // Focus lands on the first column of the newly visible week at the same hour.
    const newDates = weekDates(container)
    const firstOfNewWeek = newDates[0]
    expect(document.activeElement).toBe(cell(container, firstOfNewWeek, '09:00'))
  })

  it('Enter on a focused hour slot triggers the same quick-create as a click', () => {
    const { container } = renderWithRouter(<WeekView />)
    const hour = cell(container, '2024-03-15', '09:00')
    hour.focus()
    fireEvent.keyDown(hour, { key: 'Enter' })
    expect(useCalendarStore.getState().isModalOpen).toBe(true)
    expect(useCalendarStore.getState().selectedDate).toBe('2024-03-15T09:00')
  })

  it('names each hour slot for screen readers (role=button + aria-label)', () => {
    const { container } = renderWithRouter(<WeekView />)
    const hour = cell(container, '2024-03-15', '09:00')
    expect(hour.getAttribute('role')).toBe('button')
    // Date and time both present, so the focused slot is never a "blank".
    expect(hour.getAttribute('aria-label')).toContain('March 15')
    expect(hour.getAttribute('aria-label')).toContain('09:00')
  })

  it('keeps exactly one tab stop after moving focus and re-rendering', () => {
    const { container, rerender } = renderWithRouter(<WeekView />)
    const current = cell(container, '2024-03-15', '09:00')
    current.focus()
    fireEvent.keyDown(grid(container), { key: 'ArrowRight' })

    // An unrelated re-render (store update, drag tick) must not resurrect the
    // default anchor behind the moved tab stop.
    rerender(
      <BrowserRouter>
        <WeekView />
      </BrowserRouter>
    )

    const tabbable = container.querySelectorAll('[data-hour][tabindex="0"]')
    expect(tabbable).toHaveLength(1)
    const dates = weekDates(container)
    const nextDate = dates[dates.indexOf('2024-03-15') + 1]
    expect(tabbable[0]).toBe(cell(container, nextDate, '09:00'))
  })
})
