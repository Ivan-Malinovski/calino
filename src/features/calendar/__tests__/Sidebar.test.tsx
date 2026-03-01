import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Sidebar } from '../components/Sidebar'
import { useCalendarStore } from '@/store/calendarStore'

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
    })
  })

  it('renders sidebar by default', () => {
    render(<Sidebar />)
    expect(screen.getByText('Calendars')).toBeInTheDocument()
  })

  it('renders mini calendar', () => {
    render(<Sidebar />)
    expect(screen.getByText('March')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /2024/ })).toBeInTheDocument()
  })

  it('renders today button', () => {
    render(<Sidebar />)
    expect(screen.getByRole('button', { name: /today/i })).toBeInTheDocument()
  })

  it('renders calendars list', () => {
    render(<Sidebar />)
    expect(screen.getByText('My Calendars')).toBeInTheDocument()
    expect(screen.getByText('Default Calendar')).toBeInTheDocument()
  })

  it('renders calendar checkboxes', () => {
    render(<Sidebar />)
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes.length).toBeGreaterThan(0)
  })

  it('can collapse sidebar', async () => {
    render(<Sidebar />)

    const collapseButton = screen.getByRole('button', { name: /collapse/i })
    await collapseButton.click()

    expect(screen.queryByText('Calendars')).not.toBeInTheDocument()
  })

  it('shows color dot for each calendar', () => {
    render(<Sidebar />)
    const colorDots = document.querySelectorAll('button[class*="colorDot"]')
    expect(colorDots.length).toBeGreaterThan(0)
  })

  it('renders weekday headers in mini calendar', () => {
    render(<Sidebar />)
    const headers = screen.getAllByText('S')
    expect(headers.length).toBeGreaterThan(0)
  })
})
