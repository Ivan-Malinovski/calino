import { describe, it, expect, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from '@/test/caldavRender'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router'
import { Sidebar } from '../components/Sidebar'
import { useCalendarStore } from '@/store/calendarStore'

function renderWithRouter(component: React.ReactElement) {
  return render(<BrowserRouter>{component}</BrowserRouter>)
}

describe('Bug #74: Sidebar dropdown click-outside effect stability', () => {
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

  it('renders month and year dropdown buttons', () => {
    renderWithRouter(<Sidebar />)

    expect(screen.getByText('March')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /2024/ })).toBeInTheDocument()
  })

  it('opens month dropdown when month button is clicked', async () => {
    const user = userEvent.setup()
    renderWithRouter(<Sidebar />)

    const monthButton = screen.getByText('March')
    await user.click(monthButton)

    // Month dropdown should show months
    expect(screen.getByText('January')).toBeInTheDocument()
    expect(screen.getByText('December')).toBeInTheDocument()
  })

  it('closes dropdowns when clicking outside', async () => {
    const user = userEvent.setup()
    renderWithRouter(<Sidebar />)

    // Open month dropdown
    const monthButton = screen.getByText('March')
    await user.click(monthButton)
    expect(screen.getByText('January')).toBeInTheDocument()

    // Click outside the dropdown area (body)
    await user.click(document.body)

    // Dropdown should be closed - January should no longer be visible
    expect(screen.queryByText('January')).not.toBeInTheDocument()
  })

  it('opens year dropdown when year button is clicked', async () => {
    const user = userEvent.setup()
    renderWithRouter(<Sidebar />)

    const yearButton = screen.getByRole('button', { name: /2024/ })
    await user.click(yearButton)

    // Year dropdown should show years
    expect(screen.getByText('2023')).toBeInTheDocument()
    expect(screen.getByText('2025')).toBeInTheDocument()
  })
})
