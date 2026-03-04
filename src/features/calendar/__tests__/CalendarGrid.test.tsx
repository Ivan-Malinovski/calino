import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CalendarGrid } from '../components/CalendarGrid'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'

const renderWithStore = (component: React.ReactElement) => {
  return render(component)
}

describe('CalendarGrid', () => {
  beforeEach(() => {
    const store = useCalendarStore.getState()
    store.events.forEach((e) => store.deleteEvent(e.id))
    store.setCurrentDate('2024-03-15')

    const settings = useSettingsStore.getState()
    if (typeof settings.compactRecurringEvents === 'undefined') {
      useSettingsStore.setState({ compactRecurringEvents: false })
    }
    if (typeof settings.compressPastWeeks === 'undefined') {
      useSettingsStore.setState({ compressPastWeeks: false })
    }
  })

  it('renders the calendar grid with weekdays', () => {
    renderWithStore(<CalendarGrid />)

    expect(screen.getByText('Sun')).toBeInTheDocument()
    expect(screen.getByText('Mon')).toBeInTheDocument()
    expect(screen.getByText('Tue')).toBeInTheDocument()
    expect(screen.getByText('Wed')).toBeInTheDocument()
    expect(screen.getByText('Thu')).toBeInTheDocument()
    expect(screen.getByText('Fri')).toBeInTheDocument()
    expect(screen.getByText('Sat')).toBeInTheDocument()
  })

  it('displays days of the month', () => {
    renderWithStore(<CalendarGrid />)

    expect(screen.getByText('15')).toBeInTheDocument()
  })

  it('displays events for a given day', () => {
    const store = useCalendarStore.getState()

    store.addEvent({
      id: 'test-event',
      calendarId: 'default',
      title: 'Test Event',
      start: '2024-03-15T10:00:00',
      end: '2024-03-15T11:00:00',
      isAllDay: false,
    })

    renderWithStore(<CalendarGrid />)

    expect(screen.getByText('Test Event')).toBeInTheDocument()
  })

  it('shows "today" styling for current day', () => {
    const today = new Date()
    const todayDate = today.getDate().toString()
    useCalendarStore.getState().setCurrentDate(today.toISOString().split('T')[0])

    renderWithStore(<CalendarGrid />)

    const todayElements = screen.getAllByText(todayDate)
    expect(todayElements.length).toBeGreaterThan(0)
  })

  it('opens modal when clicking on a day', async () => {
    const user = userEvent.setup()

    renderWithStore(<CalendarGrid />)

    const dayCell = screen.getByText('20').closest('div')
    if (dayCell) {
      await user.click(dayCell)
    }

    expect(useCalendarStore.getState().isModalOpen).toBe(true)
  })

  it('shows multiple events with overflow indicator', () => {
    const store = useCalendarStore.getState()

    for (let i = 1; i <= 5; i++) {
      store.addEvent({
        id: `event-${i}`,
        calendarId: 'default',
        title: `Event ${i}`,
        start: `2024-03-15T${10 + i}:00:00`,
        end: `2024-03-15T${11 + i}:00:00`,
        isAllDay: false,
      })
    }

    renderWithStore(<CalendarGrid />)

    expect(screen.getByText('Event 1')).toBeInTheDocument()
    expect(screen.getByText('Event 2')).toBeInTheDocument()
    expect(screen.getByText('Event 3')).toBeInTheDocument()
    expect(screen.getByText('+2 more')).toBeInTheDocument()
  })

  it('does not show events from hidden calendars', () => {
    const store = useCalendarStore.getState()

    store.addCalendar({
      id: 'hidden-cal',
      name: 'Hidden Calendar',
      color: '#FF0000',
      isVisible: false,
      isDefault: false,
    })

    store.addEvent({
      id: 'visible-event',
      calendarId: 'default',
      title: 'Visible',
      start: '2024-03-15T10:00:00',
      end: '2024-03-15T11:00:00',
      isAllDay: false,
    })

    store.addEvent({
      id: 'hidden-event',
      calendarId: 'hidden-cal',
      title: 'Hidden',
      start: '2024-03-15T14:00:00',
      end: '2024-03-15T15:00:00',
      isAllDay: false,
    })

    renderWithStore(<CalendarGrid />)

    expect(screen.getByText('Visible')).toBeInTheDocument()
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
  })

  describe('compressPastWeeks', () => {
    it('does not compress weeks when setting is disabled', () => {
      useSettingsStore.setState({ compressPastWeeks: false })

      renderWithStore(<CalendarGrid />)

      const weekRows = document.querySelectorAll('[class*="weekRow"]')
      expect(weekRows.length).toBeGreaterThan(0)
    })

    it('applies compressed style to past weeks when setting is enabled', () => {
      useSettingsStore.setState({ compressPastWeeks: true })

      renderWithStore(<CalendarGrid />)

      const weekRows = document.querySelectorAll('[class*="weekRow"]')
      expect(weekRows.length).toBeGreaterThan(0)
    })

    it('starts with default zoom level of 0.7', () => {
      renderWithStore(<CalendarGrid />)

      const grid = document.querySelector('[class*="grid"]')
      expect(grid).toBeTruthy()
      const style = grid?.getAttribute('style')
      expect(style).toContain('--day-cell-height: 70px')
    })

    it('zooms in with ctrl+scroll down', () => {
      renderWithStore(<CalendarGrid />)

      const grid = document.querySelector('[class*="grid"]')
      expect(grid).toBeTruthy()

      fireEvent.wheel(grid!, {
        deltaY: -100,
        ctrlKey: true,
      })

      const style = grid?.getAttribute('style')
      expect(style).toContain('--day-cell-height: 80px')
    })

    it('does not zoom below min (0.7)', () => {
      renderWithStore(<CalendarGrid />)

      const grid = document.querySelector('[class*="grid"]')

      fireEvent.wheel(grid!, {
        deltaY: 100,
        ctrlKey: true,
      })

      const style = grid?.getAttribute('style')
      expect(style).toContain('--day-cell-height: 70px')
    })

    it('does not zoom beyond max (1.5)', () => {
      renderWithStore(<CalendarGrid />)

      const grid = document.querySelector('[class*="grid"]')

      for (let i = 0; i < 20; i++) {
        fireEvent.wheel(grid!, {
          deltaY: -100,
          ctrlKey: true,
        })
      }

      const style = grid?.getAttribute('style')
      expect(style).toContain('--day-cell-height: 150px')
    })

    it('does not zoom below min (0.7)', () => {
      renderWithStore(<CalendarGrid />)

      const grid = document.querySelector('[class*="grid"]')

      for (let i = 0; i < 20; i++) {
        fireEvent.wheel(grid!, {
          deltaY: 100,
          ctrlKey: true,
        })
      }

      const style = grid?.getAttribute('style')
      expect(style).toContain('--day-cell-height: 70px')
    })
  })
})
