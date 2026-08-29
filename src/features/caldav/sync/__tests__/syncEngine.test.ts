import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  SyncEngine,
  createSyncEngine,
  eventResourceFilename,
  resourceIsInCollection,
} from '../syncEngine'
import type { CalendarEvent } from '@/types'
import type { CalDAVClient } from '../../client/CalDAVClient'
import * as storage from '../accountStorage'
import { eventToICAL } from '../../adapter/iCalendarAdapter'

vi.mock('../accountStorage', () => ({
  getAllCalendars: vi.fn(),
}))

// A Map stands in for the IndexedDB raw-ICS store so these tests can assert
// what the engine captured, and read it back through the real getRawIcs shape.
const rawIcs = vi.hoisted(() => new Map<string, { ics: string; etag?: string }>())

vi.mock('@/lib/rawIcsStore', () => ({
  putRawIcs: vi.fn(async (href: string, _calendarId: string, ics: string, etag?: string) => {
    rawIcs.set(href, { ics, etag })
  }),
  getRawIcs: vi.fn(async (href: string) => rawIcs.get(href)),
  deleteRawIcs: vi.fn(async (href: string) => {
    rawIcs.delete(href)
  }),
}))

const mockGetAllCalendars = vi.mocked(storage.getAllCalendars)

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'event-1',
    calendarId: 'cal-1',
    title: 'Test Event',
    start: '2024-03-15T14:00:00Z',
    end: '2024-03-15T15:00:00Z',
    isAllDay: false,
    ...overrides,
  }
}

