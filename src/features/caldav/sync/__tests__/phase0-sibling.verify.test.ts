import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SyncEngine, createSyncEngine } from '../syncEngine'
import type { CalendarEvent } from '@/types'
import type { CalDAVClient } from '../../client/CalDAVClient'
import { parseICALData } from '../../adapter/iCalendarAdapter'
import * as storage from '../accountStorage'

vi.mock('../accountStorage', () => ({
  getAllCalendars: vi.fn(),
}))

const mockGetAllCalendars = vi.mocked(storage.getAllCalendars)

const CALENDAR_URL = 'https://caldav.example.com/calendars/test/default/'
const RESOURCE_HREF = `${CALENDAR_URL}series.ics`

/**
 * A single CalDAV resource holding a recurrence master plus one detached
 * RECURRENCE-ID override — the shape every server produces after "edit just
 * this occurrence".
 */
const SERVER_RESOURCE_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Other Client//EN',
  'BEGIN:VEVENT',
  'UID:series-uid',
  'DTSTAMP:20240301T000000Z',
  'DTSTART:20240301T140000Z',
  'DTEND:20240301T150000Z',
  'RRULE:FREQ=DAILY;COUNT=5',
  'SUMMARY:Standup',
  'SEQUENCE:0',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:series-uid',
  'RECURRENCE-ID:20240303T140000Z',
  'DTSTAMP:20240301T000000Z',
  'DTSTART:20240303T160000Z',
  'DTEND:20240303T170000Z',
  'SUMMARY:Standup (moved)',
  'SEQUENCE:1',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

/** Count VEVENT subcomponents in an ICS string. */
function countVEvents(ics: string): number {
  return (ics.match(/BEGIN:VEVENT/g) || []).length
}

describe('Phase 0 verification: SyncEngine.updateEvent drops sibling components', () => {
  let engine: SyncEngine
  let mockClient: Partial<CalDAVClient>

  beforeEach(() => {
    vi.clearAllMocks()

    mockGetAllCalendars.mockReturnValue([
      {
        id: 'cal-1',
        accountId: 'acc-1',
        url: CALENDAR_URL,
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
      createEvent: vi.fn().mockResolvedValue({ url: RESOURCE_HREF, etag: '1' }),
      updateEvent: vi.fn().mockResolvedValue({ url: RESOURCE_HREF, etag: '2' }),
      deleteEvent: vi.fn().mockResolvedValue(undefined),
    }

    engine = createSyncEngine(mockClient as CalDAVClient, 'cal-1')
  })

  /** The ICS body handed to the mocked client's `updateEvent`. */
  function putBody(): string {
    const calls = vi.mocked(mockClient.updateEvent!).mock.calls
    expect(calls).toHaveLength(1)
    return calls[0][2] as string
  }

  it('PUTs only the master when the resource also holds a RECURRENCE-ID override', async () => {
    // The resource as the server holds it: master + override, two components.
    expect(countVEvents(SERVER_RESOURCE_ICS)).toBe(2)

    // Both parse into the local store, sharing one resourceHref.
    const parsed = parseICALData(SERVER_RESOURCE_ICS, 'cal-1').map((event) => ({
      ...event,
      etag: '"etag-1"',
      resourceHref: RESOURCE_HREF,
    }))
    expect(parsed).toHaveLength(2)
    const master = parsed.find((event) => !event.recurrenceId) as CalendarEvent
    const override = parsed.find((event) => event.recurrenceId) as CalendarEvent
    expect(override).toBeDefined()

    // The user retitles the series and only the master reaches updateEvent.
    await engine.updateEvent({ ...master, title: 'Standup (renamed)' }, '"etag-1"')

    const body = putBody()
    // BUG: the PUT body carries a single VEVENT, so the server-side override is
    // deleted by the write. Correct behaviour: the whole resource is
    // round-tripped, so this should be 2.
    expect(countVEvents(body)).toBe(1)
    expect(body).not.toContain('RECURRENCE-ID')
    expect(body).toContain('SUMMARY:Standup (renamed)')
    // And it is PUT straight over the shared resource href.
    expect(vi.mocked(mockClient.updateEvent!).mock.calls[0][1]).toBe(RESOURCE_HREF)
  })

  it('PUTs only the master when a sibling component never parsed into the store', async () => {
    // Same resource, but the override component is malformed enough that
    // Calino's adapter drops it (here: no DTSTART at all). The server still
    // holds it.
    const ics = SERVER_RESOURCE_ICS.replace('DTSTART:20240303T160000Z\r\n', '').replace(
      'DTEND:20240303T170000Z\r\n',
      ''
    )
    expect(countVEvents(ics)).toBe(2)

    const parsed = parseICALData(ics, 'cal-1').map((event) => ({
      ...event,
      etag: '"etag-1"',
      resourceHref: RESOURCE_HREF,
    }))
    // BUG PRECONDITION: only one of the two components survives parsing, so no
    // sibling-gathering pass at any layer can ever see the other one.
    expect(parsed).toHaveLength(1)
    const master = parsed[0]
    expect(master.recurrenceId).toBeUndefined()

    await engine.updateEvent({ ...master, title: 'Standup (renamed)' }, '"etag-1"')

    const body = putBody()
    // BUG: the unparsed component is gone from the PUT body and therefore
    // deleted server-side. Correct behaviour: unparsed components are preserved
    // verbatim, so this should be 2.
    expect(countVEvents(body)).toBe(1)
  })

  it('preserves both components only when the caller uses updateEventGroup', async () => {
    const parsed = parseICALData(SERVER_RESOURCE_ICS, 'cal-1').map((event) => ({
      ...event,
      etag: '"etag-1"',
      resourceHref: RESOURCE_HREF,
    }))

    await engine.updateEventGroup(parsed, '"etag-1"')

    // Contrast case: the group path is the only one that round-trips siblings.
    expect(countVEvents(putBody())).toBe(2)
  })
})
