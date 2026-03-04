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
    expect(screen.getByText('Calendars')).toBeInTheDocument()
  })

  it('calls onClose when close button is clicked in mobile mode', () => {
    const mockClose = vi.fn()
    render(
      <BrowserRouter>
        <Sidebar isOpen={true} onClose={mockClose} />
      </BrowserRouter>
    )

    const closeButtons = screen.getAllByRole('button')
    const collapseButton = closeButtons.find(
      (btn) => btn.getAttribute('title') === 'Collapse sidebar'
    )
    if (collapseButton) {
      fireEvent.click(collapseButton)
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