describe('SyncEngine', () => {
  let engine: SyncEngine
  let mockClient: Partial<CalDAVClient>

  beforeEach(() => {
    vi.clearAllMocks()

    mockGetAllCalendars.mockReturnValue([
      {
        id: 'cal-1',
        accountId: 'acc-1',
        url: 'https://caldav.example.com/calendars/test/default/',
        name: 'Default',
        color: '#4285F4',
        ctag: null,
        syncToken: null,
        isVisible: true,
        isDefault: true,
      },
    ])

    mockClient = {
      fetchEvents: vi.fn().mockResolvedValue([]),
      createEvent: vi.fn().mockResolvedValue({ url: 'https://example.com/event.ics', etag: '1' }),
      updateEvent: vi.fn().mockResolvedValue({ url: 'https://example.com/event.ics', etag: '2' }),
      deleteEvent: vi.fn().mockResolvedValue(undefined),
    }

    engine = createSyncEngine(mockClient as CalDAVClient, 'cal-1')
  })

  describe('Bug 33: isNewer uses sequence, not start time', () => {
    it('returns no updates when sequences are equal (even with different start times)', async () => {
      const local = makeEvent({ sequence: 2, start: '2024-01-01T00:00:00Z' })

      mockClient.fetchEvents = vi.fn().mockResolvedValue([
        {
          url: 'https://caldav.example.com/event.ics',
          data: `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:event-1\nDTSTART:20240601T000000Z\nDTEND:20240601T010000Z\nSUMMARY:Test Event\nSEQUENCE:2\nEND:VEVENT\nEND:VCALENDAR`,
          etag: '"etag-1"',
        },
      ])

      const result = await engine.fullSync(
        '2024-01-01T00:00:00Z',
        '2024-12-31T23:59:59Z',
        [local]
      )

      // Server event has same sequence as local — should NOT be marked as updated
      expect(result.result.updated).not.toContain('event-1')
    })

    it('marks server event as newer when server sequence is higher', async () => {
      const local = makeEvent({ sequence: 1 })

      mockClient.fetchEvents = vi.fn().mockResolvedValue([
        {
          url: 'https://caldav.example.com/event.ics',
          data: `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:event-1\nDTSTART:20240315T140000Z\nDTEND:20240315T150000Z\nSUMMARY:Test Event\nSEQUENCE:3\nEND:VEVENT\nEND:VCALENDAR`,
          etag: '"etag-1"',
        },
      ])

      const result = await engine.fullSync('2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z', [local])

      expect(result.result.updated).toContain('event-1')
    })

    it('does NOT mark server event as newer when local sequence is higher', async () => {
      const local = makeEvent({ sequence: 5 })

      mockClient.fetchEvents = vi.fn().mockResolvedValue([
        {
          url: 'https://caldav.example.com/event.ics',
          data: `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:event-1\nDTSTART:20240315T140000Z\nDTEND:20240315T150000Z\nSUMMARY:Test Event\nSEQUENCE:2\nEND:VEVENT\nEND:VCALENDAR`,
          etag: '"etag-1"',
        },
      ])

      const result = await engine.fullSync('2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z', [local])

      // Local has higher sequence, so server event should NOT be marked as updated
      expect(result.result.updated).not.toContain('event-1')
    })

    it('treats events as equal when both sequences are undefined', async () => {
      const local = makeEvent({ start: '2024-01-01T00:00:00Z' })

      mockClient.fetchEvents = vi.fn().mockResolvedValue([
        {
          url: 'https://caldav.example.com/event.ics',
          data: `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:event-1\nDTSTART:20240601T000000Z\nDTEND:20240601T010000Z\nSUMMARY:Test Event\nEND:VEVENT\nEND:VCALENDAR`,
          etag: '"etag-1"',
        },
      ])

      const result = await engine.fullSync('2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z', [local])

      // Same sequence (both undefined = 0) — should NOT be updated
      expect(result.result.updated).not.toContain('event-1')
    })

    it('treats events as equal when both sequences are explicitly 0', async () => {
      const local = makeEvent({ sequence: 0, start: '2024-01-01T00:00:00Z' })

      mockClient.fetchEvents = vi.fn().mockResolvedValue([
        {
          url: 'https://caldav.example.com/event.ics',
          data: `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:event-1\nDTSTART:20240601T000000Z\nDTEND:20240601T010000Z\nSUMMARY:Test Event\nSEQUENCE:0\nEND:VEVENT\nEND:VCALENDAR`,
          etag: '"etag-1"',
        },
      ])

      const result = await engine.fullSync('2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z', [local])

      expect(result.result.updated).not.toContain('event-1')
    })

    it('does not treat missing events as deleted after a partial component fetch', async () => {
      const local = makeEvent()
      mockClient.fetchEvents = vi.fn().mockResolvedValue({
        objects: [],
        hadComponentFailures: true,
      })

      const result = await engine.fullSync('2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z', [local])

      expect(result.result.deleted).not.toContain(local.id)
    })
  })

  it('uses a WebDAV-safe filename for recurrence instance IDs', async () => {
    const event = makeEvent({ id: 'event-1-2026-07-15T15:20:00.000Z' })

    await engine.pushEvent(event)
    await engine.updateEvent(event, '"etag"')

    const expectedFilename = 'event-1-2026-07-15T15~3A20~3A00.000Z.ics'
    expect(eventResourceFilename(event.id)).toBe(expectedFilename)
    expect(mockClient.createEvent).toHaveBeenCalledWith(
      'https://caldav.example.com/calendars/test/default/',
      expect.any(String),
      expectedFilename
    )
    expect(mockClient.updateEvent).toHaveBeenCalledWith(
      'https://caldav.example.com/calendars/test/default/',
      `https://caldav.example.com/calendars/test/default/${expectedFilename}`,
      expect.any(String),
      '"etag"'
    )
  })

  it('updates a fetched event at its original CalDAV resource URL', async () => {
    const event = makeEvent({
      resourceHref: 'https://caldav.example.com/calendars/test/default/server-generated.ics',
    })

    await engine.updateEvent(event, '"etag"')

    expect(mockClient.updateEvent).toHaveBeenCalledWith(
      'https://caldav.example.com/calendars/test/default/',
      event.resourceHref,
      expect.any(String),
      '"etag"'
    )
  })

  it('updates a recurrence master and override in the same resource', async () => {
    const master = makeEvent({
      uid: 'series-uid',
      resourceHref: 'https://caldav.example.com/calendars/test/default/series.ics',
      rruleString: 'FREQ=WEEKLY',
    })
    const exception = makeEvent({
      id: 'series-uid-2024-03-22T14:00:00.000Z',
      uid: 'series-uid',
      recurrenceId: '2024-03-22T14:00:00.000Z',
      recurrenceMasterId: master.id,
    })

    await engine.updateEventGroup([master, exception], '"etag"')

    expect(mockClient.updateEvent).toHaveBeenCalledWith(
      'https://caldav.example.com/calendars/test/default/',
      master.resourceHref,
      expect.stringContaining('RECURRENCE-ID:20240322T140000Z'),
      '"etag"'
    )
    const body = vi.mocked(mockClient.updateEvent!).mock.calls[0][2]
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(body.match(/UID:series-uid/g)).toHaveLength(2)
  })
})

