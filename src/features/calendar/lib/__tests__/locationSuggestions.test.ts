import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from '@/types'
import { getLocationSuggestions } from '../locationSuggestions'

const NOW = new Date('2026-08-30T12:00:00Z')

function event(id: string, start: string, location?: string, timezone?: string): CalendarEvent {
  return {
    id,
    calendarId: 'calendar',
    title: id,
    start,
    end: start,
    isAllDay: false,
    location,
    timezone,
  }
}

describe('getLocationSuggestions', () => {
  it('includes starts in the rolling 30-day window and excludes older and future events', () => {
    expect(
      getLocationSuggestions(
        [
          event('boundary', '2026-07-31T12:00:00Z', 'Boundary'),
          event('recent', '2026-08-01T12:00:00Z', 'Recent'),
          event('old', '2026-07-31T11:59:59Z', 'Old'),
          event('future', '2026-08-30T12:00:01Z', 'Future'),
        ],
        '',
        NOW
      )
    ).toEqual(['Recent', 'Boundary'])
  })

  it('searches older and future records once the field has a query', () => {
    const events = [
      event('old', '2025-01-01T12:00:00Z', 'Old Conference'),
      event('future', '2027-01-01T12:00:00Z', 'Future Conference'),
    ]
    expect(getLocationSuggestions(events, 'conference', NOW)).toEqual([
      'Future Conference',
      'Old Conference',
    ])
  })

  it('matches case-insensitively and collapses whitespace, keeping the latest spelling', () => {
    expect(
      getLocationSuggestions(
        [
          event('first', '2026-08-01T12:00:00Z', '  Main   Office '),
          event('latest', '2026-08-20T12:00:00Z', 'MAIN office'),
          event('other', '2026-08-19T12:00:00Z', 'Side Room'),
        ],
        '  main   ',
        NOW
      )
    ).toEqual(['MAIN office'])
  })

  it('orders by latest associated start and caps results at eight locations', () => {
    const events = Array.from({ length: 10 }, (_, index) =>
      event(
        `event-${index}`,
        `2026-08-${String(index + 1).padStart(2, '0')}T12:00:00Z`,
        `Location ${index}`
      )
    )
    expect(getLocationSuggestions(events, '', NOW)).toEqual([
      'Location 9',
      'Location 8',
      'Location 7',
      'Location 6',
      'Location 5',
      'Location 4',
      'Location 3',
      'Location 2',
    ])
  })

  it('uses the event timezone when determining recency', () => {
    expect(
      getLocationSuggestions(
        [event('zoned', '2026-07-31T23:30:00', 'Copenhagen', 'Europe/Copenhagen')],
        '',
        new Date('2026-08-01T00:00:00Z')
      )
    ).toEqual(['Copenhagen'])
  })

  it('ignores empty locations and safely keeps malformed dates searchable', () => {
    const events = [
      event('empty', '2026-08-20T12:00:00Z', '   '),
      event('invalid', 'not-a-date', 'Unknown date'),
    ]
    expect(getLocationSuggestions(events, '', NOW)).toEqual([])
    expect(getLocationSuggestions(events, 'unknown', NOW)).toEqual(['Unknown date'])
  })
})
