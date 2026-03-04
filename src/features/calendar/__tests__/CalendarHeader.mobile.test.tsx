import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { CalendarHeader } from '../components/CalendarHeader'
import { useCalendarStore } from '@/store/calendarStore'

const renderWithRouter = (component: React.ReactElement) => {
  return render(<BrowserRouter>{component}</BrowserRouter>)
}

describe('CalendarHeader Mobile', () => {
  beforeEach(() => {
    const store = useCalendarStore.getState()
    store.setCurrentView('month')
    store.setCurrentDate('2024-03-15')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-03-15'))
    Object.defineProperty(window, 'innerWidth', { value: 375, writable: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true })
  })

  it('renders hamburger menu button', () => {
    renderWithRouter(<CalendarHeader />)
    expect(screen.getByLabelText(/toggle menu/i)).toBeInTheDocument()
  })

  it('renders mobile view switcher dropdown', () => {
    renderWithRouter(<CalendarHeader />)
    const buttons = screen.getAllByRole('button')
    const viewDropdown = buttons.find((btn) => btn.textContent?.includes('Month'))
    expect(viewDropdown).toBeInTheDocument()
  })

  it('calls onToggleSidebar when hamburger is clicked', () => {
    const mockToggle = vi.fn()
    renderWithRouter(<CalendarHeader onToggleSidebar={mockToggle} />)

    fireEvent.click(screen.getByLabelText(/toggle menu/i))
    expect(mockToggle).toHaveBeenCalled()
  })

  it('swipe navigation does not trigger on small movement', () => {
    const store = useCalendarStore.getState()
    store.setCurrentDate('2024-03-15')

    renderWithRouter(<CalendarHeader />)

    const header = screen.getByText('March').closest('div')
    if (header) {
      fireEvent.touchStart(header, {
        touches: [{ clientX: 100 }],
      })
      fireEvent.touchEnd(header, {
        changedTouches: [{ clientX: 90 }],
      })
    }

    expect(useCalendarStore.getState().currentDate).toBe('2024-03-15')
  })
})
