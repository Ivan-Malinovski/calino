import { describe, it, expect } from 'vitest'
import type { CalendarEvent } from '@/types'
import { collectAttendeeSuggestions, matchAttendeeSuggestions } from '../attendeeSuggestions'

const NOW = new Date('2026-11-03T12:00:00Z')

function meeting(
  id: string,
  start: string,
  people: { attendees?: [string, string?][]; organizer?: [string, string?] },
  extra: Partial<CalendarEvent> = {}
): CalendarEvent {
  return {
    id,
    uid: id,
    calendarId: 'cal',
    title: id,
    start,
    end: start,
    isAllDay: false,
    attendees: people.attendees?.map(([email, name]) => ({ email, name })),
    organizer: people.organizer
      ? { email: people.organizer[0], name: people.organizer[1] }
      : undefined,
    ...extra,
  }
}

describe('collectAttendeeSuggestions', () => {
  it('ranks people by the meetings they took part in, recent ones counting double', () => {
    const events = [
      // Old meetings: weight 1 each.
      meeting('a', '2025-01-10T09:00:00Z', { attendees: [['old@example.com']] }),
      meeting('b', '2025-02-10T09:00:00Z', { attendees: [['old@example.com']] }),
      meeting('c', '2025-03-10T09:00:00Z', { attendees: [['old@example.com']] }),
      // Recent meetings: weight 2 each.
      meeting('d', '2026-10-20T09:00:00Z', { attendees: [['team@example.com']] }),
      meeting('e', '2026-11-10T09:00:00Z', { attendees: [['team@example.com']] }),
      meeting('f', '2026-10-01T09:00:00Z', { attendees: [['once@example.com']] }),
    ]
    const result = collectAttendeeSuggestions({ events, now: NOW })
    expect(result.map((s) => [s.email, s.score])).toEqual([
      ['team@example.com', 4],
      ['old@example.com', 3],
      ['once@example.com', 2],
    ])
  })

  it('counts a recurring meeting once, however many occurrences are loaded', () => {
    const events = [
      meeting('series', '2026-11-02T09:00:00Z', { attendees: [['weekly@example.com']] }),
      meeting(
        'series-2',
        '2026-11-09T09:00:00Z',
        { attendees: [['weekly@example.com']] },
        { occurrenceMasterId: 'series' }
      ),
      meeting(
        'series-3',
        '2026-11-16T09:00:00Z',
        { attendees: [['weekly@example.com']] },
        { occurrenceMasterId: 'series' }
      ),
    ]
    expect(collectAttendeeSuggestions({ events, now: NOW })).toEqual([
      { email: 'weekly@example.com', name: undefined, score: 2 },
    ])
  })

  it('counts organizers, leaves out the user and invalid addresses', () => {
    const events = [
      meeting('a', '2026-11-04T09:00:00Z', {
        organizer: ['MAILTO:Boss@Example.com', 'The Boss'],
        attendees: [['me@example.com'], ['not an address'], ['peer@example.com']],
      }),
    ]
    const result = collectAttendeeSuggestions({
      events,
      ownAddresses: ['Me@Example.com'],
      now: NOW,
    })
    expect(result.map((s) => s.email)).toEqual(['boss@example.com', 'peer@example.com'])
    expect(result[0]?.name).toBe('The Boss')
  })

  it('keeps the name from the most recently modified meeting', () => {
    const events = [
      meeting(
        'a',
        '2026-11-04T09:00:00Z',
        { attendees: [['ann@example.com', 'Ann']] },
        { lastModified: '2026-11-04T08:00:00Z' }
      ),
      meeting(
        'b',
        '2026-11-01T09:00:00Z',
        { attendees: [['ann@example.com', 'Ann Example']] },
        { lastModified: '2026-11-05T08:00:00Z' }
      ),
      meeting(
        'c',
        '2026-11-02T09:00:00Z',
        { attendees: [['ann@example.com']] },
        { lastModified: '2026-11-06T08:00:00Z' }
      ),
    ]
    expect(collectAttendeeSuggestions({ events, now: NOW })[0]?.name).toBe('Ann Example')
  })

  it('offers calendar owners and contacts below anyone already met', () => {
    const events = [meeting('a', '2024-01-01T09:00:00Z', { attendees: [['met@example.com']] })]
    const result = collectAttendeeSuggestions({
      events,
      calendarOwners: [{ email: 'owner@example.com', name: 'Owner' }],
      contacts: [
        { email: 'contact@example.com', name: 'Contact' },
        // Already an owner: listed once, at the owner's rank.
        { email: 'OWNER@example.com', name: 'Owner (address book)' },
      ],
      now: NOW,
    })
    expect(result.map((s) => [s.email, s.name])).toEqual([
      ['met@example.com', undefined],
      ['owner@example.com', 'Owner'],
      ['contact@example.com', 'Contact'],
    ])
  })

  it('makes nothing up from an empty store', () => {
    expect(collectAttendeeSuggestions({ events: [], now: NOW })).toEqual([])
  })
})

describe('matchAttendeeSuggestions', () => {
  const list = [
    { email: 'jose.garcia@example.com', name: 'José García', score: 5 },
    { email: 'ann@example.org', name: 'Ann Example', score: 4 },
    { email: 'bob+team@example.com', score: 3 },
    { email: 'carol@other.example', name: 'Carol', score: 2 },
  ]

  it('keeps the best ones for an empty query', () => {
    expect(matchAttendeeSuggestions(list, '', [], 2).map((s) => s.email)).toEqual([
      'jose.garcia@example.com',
      'ann@example.org',
    ])
  })

  it('matches the start of the address, a part of it, or a word of the name', () => {
    expect(matchAttendeeSuggestions(list, 'ann').map((s) => s.email)).toEqual(['ann@example.org'])
    expect(matchAttendeeSuggestions(list, 'garc').map((s) => s.email)).toEqual([
      'jose.garcia@example.com',
    ])
    expect(matchAttendeeSuggestions(list, 'team').map((s) => s.email)).toEqual([
      'bob+team@example.com',
    ])
    expect(matchAttendeeSuggestions(list, 'exam').map((s) => s.email)).toEqual(['ann@example.org'])
  })

  it('ignores accents and case', () => {
    expect(matchAttendeeSuggestions(list, 'JOSÉ').map((s) => s.email)).toEqual([
      'jose.garcia@example.com',
    ])
    expect(matchAttendeeSuggestions(list, 'garcía').map((s) => s.email)).toEqual([
      'jose.garcia@example.com',
    ])
  })

  it('matches a domain typed with its @', () => {
    expect(matchAttendeeSuggestions(list, '@other').map((s) => s.email)).toEqual([
      'carol@other.example',
    ])
  })

  it('leaves out attendees already added', () => {
    expect(
      matchAttendeeSuggestions(list, '', ['ANN@example.org', 'carol@other.example']).map(
        (s) => s.email
      )
    ).toEqual(['jose.garcia@example.com', 'bob+team@example.com'])
  })

  it('matches nothing for a query nobody fits', () => {
    expect(matchAttendeeSuggestions(list, 'zzz')).toEqual([])
  })
})
