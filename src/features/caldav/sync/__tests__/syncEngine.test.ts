import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SyncEngine, createSyncEngine, eventResourceFilename } from '../syncEngine'
import type { CalendarEvent } from '@/types'
import type { CalDAVClient } from '../../client/CalDAVClient'
import * as storage from '../accountStorage'

vi.mock('../accountStorage', () => ({
  getAllCalendars: vi.fn(),
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

      const result = await engine.fullSync('2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z', [local])

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
