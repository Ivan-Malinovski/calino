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

  it('renders all view options', () => {
    render(<ViewSwitcher />)
    expect(screen.getByRole('button', { name: /month/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /week/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /day/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /agenda/i })).toBeInTheDocument()
  })

  it('renders as a group of buttons', () => {
    render(<ViewSwitcher />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBe(4)
  })

  it('has buttons with proper labels', () => {
    render(<ViewSwitcher />)
    expect(screen.getByRole('button', { name: /month/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /week/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /day/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /agenda/i })).toBeInTheDocument()
  })

  it('each button is clickable', async () => {
    const user = userEvent.setup()

    render(<ViewSwitcher />)

    await user.click(screen.getByRole('button', { name: /day/i }))
    await user.click(screen.getByRole('button', { name: /week/i }))
    await user.click(screen.getByRole('button', { name: /agenda/i }))
    await user.click(screen.getByRole('button', { name: /month/i }))

    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBe(4)
  })
})