describe('resourceIsInCollection', () => {
  const collection = 'https://caldav.example.com/calendars/test/personal/'

  it('accepts a resource inside the collection', () => {
    expect(resourceIsInCollection(`${collection}event.ics`, collection)).toBe(true)
  })

  it('accepts an origin-relative href', () => {
    expect(resourceIsInCollection('/calendars/test/personal/event.ics', collection)).toBe(true)
  })

  it('rejects a resource in a sibling collection', () => {
    expect(
      resourceIsInCollection('https://caldav.example.com/calendars/test/work/event.ics', collection)
    ).toBe(false)
  })

  it('rejects a resource on another origin', () => {
    expect(
      resourceIsInCollection(
        'https://other.example.com/calendars/test/personal/event.ics',
        collection
      )
    ).toBe(false)
  })

  it('tolerates a collection url without a trailing slash', () => {
    expect(resourceIsInCollection(`${collection}event.ics`, collection.slice(0, -1))).toBe(true)
  })

  it('does not treat a prefix-sharing sibling as inside the collection', () => {
    // `.../personal-archive/` starts with `.../personal` as a raw string.
    expect(
      resourceIsInCollection(
        'https://caldav.example.com/calendars/test/personal-archive/event.ics',
        collection
      )
    ).toBe(false)
  })

  it('returns false rather than throwing when the collection url is unusable', () => {
    expect(resourceIsInCollection(`${collection}event.ics`, 'not-a-url')).toBe(false)
  })
})

describe('SyncEngine — writes stay inside the target collection (#86)', () => {
  let engine: SyncEngine
  let mockClient: Partial<CalDAVClient>
  const workUrl = 'https://caldav.example.com/calendars/test/work/'
  const personalHref = 'https://caldav.example.com/calendars/test/personal/moved.ics'

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAllCalendars.mockReturnValue([
      {
        id: 'cal-work',
        accountId: 'acc-1',
        url: workUrl,
        name: 'Work',
        color: '#EF4444',
        ctag: null,
        syncToken: null,
        isVisible: true,
        isDefault: false,
      },
    ])
    mockClient = {
      createEvent: vi.fn().mockResolvedValue({ url: 'x', etag: '1' }),
      updateEvent: vi.fn().mockResolvedValue({ url: 'x', etag: '2' }),
      deleteEvent: vi.fn().mockResolvedValue(undefined),
    }
    engine = createSyncEngine(mockClient as CalDAVClient, 'cal-work')
  })

  it('updateEvent ignores an href belonging to a different calendar', async () => {
    // This is the reported bug: the event was reassigned to Work, but the PUT
    // went to its old Personal href, so the next sync pulled it back.
    const event = makeEvent({ id: 'moved', calendarId: 'cal-work', resourceHref: personalHref })

    await engine.updateEvent(event, '"etag"')

    const [, targetUrl] = vi.mocked(mockClient.updateEvent!).mock.calls[0]
    expect(targetUrl).toBe(`${workUrl}${eventResourceFilename('moved')}`)
    expect(targetUrl).not.toBe(personalHref)
  })

  it('updateEventGroup ignores an href belonging to a different calendar', async () => {
    const master = makeEvent({
      id: 'series',
      uid: 'series',
      calendarId: 'cal-work',
      resourceHref: 'https://caldav.example.com/calendars/test/personal/series.ics',
      rruleString: 'FREQ=WEEKLY',
    })
    const override = makeEvent({
      id: 'series-2024-03-22T14:00:00.000Z',
      uid: 'series',
      recurrenceId: '2024-03-22T14:00:00.000Z',
      recurrenceMasterId: master.id,
    })

    await engine.updateEventGroup([master, override], '"etag"')

    const [, targetUrl] = vi.mocked(mockClient.updateEvent!).mock.calls[0]
    expect(targetUrl).toBe(`${workUrl}${eventResourceFilename('series')}`)
  })

  it('putEventGroup writes at the target collection with no If-Match', async () => {
    // An empty etag is what makes a retried move idempotent: tsdav drops a
    // falsy If-Match, so re-running the move overwrites its own partial result.
    const event = makeEvent({ id: 'moved', resourceHref: personalHref })

    await engine.putEventGroup([event])

    const [collectionUrl, targetUrl, , etag] = vi.mocked(mockClient.updateEvent!).mock.calls[0]
    expect(collectionUrl).toBe(workUrl)
    expect(targetUrl).toBe(`${workUrl}${eventResourceFilename('moved')}`)
    expect(etag).toBe('')
  })

  it('putEventGroup serializes a whole recurrence group into one resource', async () => {
    const master = makeEvent({ id: 'series', uid: 'series', rruleString: 'FREQ=WEEKLY' })
    const override = makeEvent({
      id: 'series-2024-03-22T14:00:00.000Z',
      uid: 'series',
      recurrenceId: '2024-03-22T14:00:00.000Z',
      recurrenceMasterId: master.id,
    })

    await engine.putEventGroup([master, override])

    const body = vi.mocked(mockClient.updateEvent!).mock.calls[0][2]
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(body).toContain('RECURRENCE-ID:20240322T140000Z')
  })
})

