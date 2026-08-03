import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { BrowserRouter } from 'react-router'
import { CalendarHeader } from '../components/CalendarHeader'
import { useCalendarStore } from '@/store/calendarStore'

// The switcher's tabs-vs-dropdown choice is measured (header.scrollWidth vs
// clientWidth), which jsdom always reports as 0 for both — so without this,
// every test would fall back to the default (compact) dropdown mode
// regardless of the "desktop width" intent. Stub the header box to a size
// that clearly fits, then nudge the component to re-measure via the same
// resize listener it already uses.
const mockDesktopSwitcherLayout = (): void => {
  const header = document.querySelector('[data-component="header"]')
  if (!header) return
  Object.defineProperty(header, 'clientWidth', { configurable: true, value: 1440 })
  Object.defineProperty(header, 'scrollWidth', { configurable: true, value: 1000 })
  act(() => {
    window.dispatchEvent(new Event('resize'))
  })
}

const renderWithRouter = (component: React.ReactElement) => {
  const result = render(<BrowserRouter>{component}</BrowserRouter>)
  mockDesktopSwitcherLayout()
  return result
}

describe('CalendarHeader', () => {
  beforeEach(() => {
    // Set desktop width so the button bar renders (not the dropdown)
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1440 })
    window.dispatchEvent(new Event('resize'))
    const store = useCalendarStore.getState()
    store.setCurrentView('month')
    store.setCurrentDate('2024-03-15')
  })

  it('renders current month title', () => {
    renderWithRouter(<CalendarHeader />)
    expect(screen.getByText('March')).toBeInTheDocument()
  })

  it('renders week view title', () => {
    const store = useCalendarStore.getState()
    store.setCurrentView('week')
    renderWithRouter(<CalendarHeader />)
    expect(screen.getByText(/mar/i)).toBeInTheDocument()
  })

  it('renders day view title', () => {
    const store = useCalendarStore.getState()
    store.setCurrentView('day')
    store.setCurrentDate('2024-03-15')
    renderWithRouter(<CalendarHeader />)
    expect(screen.getByText(/Fri/)).toBeInTheDocument()
  })

  it('renders today button', () => {
    renderWithRouter(<CalendarHeader />)
    // R3 review: the header now has TWO "today"-named buttons (the
    // "Today" navigator and the title group with aria-label "Go to
    // today" when in month view). Scope to the navigator via
    // data-component.
    expect(document.querySelector('[data-component="today-button"]')).toBeInTheDocument()
  })

  it('renders navigation buttons', () => {
    renderWithRouter(<CalendarHeader />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThanOrEqual(3)
  })

  it('has multiple view switcher buttons', () => {
    renderWithRouter(<CalendarHeader />)
    const buttons = screen.getAllByRole('button')
    const viewButtons = buttons.filter(
      (btn) =>
        btn.textContent === 'Month' ||
        btn.textContent === 'Week' ||
        btn.textContent === 'Day' ||
        btn.textContent === 'Agenda' ||
        btn.textContent === 'List'
    )
    expect(viewButtons.length).toBeGreaterThanOrEqual(4)
  })

  it('renders settings button with icon', () => {
    renderWithRouter(<CalendarHeader />)
    const settingsButtons = screen.getAllByRole('button')
    const settingsButton = settingsButtons.find((btn) => {
      const svg = btn.querySelector('svg')
      return svg !== null
    })
    expect(settingsButton).toBeDefined()
  })
})
