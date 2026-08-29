import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from '@/types'
import {
  EMPTY_COMMAND_PALETTE_FILTER,
  eventMatchesText,
  getFilteredEvents,
  parseFilterTokens,
  type CommandPaletteFilter,
} from '../eventFilters'

const event = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'event-1',
  calendarId: 'calendar-1',
  title: 'Team planning',
  description: 'Discuss roadmap',
  location: 'Copenhagen office',
  start: '2026-08-10T09:00:00.000Z',
  end: '2026-08-10T10:00:00.000Z',
  isAllDay: false,
  timezone: 'UTC',
  ...overrides,
})

const filter = (overrides: Partial<CommandPaletteFilter> = {}): CommandPaletteFilter => ({
  ...EMPTY_COMMAND_PALETTE_FILTER,
  ...overrides,
})

describe('command-palette event filters', () => {
  it('tokenizes quoted phrases and escaped spaces', () => {
    expect(parseFilterTokens('team "road map" Copenhagen\\ office')).toEqual([
      'team',
      'road map',
      'Copenhagen office',
    ])
  })

  it("keeps apostrophes inside ordinary words", () => {
    expect(parseFilterTokens("Bob's meeting")).toEqual(["Bob's", 'meeting'])
  })

  it('matches included terms as a case-insensitive OR across title and description', () => {
    expect(eventMatchesText(event(), filter({ includedTerms: ['planning', 'budget'] }))).toBe(true)
    expect(eventMatchesText(event(), filter({ includedTerms: ['budget', 'finance'] }))).toBe(false)
  })

  it('applies location and excluded-keyword matching', () => {
    expect(eventMatchesText(event(), filter({ location: 'penhagen' }))).toBe(true)
    expect(eventMatchesText(event(), filter({ excludedKeywords: ['OFFICE'] }))).toBe(false)
  })

  it('reports reversed ranges and ignores the invalid date constraint', () => {
    const result = getFilteredEvents(
      [event()],
      filter({ fromDate: '2026-08-20', toDate: '2026-08-01' })
    )
    expect(result.invalidDateRange).toBe(true)
    expect(result.matches.map(({ event: match }) => match.id)).toEqual(['event-1'])
  })

  it('uses inclusive overlap and returns the first qualifying occurrence', () => {
    const recurring = event({
      id: 'series',
      start: '2026-08-01T09:00:00.000Z',
      end: '2026-08-01T10:00:00.000Z',
      rruleString: 'FREQ=DAILY;COUNT=5',
    })
    const result = getFilteredEvents(
      [recurring],
      filter({ fromDate: '2026-08-03', toDate: '2026-08-03' }),
      new Date('2026-07-01T00:00:00.000Z')
    )
    expect(result.matches[0]?.event.id).toBe('series')
    expect(result.matches[0]?.occurrence?.occStartStr).toBe('2026-08-03T09:00:00.000Z')
  })

  it('treats all-day end dates as exclusive and supports open-ended ranges', () => {
    const allDay = event({
      id: 'all-day',
      start: '2026-08-10T00:00:00',
      end: '2026-08-11T00:00:00',
      isAllDay: true,
      timezone: undefined,
    })
    expect(
      getFilteredEvents([allDay], filter({ fromDate: '2026-08-10', toDate: '2026-08-10' })).matches
    ).toHaveLength(1)
    expect(getFilteredEvents([allDay], filter({ fromDate: '2026-08-11' })).matches).toHaveLength(0)
  })

  it('includes the final day of an all-day event stored with an inclusive end', () => {
    const allDay = event({
      id: 'inclusive-all-day',
      start: '2026-08-10T00:00:00',
      end: '2026-08-12T23:59:59',
      isAllDay: true,
      timezone: undefined,
    })

    expect(
      getFilteredEvents(
        [allDay],
        filter({ fromDate: '2026-08-12', toDate: '2026-08-12' })
      ).matches
    ).toHaveLength(1)
  })

  it('lets a detached override restore an EXDATEd occurrence', () => {
    const master = event({
      id: 'series',
      start: '2026-08-01T09:00:00.000Z',
      end: '2026-08-01T10:00:00.000Z',
      rruleString: 'FREQ=DAILY;COUNT=3',
      excludedDates: ['2026-08-02T09:00:00.000Z'],
    })
    const override = event({
      id: 'override',
      title: 'Team planning — moved',
      recurrenceMasterId: 'series',
      recurrenceId: '2026-08-02T09:00:00.000Z',
      start: '2026-08-02T14:00:00.000Z',
      end: '2026-08-02T15:00:00.000Z',
    })
    const result = getFilteredEvents(
      [master, override],
      filter({ includedTerms: ['moved'], fromDate: '2026-08-02', toDate: '2026-08-02' })
    )
    expect(result.matches[0]?.event.id).toBe('override')
    expect(result.matches[0]?.occurrence?.occStartStr).toBe('2026-08-02T14:00:00.000Z')
  })

  it('skips a cancelled detached representative and uses the next occurrence', () => {
    const master = event({
      id: 'series',
      start: '2026-08-01T09:00:00.000Z',
      end: '2026-08-01T10:00:00.000Z',
      rruleString: 'FREQ=DAILY;COUNT=4',
    })
    const cancelled = event({
      id: 'cancelled',
      recurrenceMasterId: 'series',
      recurrenceId: '2026-08-02T09:00:00.000Z',
      start: '2026-08-02T09:00:00.000Z',
      end: '2026-08-02T10:00:00.000Z',
      eventStatus: 'CANCELLED',
    })

    const result = getFilteredEvents(
      [master, cancelled],
      filter(),
      new Date('2026-08-02T08:00:00.000Z')
    )

    expect(result.matches[0]?.event.id).toBe('series')
    expect(result.matches[0]?.occurrence?.occStartStr).toBe('2026-08-03T09:00:00.000Z')
  })

  it('keeps a renamed detached representative under the matching series', () => {
    const master = event({
      id: 'series',
      start: '2026-08-01T09:00:00.000Z',
      end: '2026-08-01T10:00:00.000Z',
      rruleString: 'FREQ=DAILY;COUNT=4',
    })
    const renamed = event({
      id: 'renamed',
      title: 'Different title',
      recurrenceMasterId: 'series',
      recurrenceId: '2026-08-02T09:00:00.000Z',
      start: '2026-08-02T09:00:00.000Z',
      end: '2026-08-02T10:00:00.000Z',
    })

    const result = getFilteredEvents(
      [master, renamed],
      filter({ includedTerms: ['planning'] }),
      new Date('2026-08-02T08:00:00.000Z')
    )

    expect(result.matches[0]?.event.id).toBe('series')
    expect(result.matches[0]?.occurrence?.occStartStr).toBe('2026-08-02T09:00:00.000Z')
  })

  it('finds open-ended recurrences beyond a ten-year horizon', () => {
    const recurring = event({
      id: 'long-interval',
      start: '2026-01-01T09:00:00.000Z',
      end: '2026-01-01T10:00:00.000Z',
      rruleString: 'FREQ=YEARLY;INTERVAL=20',
    })

    const result = getFilteredEvents(
      [recurring],
      filter({ fromDate: '2026-01-02' }),
      new Date('2026-01-01T00:00:00.000Z')
    )

    expect(result.matches[0]?.occurrence?.occStartStr).toBe('2046-01-01T09:00:00.000Z')
  })

  it('does not walk an infinite series when its metadata cannot match', () => {
    const recurring = event({
      id: 'unrelated-series',
      title: 'Unrelated',
      rruleString: 'FREQ=DAILY',
    })

    expect(
      getFilteredEvents([recurring], filter({ terms: ['missing'], fromDate: '2026-08-01' }))
        .matches
    ).toHaveLength(0)
  })

  it('filters tasks by due date rather than their DTSTART span', () => {
    const task = event({
      id: 'task',
      type: 'task',
      start: '2026-08-01T09:00:00.000Z',
      end: '2026-08-01T10:00:00.000Z',
      dueDate: '2026-08-10',
    })

    expect(
      getFilteredEvents([task], filter({ fromDate: '2026-08-01', toDate: '2026-08-01' })).matches
    ).toHaveLength(0)
    expect(
      getFilteredEvents([task], filter({ fromDate: '2026-08-10', toDate: '2026-08-10' })).matches
    ).toHaveLength(1)
  })

  it('preserves a TZID series duration across a daylight-saving transition', () => {
    const recurring = event({
      id: 'dst-series',
      start: '2026-11-01T00:30:00',
      end: '2026-11-01T02:30:00',
      timezone: 'America/New_York',
      rruleString: 'FREQ=DAILY;COUNT=1',
    })
    const result = getFilteredEvents(
      [recurring],
      filter({ fromDate: '2026-11-01', toDate: '2026-11-01' })
    )

    expect(result.matches[0]?.occurrence?.occStartStr).toBe('2026-11-01T04:30:00.000Z')
    expect(result.matches[0]?.occurrence?.occEndStr).toBe('2026-11-01T07:30:00.000Z')
  })

  it('uses each generated task occurrence due date for date ranges', () => {
    const recurringTask = event({
      id: 'recurring-task',
      type: 'task',
      start: '2026-08-01T09:00:00.000Z',
      end: '2026-08-01T10:00:00.000Z',
      dueDate: '2026-08-01T17:00:00.000Z',
      rruleString: 'FREQ=DAILY;COUNT=3',
    })

    expect(
      getFilteredEvents(
        [recurringTask],
        filter({ fromDate: '2026-08-02', toDate: '2026-08-02' })
      ).matches
    ).toHaveLength(1)
  })
})