describe('SyncEngine — retains the original iCalendar text', () => {
  const calendarUrl = 'https://caldav.example.com/calendars/test/default/'
  let engine: SyncEngine
  let mockClient: Partial<CalDAVClient>

  const serverIcs = (uid: string) =>
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      'DTSTART:20240601T000000Z',
      'DTEND:20240601T010000Z',
      'SUMMARY:Test Event',
      // The whole point: properties Calino does not model must survive, so the
      // captured text has to be the bytes the server sent, not a re-serialize.
      'GEO:55.6761;12.5683',
      'X-CUSTOM-PROP:keep me',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n')

  beforeEach(() => {
    vi.clearAllMocks()
    rawIcs.clear()

    mockGetAllCalendars.mockReturnValue([
      {
        id: 'cal-1',
        accountId: 'acc-1',
        url: calendarUrl,
        name: 'Default',
        color: '#4285F4',
        ctag: null,
        syncToken: null,
        isVisible: true,
        isDefault: true,
      },
    ])

    mockClient = {
      fetchEvents: vi.fn().mockResolvedValue([]),
      createEvent: vi.fn().mockResolvedValue({ url: `${calendarUrl}created.ics`, etag: '"1"' }),
      updateEvent: vi
        .fn()
        .mockImplementation(async (_collection: string, url: string) => ({ url, etag: '"2"' })),
      deleteEvent: vi.fn().mockResolvedValue(undefined),
    }

    engine = createSyncEngine(mockClient as CalDAVClient, 'cal-1')
  })

  it('stores each fetched resource verbatim, with its etag', async () => {
    const first = serverIcs('event-1')
    const second = serverIcs('event-2')
    mockClient.fetchEvents = vi.fn().mockResolvedValue([
      { url: `${calendarUrl}one.ics`, data: first, etag: '"etag-1"' },
      { url: `${calendarUrl}two.ics`, data: second, etag: '"etag-2"' },
    ])

    await engine.fullSync('2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z', [])

    expect(rawIcs.get(`${calendarUrl}one.ics`)).toEqual({ ics: first, etag: '"etag-1"' })
    expect(rawIcs.get(`${calendarUrl}two.ics`)).toEqual({ ics: second, etag: '"etag-2"' })
  })

  it('keeps syncing when the raw-ICS store fails', async () => {
    const { putRawIcs } = await import('@/lib/rawIcsStore')
    vi.mocked(putRawIcs).mockRejectedValueOnce(new Error('quota exceeded'))
    mockClient.fetchEvents = vi
      .fn()
      .mockResolvedValue([
        { url: `${calendarUrl}one.ics`, data: serverIcs('event-1'), etag: '"etag-1"' },
      ])

    const result = await engine.fullSync('2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z', [])

    expect(result.events).toHaveLength(1)
  })

  it('stores the exact bytes pushEvent sent, at the url the server returned', async () => {
    await engine.pushEvent(makeEvent())

    const sent = vi.mocked(mockClient.createEvent!).mock.calls[0][1]
    expect(rawIcs.get(`${calendarUrl}created.ics`)).toEqual({ ics: sent, etag: '"1"' })
  })

  it('stores the exact bytes updateEvent sent', async () => {
    const event = makeEvent({ resourceHref: `${calendarUrl}server-generated.ics` })

    await engine.updateEvent(event, '"etag"')

    const sent = vi.mocked(mockClient.updateEvent!).mock.calls[0][2]
    expect(rawIcs.get(`${calendarUrl}server-generated.ics`)).toEqual({ ics: sent, etag: '"2"' })
  })

  it('stores the exact bytes updateEventGroup sent, once for the whole group', async () => {
    const master = makeEvent({
      uid: 'series-uid',
      resourceHref: `${calendarUrl}series.ics`,
      rruleString: 'FREQ=WEEKLY',
    })
    const override = makeEvent({
      id: 'series-uid-2024-03-22T14:00:00.000Z',
      uid: 'series-uid',
      recurrenceId: '2024-03-22T14:00:00.000Z',
      recurrenceMasterId: master.id,
    })

    await engine.updateEventGroup([master, override], '"etag"')

    const sent = vi.mocked(mockClient.updateEvent!).mock.calls[0][2]
    expect(rawIcs.size).toBe(1)
    expect(rawIcs.get(`${calendarUrl}series.ics`)).toEqual({ ics: sent, etag: '"2"' })
  })

  it('stores the exact bytes putEventGroup sent', async () => {
    await engine.putEventGroup([makeEvent({ id: 'moved' })])

    const sent = vi.mocked(mockClient.updateEvent!).mock.calls[0][2]
    expect(rawIcs.get(`${calendarUrl}${eventResourceFilename('moved')}`)).toEqual({
      ics: sent,
      etag: '"2"',
    })
  })

  it('drops the original when the resource is deleted', async () => {
    await engine.pushEvent(makeEvent())
    await engine.deleteEvent(`${calendarUrl}created.ics`, '"1"')

    expect(rawIcs.has(`${calendarUrl}created.ics`)).toBe(false)
  })

  it('captures under the href a later updateEvent looks up', async () => {
    // The feature dies silently if the sync-side key and the save-side key ever
    // diverge (trailing slash, encoding, absolute vs. relative), so assert the
    // round trip rather than each half in isolation.
    const href = `${calendarUrl}server-generated.ics`
    const original = serverIcs('event-1')
    mockClient.fetchEvents = vi
      .fn()
      .mockResolvedValue([{ url: href, data: original, etag: '"etag-1"' }])

    const { events } = await engine.fullSync('2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z', [])
    const fetched = events[0]

    const { getRawIcs } = await import('@/lib/rawIcsStore')
    expect(await getRawIcs(fetched.resourceHref!)).toEqual({ ics: original, etag: '"etag-1"' })

    // ...and that is the same href updateEvent PUTs to.
    await engine.updateEvent(fetched, '"etag-1"')
    const putUrl = vi.mocked(mockClient.updateEvent!).mock.calls[0][1]
    expect(putUrl).toBe(fetched.resourceHref)
    expect(await getRawIcs(putUrl)).toBeDefined()
  })
})

