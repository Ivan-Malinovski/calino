import { afterEach, describe, it, expect, vi } from 'vitest'
import type { CalendarEvent } from '@/types'
import { parseICALData } from '@/features/caldav/adapter/iCalendarAdapter'
import { createJmapCalendarBackend } from '@/features/jmap/backend/JmapCalendarBackend'
import { FakeJmapServer } from '@/features/jmap/backend/__tests__/fakeServer'
import { JmapContactsBackend } from '@/features/jmap/contacts/JmapContactsBackend'
import { FakeContactsServer } from '@/features/jmap/contacts/__tests__/fakeServer'
import {
  collectAttendeeSuggestions,
  contactPeople,
  matchAttendeeSuggestions,
  ownAddressesOf,
} from '../attendeeSuggestions'

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

describe('ownAddressesOf', () => {
  it('takes the calendar user address and an address-shaped username', () => {
    expect(
      ownAddressesOf([
        { username: 'me@example.com', calendarUserAddress: 'me.alias@example.com' },
        { username: 'login', calendarUserAddress: null },
        { username: 'login2' },
      ])
    ).toEqual(['me.alias@example.com', 'me@example.com', '', 'login', '', 'login2'])
  })
})

/**
 * JMAP accounts feed the same stores as CalDAV and CardDAV ones: events reach
 * the calendar store as iCalendar converted from JSCalendar, contacts reach the
 * contact store as vCards converted from JSContact, and the account's user is
 * its default participant identity. These run the real backends against the
 * in-memory JMAP servers the backend tests use.
 */
describe('attendee suggestions from a JMAP account', () => {
  // The origins the in-memory servers answer as.
  const credentials = (origin: string) => ({
    id: 'credential',
    serverUrl: origin,
    username: 'login',
    password: '',
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('offers the participants of JMAP events, never the account identity', async () => {
    const server = new FakeJmapServer()
    vi.stubGlobal('fetch', server.fetch)
    server.identities = [
      { id: 'me', calendarAddress: 'mailto:owner@example.com', name: 'Owner', isDefault: true },
    ]
    server.seed({
      id: 'planning',
      title: 'Planning',
      start: '2026-11-04T10:00:00',
      participants: {
        owner: {
          '@type': 'Participant',
          calendarAddress: 'mailto:owner@example.com',
          name: 'Owner',
          roles: { owner: true, attendee: true },
        },
        alice: {
          '@type': 'Participant',
          calendarAddress: 'mailto:alice@example.com',
          name: 'Alice Example',
          roles: { attendee: true },
        },
        bob: {
          '@type': 'Participant',
          sendTo: { imip: 'mailto:Bob@Example.com' },
          roles: { optional: true },
        },
      },
    })
    const backend = await createJmapCalendarBackend(
      'https://calendar.test',
      credentials('https://calendar.test'),
      null
    )
    const calendarUrl = (await backend.fetchCalendars())[0]!.url
    const events = (await backend.fetchEvents(calendarUrl, '', '', true)).objects.flatMap(
      (object) => parseICALData(object.data, 'jmap-calendar')
    )
    const user = await backend.fetchCalendarUser!()

    const result = collectAttendeeSuggestions({
      events,
      ownAddresses: ownAddressesOf([{ username: 'login', calendarUserAddress: user?.address }]),
      now: NOW,
    })
    expect(result).toEqual([
      { email: 'alice@example.com', name: 'Alice Example', score: 2 },
      { email: 'bob@example.com', name: undefined, score: 2 },
    ])
  })

  it('offers the email addresses of a JMAP address book', async () => {
    const server = new FakeContactsServer()
    vi.stubGlobal('fetch', server.fetch)
    server.seed({
      '@type': 'Card',
      version: '1.0',
      name: { '@type': 'Name', full: 'Carol Example' },
      emails: {
        work: { '@type': 'EmailAddress', address: 'carol@example.com' },
        home: { '@type': 'EmailAddress', address: 'carol.home@example.org' },
      },
    })
    server.seed({ '@type': 'Card', version: '1.0', name: { '@type': 'Name', full: 'No Email' } })
    const backend = new JmapContactsBackend(
      'https://contacts.test',
      credentials('https://contacts.test')
    )
    await backend.connect()
    const book = { ...(await backend.fetchAddressBooks())[0]!, accountId: 'jmap-account' }
    const contacts = await backend.fetchContacts(book)

    const result = collectAttendeeSuggestions({
      events: [],
      contacts: contactPeople(contacts),
      now: NOW,
    })
    expect(result.map((s) => [s.email, s.name])).toEqual([
      ['carol.home@example.org', 'Carol Example'],
      ['carol@example.com', 'Carol Example'],
    ])
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
