import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CalDAVClient, createCalDAVClient } from '../CalDAVClient'
import type { CalDAVCredentials } from '../../types'

vi.mock('tsdav', () => ({
  createDAVClient: vi.fn(),
}))

const mockCreateDAVClient = vi.mocked(
  await import('tsdav').then((m) => m.createDAVClient)
)

describe('CalDAVClient', () => {
  let client: CalDAVClient
  const mockCredentials: CalDAVCredentials = {
    id: 'cred-1',
    serverUrl: 'https://caldav.example.com',
    username: 'testuser',
    password: 'testpass',
  }

  const mockCalendar = {
    url: 'https://caldav.example.com/calendars/test/default/',
    displayName: 'Default Calendar',
    components: ['VEVENT', 'VTODO'],
  }

  const mockEventObject = {
    url: 'https://caldav.example.com/calendars/test/default/event-1.ics',
    data: `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-1
SUMMARY:Test Event
DTSTART:20240315T100000Z
DTEND:20240315T110000Z
END:VEVENT
END:VCALENDAR`,
    etag: '"event-etag"',
  }

  const mockTodoObject = {
    url: 'https://caldav.example.com/calendars/test/default/task-1.ics',
    data: `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTODO
UID:task-1
SUMMARY:Test Task
DUE;VALUE=DATE:20240320
STATUS:NEEDS-ACTION
END:VTODO
END:VCALENDAR`,
    etag: '"todo-etag"',
  }

  const mockClientMethods = {
    fetchCalendars: vi.fn(),
    fetchCalendarObjects: vi.fn(),
    createCalendarObject: vi.fn(),
    updateCalendarObject: vi.fn(),
    deleteCalendarObject: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    client = new CalDAVClient(mockCredentials.serverUrl, mockCredentials)

    mockCreateDAVClient.mockResolvedValue(mockClientMethods)
    mockClientMethods.fetchCalendars.mockResolvedValue([mockCalendar])
  })

  describe('createCalDAVClient', () => {
    it('creates and connects a client', async () => {
      const result = await createCalDAVClient(
        mockCredentials.serverUrl,
        mockCredentials
      )

      expect(mockCreateDAVClient).toHaveBeenCalledWith({
        serverUrl: mockCredentials.serverUrl,
        credentials: {
          username: mockCredentials.username,
          password: mockCredentials.password,
        },
        authMethod: 'Basic',
        defaultAccountType: 'caldav',
      })
      expect(result).toBeInstanceOf(CalDAVClient)
    })
  })

  describe('fetchCalendars', () => {
    it('fetches and maps calendars', async () => {
      await client.connect()
      const calendars = await client.fetchCalendars()

      expect(mockClientMethods.fetchCalendars).toHaveBeenCalled()
      expect(calendars).toHaveLength(1)
      expect(calendars[0].url).toBe(mockCalendar.url)
      expect(calendars[0].name).toBe(mockCalendar.displayName)
    })
  })

  describe('fetchEvents', () => {
    it('fetches both VEVENTs and VTODOs', async () => {
      await client.connect()

      mockClientMethods.fetchCalendarObjects
        .mockResolvedValueOnce([mockEventObject])
        .mockResolvedValueOnce([mockTodoObject])

      const result = await client.fetchEvents(
        mockCalendar.url,
        '2024-01-01T00:00:00Z',
        '2024-12-31T23:59:59Z'
      )

      expect(mockClientMethods.fetchCalendarObjects).toHaveBeenCalledTimes(2)

      expect(result).toHaveLength(2)
      expect(result.find((obj) => obj.url === mockEventObject.url)).toBeDefined()
      expect(result.find((obj) => obj.url === mockTodoObject.url)).toBeDefined()
    })

    it('uses timeRange filter for VEVENTs', async () => {
      await client.connect()

      mockClientMethods.fetchCalendarObjects
        .mockResolvedValueOnce([mockEventObject])
        .mockResolvedValueOnce([])

      await client.fetchEvents(
        mockCalendar.url,
        '2024-01-01T00:00:00Z',
        '2024-12-31T23:59:59Z'
      )

      expect(mockClientMethods.fetchCalendarObjects).toHaveBeenNthCalledWith(1, {
        calendar: mockCalendar,
        timeRange: {
          start: '2024-01-01T00:00:00Z',
          end: '2024-12-31T23:59:59Z',
        },
      })
    })

    it('uses VTODO filter for tasks', async () => {
      await client.connect()

      mockClientMethods.fetchCalendarObjects
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([mockTodoObject])

      await client.fetchEvents(
        mockCalendar.url,
        '2024-01-01T00:00:00Z',
        '2024-12-31T23:59:59Z'
      )

      expect(mockClientMethods.fetchCalendarObjects).toHaveBeenNthCalledWith(2, {
        calendar: mockCalendar,
        filters: {
          'comp-filter': {
            _attributes: {
              name: 'VCALENDAR',
            },
            'comp-filter': {
              _attributes: {
                name: 'VTODO',
              },
            },
          },
        },
      })
    })

    it('deduplicates results by URL', async () => {
      await client.connect()

      mockClientMethods.fetchCalendarObjects
        .mockResolvedValueOnce([mockEventObject])
        .mockResolvedValueOnce([mockEventObject])

      const result = await client.fetchEvents(
        mockCalendar.url,
        '2024-01-01T00:00:00Z',
        '2024-12-31T23:59:59Z'
      )

      expect(result).toHaveLength(1)
    })

    it('returns empty array when no events or tasks found', async () => {
      await client.connect()

      mockClientMethods.fetchCalendarObjects
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])

      const result = await client.fetchEvents(
        mockCalendar.url,
        '2024-01-01T00:00:00Z',
        '2024-12-31T23:59:59Z'
      )

      expect(result).toHaveLength(0)
    })
  })

  describe('createEvent', () => {
    it('creates a calendar object', async () => {
      await client.connect()

      mockClientMethods.createCalendarObject.mockResolvedValue({
        url: mockEventObject.url,
      })

      const result = await client.createEvent(
        mockCalendar.url,
        mockEventObject.data,
        'event-1.ics'
      )

      expect(mockClientMethods.createCalendarObject).toHaveBeenCalledWith({
        calendar: mockCalendar,
        filename: 'event-1.ics',
        iCalString: mockEventObject.data,
      })
      expect(result.url).toBe(mockEventObject.url)
    })
  })

  describe('updateEvent', () => {
    it('updates a calendar object', async () => {
      await client.connect()

      mockClientMethods.updateCalendarObject.mockResolvedValue({
        url: mockEventObject.url,
      })

      const result = await client.updateEvent(
        mockCalendar.url,
        mockEventObject.url,
        mockEventObject.data,
        mockEventObject.etag
      )

      expect(mockClientMethods.updateCalendarObject).toHaveBeenCalledWith({
        calendarObject: {
          url: mockEventObject.url,
          etag: mockEventObject.etag,
          data: mockEventObject.data,
        },
      })
      expect(result.url).toBe(mockEventObject.url)
    })
  })

  describe('deleteEvent', () => {
    it('deletes a calendar object', async () => {
      await client.connect()

      await client.deleteEvent(mockEventObject.url, mockEventObject.etag)

      expect(mockClientMethods.deleteCalendarObject).toHaveBeenCalledWith({
        calendarObject: {
          url: mockEventObject.url,
          etag: mockEventObject.etag,
        },
      })
    })
  })
})
