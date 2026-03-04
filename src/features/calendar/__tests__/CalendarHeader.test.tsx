import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { CalendarHeader } from '../components/CalendarHeader'
import { useCalendarStore } from '@/store/calendarStore'

const renderWithRouter = (component: React.ReactElement) => {
  return render(<BrowserRouter>{component}</BrowserRouter>)
}

describe('CalendarHeader', () => {
  beforeEach(() => {
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
    expect(screen.getByRole('button', { name: /today/i })).toBeInTheDocument()
  })

  it('renders create button', () => {
    renderWithRouter(<CalendarHeader />)
    expect(screen.getByRole('button', { name: /\+/i })).toBeInTheDocument()
  })

  it('renders quick add button', () => {
    renderWithRouter(<CalendarHeader />)
    expect(screen.getByRole('button', { name: /⚡/i })).toBeInTheDocument()
  })

  it('renders navigation buttons', () => {
    renderWithRouter(<CalendarHeader />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThanOrEqual(3)
  })

  it('renders view switcher dropdown', () => {
    renderWithRouter(<CalendarHeader />)
    expect(screen.getByRole('button', { name: /month/i })).toBeInTheDocument()
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
