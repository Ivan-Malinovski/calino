import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { renderCommandItemContent } from '../components/CommandItem'
import type { EventResult } from '../types'

/**
 * The row's subtitle used to be `new Date(start).toLocaleString()`, which
 * ignored the user's time format and — for the bare 'yyyy-MM-dd' that journal
 * entries and all-day items store — parsed as UTC midnight, printing a
 * spurious 00:00/01:00 and shifting the day west of Greenwich.
 */
describe('command palette — event result row', () => {
  const row = (event: Partial<EventResult>, timeFormat: '24h' | '12h' = '24h') =>
    render(
      renderCommandItemContent({
        item: {
          id: 'x',
          title: 'Title',
          calendarId: 'cal1',
          start: '2024-03-15T09:30:00',
          ...event,
        } as EventResult,
        type: 'event',
        timeFormat,
      })
    )

  it('shows the day only for a journal entry, with no time', () => {
    row({ start: '2024-03-15', type: 'journal' })
    expect(screen.getByText('Fri, 15 Mar 2024')).toBeInTheDocument()
  })

  it('shows the day only for a journal entry stored with a timestamp', () => {
    row({ start: '2024-03-15T00:00:00', type: 'journal' })
    expect(screen.getByText('Fri, 15 Mar 2024')).toBeInTheDocument()
  })

  it('does not shift a date-only value across the day boundary', () => {
    // UTC-midnight parsing would render this as 14 Mar in any negative offset.
    row({ start: '2024-03-15' })
    expect(screen.getByText('Fri, 15 Mar 2024')).toBeInTheDocument()
  })

  it('shows the time for a timed event, in the configured format', () => {
    row({ start: '2024-03-15T09:30:00' }, '24h')
    expect(screen.getByText('Fri, 15 Mar 2024 09:30')).toBeInTheDocument()
  })

  it('marks a recurring result, and names the rule', () => {
    row({ start: '2024-03-15T09:30:00', recurrence: 'Every week on Friday' })

    expect(screen.getByLabelText('Recurring')).toBeInTheDocument()
    expect(screen.getByText(/Every week on Friday/)).toBeInTheDocument()
  })

  it('leaves a one-off result unmarked', () => {
    row({ start: '2024-03-15T09:30:00' })
    expect(screen.queryByLabelText('Recurring')).not.toBeInTheDocument()
  })

  it('honours the 12h preference', () => {
    row({ start: '2024-03-15T09:30:00' }, '12h')
    expect(screen.getByText('Fri, 15 Mar 2024 9:30 AM')).toBeInTheDocument()
  })
})
