import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { Sidebar } from '../components/Sidebar'
import { useCalendarStore } from '@/store/calendarStore'

describe('Sidebar Mobile', () => {
  beforeEach(() => {
    const store = useCalendarStore.getState()
    store.setCurrentDate('2024-03-15')
  })

  it('renders with isOpen prop', () => {
    render(
      <BrowserRouter>
        <Sidebar isOpen={true} onClose={() => {}} />
      </BrowserRouter>
    )
    expect(screen.getByText('My Calendars')).toBeInTheDocument()
  })

  it('calls onClose when overlay is clicked in mobile mode', () => {
    const mockClose = vi.fn()
    const { container } = render(
      <BrowserRouter>
        <Sidebar isOpen={true} onClose={mockClose} />
      </BrowserRouter>
    )

    const overlay = container.querySelector('[class*="overlay"]')
    if (overlay) {
      fireEvent.click(overlay)
      expect(mockClose).toHaveBeenCalled()
    }
  })

  it('renders overlay when open on mobile', () => {
    const { container } = render(
      <BrowserRouter>
        <Sidebar isOpen={true} onClose={() => {}} />
      </BrowserRouter>
    )
    const overlay = container.querySelector('[class*="overlay"]')
    expect(overlay).toBeInTheDocument()
  })
})
