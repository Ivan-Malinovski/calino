import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import { ViewSwitcher } from '../components/ViewSwitcher'
import { useCalendarStore } from '@/store/calendarStore'

function renderWithRouter(component: React.ReactElement) {
  return render(<BrowserRouter>{component}</BrowserRouter>)
}

describe('ViewSwitcher', () => {
  beforeEach(() => {
    const store = useCalendarStore.getState()
    store.setCurrentView('month')
  })

  it('renders all view options', () => {
    renderWithRouter(<ViewSwitcher />)
    expect(screen.getByRole('button', { name: /month/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /week/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /day/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /agenda/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /tasks/i })).toBeInTheDocument()
  })

  it('renders as a group of buttons', () => {
    renderWithRouter(<ViewSwitcher />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBe(5)
  })

  it('has buttons with proper labels', () => {
    renderWithRouter(<ViewSwitcher />)
    expect(screen.getByRole('button', { name: /month/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /week/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /day/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /agenda/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /tasks/i })).toBeInTheDocument()
  })

  it('each button is clickable', async () => {
    const user = userEvent.setup()

    renderWithRouter(<ViewSwitcher />)

    await user.click(screen.getByRole('button', { name: /day/i }))
    expect(useCalendarStore.getState().currentView).toBe('day')

    await user.click(screen.getByRole('button', { name: /week/i }))
    expect(useCalendarStore.getState().currentView).toBe('week')

    await user.click(screen.getByRole('button', { name: /agenda/i }))
    expect(useCalendarStore.getState().currentView).toBe('agenda')

    await user.click(screen.getByRole('button', { name: /month/i }))
    expect(useCalendarStore.getState().currentView).toBe('month')
  })
})