describe('SyncEngine — patches the original instead of rebuilding', () => {
  const calendarUrl = 'https://caldav.example.com/calendars/test/default/'
  let engine: SyncEngine
  let mockClient: Partial<CalDAVClient>

  /** A resource carrying properties Calino has no field for. */
  const serverIcs = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Other Client//EN',
    'BEGIN:VEVENT',
    'UID:event-1',
    'DTSTART:20240315T140000Z',
    'DTEND:20240315T150000Z',
    'SUMMARY:Test Event',
    'GEO:55.6761;12.5683',
    'X-CUSTOM-PROP:keep me',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')

  const putBody = () => vi.mocked(mockClient.updateEvent!).mock.calls[0][2] as string

  beforeEach(() => {
    vi.clearAllMocks()
    rawIcs.clear()

    mockGetAllCalendars.mockReturnValue([
      {
        id: 'cal-1',
        accountId: 'acc-1',
        url: calendarUrl,
        name: 'Default',
        color: '#4285F4',
        ctag: null,
        syncToken: null,
        isVisible: true,
        isDefault: true,
      },
    ])

    mockClient = {
      fetchEvents: vi.fn().mockResolvedValue([]),
      createEvent: vi.fn().mockResolvedValue({ url: `${calendarUrl}created.ics`, etag: '"1"' }),
      updateEvent: vi
        .fn()
        .mockImplementation(async (_collection: string, url: string) => ({ url, etag: '"2"' })),
      deleteEvent: vi.fn().mockResolvedValue(undefined),
    }

    engine = createSyncEngine(mockClient as CalDAVClient, 'cal-1')
  })

  /** Sync one resource in, so an original is on hand to patch. */
  async function syncOne(etag = '"etag-1"') {
    mockClient.fetchEvents = vi
      .fn()
      .mockResolvedValue([{ url: `${calendarUrl}one.ics`, data: serverIcs, etag }])
    const { events } = await engine.fullSync('2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z', [])
    return events[0]
  }

  it('keeps unmodelled properties when an original is available', async () => {
    const event = await syncOne()

    await engine.updateEvent({ ...event, title: 'Renamed' }, '"etag-1"')

    const body = putBody()
    expect(body).toContain('X-CUSTOM-PROP:keep me')
    expect(body).toContain('GEO:55.6761;12.5683')
    expect(body).toContain('SUMMARY:Renamed')
    // The origin server's PRODID survives too — this is not a Calino rebuild.
    expect(body).toContain('PRODID:-//Other Client//EN')
  })

  it('falls back to a from-scratch build when nothing is stored', async () => {
    const event = makeEvent({ resourceHref: `${calendarUrl}absent.ics` })

    await engine.updateEvent(event, '"etag-1"')

    // Byte-identical to what the previous implementation produced, so the
    // fallback path is provably unchanged.
    expect(putBody()).toBe(eventToICAL(event))
  })

  it('does not consult the store when creating', async () => {
    const { getRawIcs } = await import('@/lib/rawIcsStore')
    vi.mocked(getRawIcs).mockClear()

    await engine.pushEvent(makeEvent())

    expect(getRawIcs).not.toHaveBeenCalled()
  })

  /**
   * putEventGroup derives its destination from the master's id rather than
   * `resourceHref`, so an original is only ever on hand when it is retrying a
   * move it had already partly completed. Seed the store at that derived href
   * so these two tests exercise the etag guard rather than a plain cache miss.
   */
  async function syncAtDerivedHref(etag: string) {
    const href = `${calendarUrl}${eventResourceFilename('event-1')}`
    mockClient.fetchEvents = vi
      .fn()
      .mockResolvedValue([{ url: href, data: serverIcs, etag }])
    const { events } = await engine.fullSync('2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z', [])
    // The guard only means anything if the engine will PUT back to this href.
    expect(`${calendarUrl}${eventResourceFilename(events[0].id)}`).toBe(href)
    return events[0]
  }

  it('refuses to patch a stale original on the unconditional move path', async () => {
    const event = await syncAtDerivedHref('"etag-1"')

    // putEventGroup sends an empty If-Match, so no 412 would catch a stale
    // original: a mismatched etag must fall back rather than resurrect
    // properties the server has since dropped.
    await engine.putEventGroup([{ ...event, etag: '"etag-STALE"' }])

    expect(putBody()).not.toContain('X-CUSTOM-PROP')
  })

  it('patches on the move path when the stored etag still matches', async () => {
    const event = await syncAtDerivedHref('"etag-1"')

    await engine.putEventGroup([{ ...event, etag: '"etag-1"' }])

    expect(putBody()).toContain('X-CUSTOM-PROP:keep me')
  })
})
