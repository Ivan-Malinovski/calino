import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ViewSwitcher } from '../components/ViewSwitcher'
import { useCalendarStore } from '@/store/calendarStore'

describe('ViewSwitcher', () => {
  beforeEach(() => {
    const store = useCalendarStore.getState()
    store.setCurrentView('month')
  })

  it('renders current view button', () => {
    render(<ViewSwitcher />)
    expect(screen.getByRole('button', { name: /month/i })).toBeInTheDocument()
  })

  it('shows dropdown menu when clicked', async () => {
    const user = userEvent.setup()
    render(<ViewSwitcher />)

    await user.click(screen.getByRole('button', { name: /month/i }))

    expect(screen.getByRole('button', { name: /week/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /day/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /agenda/i })).toBeInTheDocument()
  })

  it('changes view when dropdown item is clicked', async () => {
    const user = userEvent.setup()
    render(<ViewSwitcher />)

    await user.click(screen.getByRole('button', { name: /month/i }))
    await user.click(screen.getByRole('button', { name: /week/i }))

    expect(useCalendarStore.getState().currentView).toBe('week')
  })

  it('closes dropdown after selection', async () => {
    const user = userEvent.setup()
    render(<ViewSwitcher />)

    await user.click(screen.getByRole('button', { name: /month/i }))
    expect(screen.getByRole('button', { name: /week/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /day/i }))
    expect(useCalendarStore.getState().currentView).toBe('day')
  })
})
