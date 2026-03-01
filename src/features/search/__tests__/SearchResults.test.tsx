import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchResults } from '../components/SearchResults'
import type { SearchResult } from '../types'
import type { CalendarEvent } from '@/types'

const mockEvent: CalendarEvent = {
  id: '1',
  calendarId: 'cal1',
  title: 'Team Meeting',
  description: 'Weekly standup',
  location: 'Conference Room',
  start: '2024-03-15T09:00:00Z',
  end: '2024-03-15T10:00:00Z',
  isAllDay: false,
}

const mockResults: SearchResult[] = [
  {
    event: mockEvent,
    score: 0.1,
    matches: [
      {
        field: 'title',
        indices: [[0, 4]],
        value: 'Team Meeting',
        key: 'title',
      },
    ],
  },
  {
    event: {
      ...mockEvent,
      id: '2',
      title: 'Lunch',
      location: 'Restaurant',
      start: '2024-03-15T12:00:00Z',
      end: '2024-03-15T13:00:00Z',
    },
    score: 0.2,
    matches: [],
  },
]

vi.mock('@/store/calendarStore', () => ({
  useCalendarStore: vi.fn((selector) => {
    const state = {
      events: [],
      calendars: [
        { id: 'cal1', name: 'Calendar 1', color: '#4285F4', isVisible: true, isDefault: true },
        { id: 'cal2', name: 'Calendar 2', color: '#EA4335', isVisible: true, isDefault: false },
      ],
    }
    return selector(state as never)
  }),
}))

describe('SearchResults', () => {
  it('renders no results message when results are empty', () => {
    render(<SearchResults results={[]} onSelectEvent={vi.fn()} />)

    expect(screen.getByText('No events found')).toBeInTheDocument()
    expect(screen.getByText('Try searching for something else')).toBeInTheDocument()
  })

  it('renders results with event information', () => {
    const { container } = render(<SearchResults results={mockResults} onSelectEvent={vi.fn()} />)

    expect(container.textContent).toContain('Team Meeting')
    expect(container.textContent).toContain('Lunch')
  })

  it('shows results count', () => {
    render(<SearchResults results={mockResults} onSelectEvent={vi.fn()} />)

    expect(screen.getByText('2 events found')).toBeInTheDocument()
  })

  it('calls onSelectEvent when result is clicked', async () => {
    const user = userEvent.setup()
    const onSelectEvent = vi.fn()

    const { container } = render(
      <SearchResults results={mockResults} onSelectEvent={onSelectEvent} />
    )

    const firstResult = container.querySelector('[role="button"]')
    if (firstResult) {
      await user.click(firstResult)
    }

    expect(onSelectEvent).toHaveBeenCalled()
  })

  it('displays location when present', () => {
    render(<SearchResults results={mockResults} onSelectEvent={vi.fn()} />)

    expect(screen.getByText('Conference Room')).toBeInTheDocument()
  })

  it('handles keyboard navigation', async () => {
    const user = userEvent.setup()
    const onSelectEvent = vi.fn()

    const { container } = render(
      <SearchResults results={mockResults} onSelectEvent={onSelectEvent} />
    )

    const firstResult = container.querySelector('[role="button"]') as HTMLElement
    firstResult?.focus()
    await user.keyboard('{Enter}')

    expect(onSelectEvent).toHaveBeenCalled()
  })
})
