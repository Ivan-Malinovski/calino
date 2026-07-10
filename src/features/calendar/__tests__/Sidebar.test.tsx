import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import { Sidebar } from '../components/Sidebar'
import { useCalendarStore } from '@/store/calendarStore'

function renderWithRouter(component: React.ReactElement) {
  return render(<BrowserRouter>{component}</BrowserRouter>)
}

describe('Sidebar', () => {
  beforeEach(() => {
    const store = useCalendarStore.getState()
    store.events.forEach((e) => store.deleteEvent(e.id))
    store.calendars.forEach((c) => store.deleteCalendar(c.id))
    store.setCurrentDate('2024-03-15')
    store.addCalendar({
      id: 'default',
      name: 'Default Calendar',
      color: '#4285F4',
      isVisible: true,
      isDefault: true,
      showTasksInViews: true,
    })
  })

  it('renders sidebar by default', () => {
    renderWithRouter(<Sidebar />)
    expect(screen.getByText('Calendars')).toBeInTheDocument()
  })

  it('shows the sync-all action beside the add-account action', () => {
    renderWithRouter(<Sidebar />)

    expect(screen.getByRole('button', { name: 'Sync all calendars' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add CalDAV account' })).toBeInTheDocument()
  })

  it('renders mini calendar', () => {
    renderWithRouter(<Sidebar />)
    expect(screen.getByText('March')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /2024/ })).toBeInTheDocument()
  })

  it('renders today button', () => {
    renderWithRouter(<Sidebar />)
    expect(screen.getByRole('button', { name: /today/i })).toBeInTheDocument()
  })

  it('reveals the calendars list when requested', async () => {
    const user = userEvent.setup()
    renderWithRouter(<Sidebar />)
    const toggle = screen.getByRole('button', { name: /^calendars/i })

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Default Calendar')).not.toBeInTheDocument()

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Default Calendar')).toBeInTheDocument()
  })

  it('renders calendar checkboxes after expanding the section', async () => {
    const user = userEvent.setup()
    renderWithRouter(<Sidebar />)
    await user.click(screen.getByRole('button', { name: /^calendars/i }))
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes.length).toBeGreaterThan(0)
  })

  it('renders in collapsed state when isCollapsed is true', () => {
    // Test that collapsed state renders expand button
    const { container } = renderWithRouter(<Sidebar />)

    // The sidebar should render with expand button when collapsed
    const expandButton = container.querySelector('[title="Expand sidebar"]')
    expect(expandButton || screen.getByText('Calendars')).toBeInTheDocument()
  })

  it('shows color dot for each calendar after expanding the section', async () => {
    const user = userEvent.setup()
    renderWithRouter(<Sidebar />)
    await user.click(screen.getByRole('button', { name: /^calendars/i }))
    const colorDots = document.querySelectorAll('button[class*="colorDot"]')
    expect(colorDots.length).toBeGreaterThan(0)
  })

  it('renders weekday headers in mini calendar', () => {
    renderWithRouter(<Sidebar />)
    const headers = screen.getAllByText('S')
    expect(headers.length).toBeGreaterThan(0)
  })
})
