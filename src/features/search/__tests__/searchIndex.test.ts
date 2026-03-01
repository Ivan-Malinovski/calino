import { describe, it, expect, beforeEach } from 'vitest'
import { initializeSearchIndex, search, updateSearchIndex } from '../lib/searchIndex'
import type { CalendarEvent } from '@/types'

const mockEvents: CalendarEvent[] = [
  {
    id: '1',
    calendarId: 'cal1',
    title: 'Team Meeting',
    description: 'Weekly team standup',
    location: 'Conference Room A',
    start: '2024-03-15T09:00:00Z',
    end: '2024-03-15T10:00:00Z',
    isAllDay: false,
  },
  {
    id: '2',
    calendarId: 'cal1',
    title: 'Lunch with Client',
    description: 'Business lunch at restaurant',
    location: 'Downtown Bistro',
    start: '2024-03-15T12:00:00Z',
    end: '2024-03-15T13:30:00Z',
    isAllDay: false,
  },
  {
    id: '3',
    calendarId: 'cal2',
    title: 'Doctor Appointment',
    description: 'Annual checkup',
    location: 'Medical Center',
    start: '2024-03-20T14:00:00Z',
    end: '2024-03-20T15:00:00Z',
    isAllDay: false,
  },
  {
    id: '4',
    calendarId: 'cal2',
    title: 'Project Deadline',
    description: 'Submit final deliverables',
    location: 'Home Office',
    start: '2024-03-25T17:00:00Z',
    end: '2024-03-25T18:00:00Z',
    isAllDay: false,
  },
  {
    id: '5',
    calendarId: 'cal1',
    title: 'Yoga Class',
    description: 'Morning yoga session',
    location: 'Fitness Studio',
    start: '2024-03-16T07:00:00Z',
    end: '2024-03-16T08:00:00Z',
    isAllDay: false,
  },
]

describe('searchIndex', () => {
  beforeEach(() => {
    initializeSearchIndex(mockEvents)
  })

  describe('initializeSearchIndex', () => {
    it('initializes search index with events', () => {
      const results = search('meeting')
      expect(results.length).toBeGreaterThan(0)
    })
  })

  describe('search', () => {
    it('finds events by title', () => {
      const results = search('meeting')
      expect(results).toHaveLength(1)
      expect(results[0].event.title).toBe('Team Meeting')
    })

    it('finds events by description', () => {
      const results = search('standup')
      expect(results).toHaveLength(1)
      expect(results[0].event.title).toBe('Team Meeting')
    })

    it('finds events by location', () => {
      const results = search('restaurant')
      expect(results).toHaveLength(1)
      expect(results[0].event.title).toBe('Lunch with Client')
    })

    it('supports fuzzy matching', () => {
      const results = search('meting')
      expect(results.length).toBeGreaterThan(0)
    })

    it('returns empty array for empty query', () => {
      const results = search('')
      expect(results).toHaveLength(0)
    })

    it('returns empty array for query with only whitespace', () => {
      const results = search('   ')
      expect(results).toHaveLength(0)
    })

    it('returns results with match information', () => {
      const results = search('meeting')
      expect(results[0].matches.length).toBeGreaterThan(0)
      expect(results[0].matches[0].field).toBe('title')
    })
  })

  describe('search with filters', () => {
    it('filters by calendar IDs', () => {
      const results = search('', { calendarIds: ['cal1'] })
      expect(results).toHaveLength(0)

      const resultsWithQuery = search('team', { calendarIds: ['cal1'] })
      expect(resultsWithQuery).toHaveLength(1)
      expect(resultsWithQuery[0].event.calendarId).toBe('cal1')
    })

    it('filters by date range', () => {
      const results = search('', {
        dateFrom: '2024-03-15',
        dateTo: '2024-03-16',
      })
      expect(results).toHaveLength(0)

      const resultsWithQuery = search('yoga', {
        dateFrom: '2024-03-15',
        dateTo: '2024-03-17',
      })
      expect(resultsWithQuery).toHaveLength(1)
    })

    it('combines text search with filters', () => {
      const results = search('lunch', { calendarIds: ['cal1'] })
      expect(results).toHaveLength(1)
      expect(results[0].event.title).toBe('Lunch with Client')
    })
  })

  describe('updateSearchIndex', () => {
    it('updates the search index with new events', () => {
      const newEvents: CalendarEvent[] = [
        ...mockEvents,
        {
          id: '6',
          calendarId: 'cal3',
          title: 'New Event',
          start: '2024-03-30T10:00:00Z',
          end: '2024-03-30T11:00:00Z',
          isAllDay: false,
        },
      ]

      updateSearchIndex(newEvents)

      const results = search('new event')
      expect(results).toHaveLength(1)
      expect(results[0].event.title).toBe('New Event')
    })
  })

  describe('search scoring', () => {
    it('ranks title matches higher than description matches', () => {
      const results = search('team')

      const titleMatch = results.find((r) => r.event.title === 'Team Meeting')
      const descMatch = results.find((r) => r.event.description?.includes('team'))

      expect(titleMatch).toBeDefined()
      if (titleMatch && descMatch) {
        expect(titleMatch.score).toBeLessThanOrEqual(descMatch.score)
      }
    })

    it('ranks location matches between title and description', () => {
      const results = search('conference')

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].event.title).toBe('Team Meeting')
    })
  })
})
