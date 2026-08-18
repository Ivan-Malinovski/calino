import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  CalDAVClient,
  createCalDAVClient,
  buildProxyUrl,
  prefixUrlWithProxy,
  normalizeColor,
} from '../CalDAVClient'
import type { CalDAVCredentials } from '../../types'

vi.mock('tsdav', () => ({
  createDAVClient: vi.fn(),
}))

const mockCreateDAVClient = vi.mocked(await import('tsdav').then((m) => m.createDAVClient))

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
    davRequest: vi.fn(),
    fetchVCals: vi.fn(),
    getMultipleVCard: vi.fn(),
    getSingleVCard: vi.fn(),
    createVCard: vi.fn(),
    updateVCard: vi.fn(),
    deleteVCard: vi.fn(),
    syncCollection: vi.fn(),
  } as any

  let onLineSpy: ReturnType<typeof vi.spyOn>
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    // Default: online
    onLineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)

    // Default global fetch stub so the createEvent → fetchEtag follow-up
    // PROPFIND (for servers that omit ETag on PUT) doesn't hit the network.
    // Returns a 207 with no getetag → fetchEtag resolves to ''.
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('<d:multistatus xmlns:d="DAV:"></d:multistatus>', { status: 207 })
      )

    client = new CalDAVClient(mockCredentials.serverUrl, mockCredentials)

    mockCreateDAVClient.mockResolvedValue(mockClientMethods)
    mockClientMethods.fetchCalendars.mockResolvedValue([mockCalendar])
  })

  afterEach(() => {
    onLineSpy.mockRestore()
    fetchSpy.mockRestore()
  })

  describe('createCalDAVClient', () => {
    it('creates and connects a client', async () => {
      const result = await createCalDAVClient(mockCredentials.serverUrl, mockCredentials)

      expect(mockCreateDAVClient).toHaveBeenCalledWith({
        serverUrl: mockCredentials.serverUrl,
        credentials: {
          username: mockCredentials.username,
          password: mockCredentials.password,
        },
        // Phase 4 — tsdav's own Basic auth mangles non-Latin-1 credentials,
        // so we hand it a UTF-8 header via the Custom authFunction.
        authMethod: 'Custom',
        authFunction: expect.any(Function),
        defaultAccountType: 'caldav',
        // Always an explicit fetch: on native we must bypass Capacitor's
        // patched window.fetch, which cannot send WebDAV verbs.
        fetch: expect.any(Function),
      })
      expect(result).toBeInstanceOf(CalDAVClient)
    })

    it('authenticates tsdav requests with a UTF-8-safe Basic header', async () => {
      const unicodeCreds = {
        ...mockCredentials,
        username: 'ivan',
        password: '密码123',
      }
      const unicodeClient = new CalDAVClient(unicodeCreds.serverUrl, unicodeCreds)
      await unicodeClient.connect()

      const params = mockCreateDAVClient.mock.calls[0][0] as {
        authMethod: string
        authFunction: (c: unknown) => Promise<Record<string, string>>
      }
      expect(params.authMethod).toBe('Custom')
      // btoa would throw on the CJK password; the custom function must not.
      const headers = await params.authFunction(unicodeCreds)
      expect(headers).toEqual({ Authorization: 'Basic aXZhbjrlr4bnoIExMjM=' })
    })
  })

  describe('principal discovery (RFC 5397 + RFC 4791)', () => {
    const radicalePrincipalResponse = `<?xml version="1.0" encoding="UTF-8" ?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/</D:href>
    <D:propstat>
      <D:prop>
        <D:current-user-principal>
          <href>/ivan/</href>
        </D:current-user-principal>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`

    const radicaleHomeSetResponse = `<?xml version="1.0" encoding="UTF-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>/ivan/</D:href>
    <D:propstat>
      <D:prop>
        <C:calendar-home-set>
          <href>/ivan/calendars/</href>
        </C:calendar-home-set>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`

    it('resolves current-user-principal → calendar-home-set with unprefixed child hrefs', async () => {
      await client.connect()
      // No calendars cached yet → findCalendarHome falls through to the
      // principal path, which issues its own PROPFINDs via global fetch.
      mockClientMethods.fetchCalendars.mockResolvedValue([])

      const requests: Array<{ url: string; method: string }> = []
      fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        requests.push({ url, method: init?.method ?? 'GET' })
        if (url === 'https://caldav.example.com') {
          return new Response(radicalePrincipalResponse, { status: 207 })
        }
        if (url === 'https://caldav.example.com/ivan/') {
          return new Response(radicaleHomeSetResponse, { status: 207 })
        }
        // The MKCALENDAR for the new calendar collection under the home.
        return new Response(null, { status: 201 })
      })

      const created = await client.createCalendar({ name: 'Trip Plans' })

      expect(created.url).toMatch(
        /^https:\/\/caldav\.example\.com\/ivan\/calendars\/trip-plans-[0-9a-f-]+\/$/
      )
      const propfinds = requests.filter((r) => r.method === 'PROPFIND')
      expect(propfinds.map((r) => r.url)).toEqual([
        'https://caldav.example.com',
        'https://caldav.example.com/ivan/',
      ])
    })

    it('survives a principal that answers no properties (falls back)', async () => {
      await client.connect()
      mockClientMethods.fetchCalendars.mockResolvedValue([])
      fetchSpy.mockResolvedValue(
        new Response('<D:multistatus xmlns:D="DAV:"></D:multistatus>', { status: 207 })
      )

      // With no principal info and no cached calendars, home discovery fails.
      await expect(client.createCalendar({ name: 'Nope' })).rejects.toThrow(
        /Could not determine calendar home/
      )
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
      expect(calendars[0].supportedComponents).toEqual(['VEVENT', 'VTODO'])
    })

    it('keeps only known calendar component metadata (VJOURNAL now included)', async () => {
      mockClientMethods.fetchCalendars.mockResolvedValue([
        { ...mockCalendar, components: ['VTODO', 'VJOURNAL', 'VFREEBUSY'] },
      ])
      await client.connect()

      const calendars = await client.fetchCalendars()

      expect(calendars[0].supportedComponents).toEqual(['VTODO', 'VJOURNAL'])
    })

    // Phase 4 — capability metadata
    it('captures ctag and syncToken returned by the server', async () => {
      mockClientMethods.fetchCalendars.mockResolvedValue([
        { ...mockCalendar, ctag: 'ctag-42', syncToken: 'https://example.com/ns/sync/1234' },
      ])
      await client.connect()

      const calendars = await client.fetchCalendars()

      expect(calendars[0].ctag).toBe('ctag-42')
      expect(calendars[0].syncToken).toBe('https://example.com/ns/sync/1234')
    })

    it('requests privilege-set, subscribed and calendar-order via props', async () => {
      await client.connect()
      await client.fetchCalendars()

      const arg = mockClientMethods.fetchCalendars.mock.calls[0][0]
      expect(arg.props).toMatchObject({
        'cs:getctag': {},
        'd:sync-token': {},
        'd:current-user-privilege-set': {},
        'cs:subscribed': {},
        'cs:calendar-order': {},
      })
      expect(arg.projectedProps).toMatchObject({
        currentUserPrivilegeSet: true,
        subscribed: true,
        calendarOrder: true,
      })
    })

    it('marks a calendar read-only when the privilege set grants no write', async () => {
      mockClientMethods.fetchCalendars.mockResolvedValue([
        {
          ...mockCalendar,
          projectedProps: {
            currentUserPrivilegeSet: { privilege: { read: {}, 'read-current-user': {} } },
          },
        },
      ])
      await client.connect()

      const calendars = await client.fetchCalendars()
      expect(calendars[0].readOnly).toBe(true)
    })

    it('stays writable when the privilege set grants write, and when absent', async () => {
      mockClientMethods.fetchCalendars.mockResolvedValue([
        {
          ...mockCalendar,
          url: 'https://caldav.example.com/calendars/test/writable/',
          projectedProps: {
            currentUserPrivilegeSet: { privilege: { read: {}, write: {}, bind: {} } },
          },
        },
        {
          ...mockCalendar,
          url: 'https://caldav.example.com/calendars/test/no-privs/',
          // Server did not answer the property at all
        },
      ])
      await client.connect()

      const calendars = await client.fetchCalendars()
      expect(calendars.find((c) => c.url.endsWith('writable/'))?.readOnly).toBe(false)
      expect(calendars.find((c) => c.url.endsWith('no-privs/'))?.readOnly).toBe(false)
    })

    it('stays writable when the server sends one <privilege> element per privilege', async () => {
      // The shape every real server actually produces. RFC 3744 defines
      // current-user-privilege-set as a *sequence* of <privilege> elements,
      // and xml-js (compact mode, alwaysArray: false) turns repeated siblings
      // into an array — so `privilege` is an array here, not one merged
      // object. Reading keys off it yields "0", "1", "2", which contain no
      // privilege named `write`, and every calendar on the server goes
      // read-only.
      mockClientMethods.fetchCalendars.mockResolvedValue([
        {
          ...mockCalendar,
          projectedProps: {
            currentUserPrivilegeSet: {
              privilege: [{ read: {} }, { write: {} }, { 'write-content': {} }],
            },
          },
        },
      ])
      await client.connect()

      const calendars = await client.fetchCalendars()
      expect(calendars[0].readOnly).toBe(false)
    })

    it('reads a write privilege nested inside an aggregate, and through a namespace prefix', async () => {
      // `<write>` aggregates `<write-content>`/`<write-properties>` (RFC 3744
      // §3.2), so a server may grant write only as a child of an aggregate.
      // And prefixes are arbitrary: sabre sends `<d:write/>` where Radicale
      // sends `<write/>` — a matcher bound to the bare local name misses one
      // of them.
      mockClientMethods.fetchCalendars.mockResolvedValue([
        {
          ...mockCalendar,
          url: 'https://caldav.example.com/calendars/test/nested/',
          projectedProps: {
            currentUserPrivilegeSet: { privilege: [{ all: { 'write-content': {} } }] },
          },
        },
        {
          ...mockCalendar,
          url: 'https://caldav.example.com/calendars/test/prefixed/',
          projectedProps: {
            currentUserPrivilegeSet: { privilege: [{ 'd:read': {} }, { 'd:write': {} }] },
          },
        },
      ])
      await client.connect()

      const calendars = await client.fetchCalendars()
      expect(calendars.find((c) => c.url.endsWith('nested/'))?.readOnly).toBe(false)
      expect(calendars.find((c) => c.url.endsWith('prefixed/'))?.readOnly).toBe(false)
    })

    it('still marks read-only when a per-element privilege list grants no write', async () => {
      mockClientMethods.fetchCalendars.mockResolvedValue([
        {
          ...mockCalendar,
          projectedProps: {
            currentUserPrivilegeSet: {
              privilege: [{ read: {} }, { 'read-current-user-privilege-set': {} }],
            },
          },
        },
      ])
      await client.connect()

      const calendars = await client.fetchCalendars()
      expect(calendars[0].readOnly).toBe(true)
    })

    it('forces subscriptions read-only regardless of privileges', async () => {
      mockClientMethods.fetchCalendars.mockResolvedValue([
        {
          ...mockCalendar,
          projectedProps: {
            subscribed: {},
            currentUserPrivilegeSet: { privilege: { read: {}, write: {} } },
          },
        },
      ])
      await client.connect()

      const calendars = await client.fetchCalendars()
      expect(calendars[0].isSubscribed).toBe(true)
      expect(calendars[0].readOnly).toBe(true)
    })

    it('skips schedule inbox/outbox collections', async () => {
      mockClientMethods.fetchCalendars.mockResolvedValue([
        { ...mockCalendar },
        {
          ...mockCalendar,
          url: 'https://caldav.example.com/calendars/test/inbox/',
          resourcetype: ['collection', 'schedule-inbox'],
        },
        {
          ...mockCalendar,
          url: 'https://caldav.example.com/calendars/test/outbox/',
          resourcetype: ['collection', 'schedule-outbox'],
        },
      ])
      await client.connect()

      const calendars = await client.fetchCalendars()
      expect(calendars).toHaveLength(1)
      expect(calendars[0].url).toBe(mockCalendar.url)
    })

    // Bug 14: calendar ID should use UUID, not Date.now()
    it('generates unique UUID-based IDs when server does not provide a URL', async () => {
      await client.connect()
      mockClientMethods.fetchCalendars.mockResolvedValue([
        { url: '', displayName: 'Cal 1' },
        { url: '', displayName: 'Cal 2' },
      ])

      const calendars = await client.fetchCalendars()

      expect(calendars[0].id).not.toBe(calendars[1].id)
      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(calendars[0].id).toMatch(
        /^cal-0-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    })

    // Bug 16: fetchCalendars should return raw server URLs, not proxy-prefixed
    it('stores raw server URLs even when proxy is configured', async () => {
      const proxyClient = new CalDAVClient(
        mockCredentials.serverUrl,
        mockCredentials,
        'https://proxy.example.com'
      )
      await proxyClient.connect()

      const calendars = await proxyClient.fetchCalendars()

      // Should be the raw URL, NOT proxy-prefixed
      expect(calendars[0].url).toBe(mockCalendar.url)
      expect(calendars[0].url).not.toContain('proxy.example.com')
    })

    it('reads calendarColor from server and normalizes it', async () => {
      mockClientMethods.fetchCalendars.mockResolvedValue([
        { ...mockCalendar, calendarColor: '#ff5722ff' },
      ])
      await client.connect()
      const calendars = await client.fetchCalendars()

      expect(calendars[0].color).toBe('#FF5722')
    })

    it('uses default color when server returns no calendarColor', async () => {
      mockClientMethods.fetchCalendars.mockResolvedValue([{ ...mockCalendar, calendarColor: null }])
      await client.connect()
      const calendars = await client.fetchCalendars()

      expect(calendars[0].color).toBe('#4285F4')
    })

    // Bug 20: offline detection
    it('throws when offline', async () => {
      onLineSpy.mockReturnValue(false)
      await client.connect()

      await expect(client.fetchCalendars()).rejects.toThrow('No network connection')
    })
  })

  describe('fetchEvents', () => {
    it('fetches both VEVENTs, VTODOs, and VJOURNALs', async () => {
      await client.connect()

      mockClientMethods.fetchCalendarObjects
        .mockResolvedValueOnce([mockEventObject])
        .mockResolvedValueOnce([mockTodoObject])
        .mockResolvedValueOnce([])

      const result = await client.fetchEvents(
        mockCalendar.url,
        '2024-01-01T00:00:00Z',
        '2024-12-31T23:59:59Z'
      )

      expect(mockClientMethods.fetchCalendarObjects).toHaveBeenCalledTimes(3)

      expect(result).toHaveLength(2)
      expect(result.find((obj) => obj.url === mockEventObject.url)).toBeDefined()
      expect(result.find((obj) => obj.url === mockTodoObject.url)).toBeDefined()
    })

    it('uses timeRange filter for VEVENTs', async () => {
      await client.connect()

      mockClientMethods.fetchCalendarObjects
        .mockResolvedValueOnce([mockEventObject])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])

      await client.fetchEvents(mockCalendar.url, '2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z')

      expect(mockClientMethods.fetchCalendarObjects).toHaveBeenNthCalledWith(1, {
        calendar: mockCalendar,
        timeRange: {
          start: '2024-01-01T00:00:00Z',
          end: '2024-12-31T23:59:59Z',
        },
      })
    })

    it('fetches all VEVENTs when an authoritative sync listing is requested', async () => {
      await client.connect()

      mockClientMethods.fetchCalendarObjects
        .mockResolvedValueOnce([mockEventObject])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])

      await client.fetchEvents(
        mockCalendar.url,
        '2024-01-01T00:00:00Z',
        '2024-12-31T23:59:59Z',
        true
      )

      expect(mockClientMethods.fetchCalendarObjects).toHaveBeenNthCalledWith(1, {
        calendar: mockCalendar,
        filters: {
          'comp-filter': {
            _attributes: { name: 'VCALENDAR' },
            'comp-filter': { _attributes: { name: 'VEVENT' } },
          },
        },
      })
    })

    it('uses VTODO filter for tasks', async () => {
      await client.connect()

      mockClientMethods.fetchCalendarObjects
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([mockTodoObject])
        .mockResolvedValueOnce([])

      await client.fetchEvents(mockCalendar.url, '2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z')

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
        .mockResolvedValueOnce([])

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
        .mockResolvedValueOnce([])

      const result = await client.fetchEvents(
        mockCalendar.url,
        '2024-01-01T00:00:00Z',
        '2024-12-31T23:59:59Z'
      )

      expect(result).toHaveLength(0)
    })

    // Bug 16: calendar lookup uses raw URL matching
    it('finds calendar by raw server URL', async () => {
      await client.connect()

      mockClientMethods.fetchCalendarObjects
        .mockResolvedValueOnce([mockEventObject])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])

      const result = await client.fetchEvents(
        'https://caldav.example.com/calendars/test/default/',
        '2024-01-01T00:00:00Z',
        '2024-12-31T23:59:59Z'
      )

      expect(result).toHaveLength(1)
    })

    // Bug 16: event URLs should be raw, not proxy-prefixed
    it('returns raw event URLs without proxy prefix', async () => {
      const proxyClient = new CalDAVClient(
        mockCredentials.serverUrl,
        mockCredentials,
        'https://proxy.example.com'
      )
      await proxyClient.connect()

      mockClientMethods.fetchCalendarObjects
        .mockResolvedValueOnce([mockEventObject])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])

      const result = await proxyClient.fetchEvents(
        mockCalendar.url,
        '2024-01-01T00:00:00Z',
        '2024-12-31T23:59:59Z'
      )

      expect(result[0].url).toBe(mockEventObject.url)
      expect(result[0].url).not.toContain('proxy.example.com')
    })

    // Bug 20: offline detection
    it('throws when offline', async () => {
      onLineSpy.mockReturnValue(false)
      await client.connect()

      await expect(
        client.fetchEvents(mockCalendar.url, '2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z')
      ).rejects.toThrow('No network connection')
    })
  })

  describe('createEvent', () => {
    it('creates a calendar object', async () => {
      await client.connect()

      mockClientMethods.createCalendarObject.mockResolvedValue({
        url: mockEventObject.url,
      })

      const result = await client.createEvent(mockCalendar.url, mockEventObject.data, 'event-1.ics')

      expect(mockClientMethods.createCalendarObject).toHaveBeenCalledWith({
        calendar: mockCalendar,
        filename: 'event-1.ics',
        iCalString: mockEventObject.data,
      })
      expect(result.url).toBe(mockEventObject.url)
    })

    // Same silent-swallow class as deleteEvent: tsdav's createObject returns
    // the raw Response without checking res.ok, so a 5xx must be surfaced
    // here or a failed destination write looks like success (which would let
    // a move delete its source after the write never landed).
    it('throws when the server responds with a non-2xx status', async () => {
      await client.connect()
      mockClientMethods.createCalendarObject.mockResolvedValue(
        new Response('oops', { status: 500 })
      )

      await expect(
        client.createEvent(mockCalendar.url, mockEventObject.data, 'event-1.ics')
      ).rejects.toThrow(/HTTP 500/)
    })

    // Bug 16 / issue #110: the returned URL must be raw even though the
    // *response* carries the proxied one. It is persisted as `resourceHref`,
    // and a proxied href gets proxied again on the next request, producing
    // `proxy/https%3A%2F%2Fproxy/…` — a URL that resolves to nothing, which is
    // how DELETE started failing with 412 on the hosted web app.
    it('returns raw URL without proxy prefix', async () => {
      const proxyClient = new CalDAVClient(
        mockCredentials.serverUrl,
        mockCredentials,
        'https://proxy.example.com'
      )
      await proxyClient.connect()

      mockClientMethods.createCalendarObject.mockResolvedValue({
        url: buildProxyUrl('https://proxy.example.com', mockEventObject.url),
      })

      const result = await proxyClient.createEvent(
        mockCalendar.url,
        mockEventObject.data,
        'event-1.ics'
      )

      expect(result.url).toBe(mockEventObject.url)
      expect(result.url).not.toContain('proxy.example.com')
    })

    // Bug 20: offline detection
    it('throws when offline', async () => {
      onLineSpy.mockReturnValue(false)
      await client.connect()

      await expect(
        client.createEvent(mockCalendar.url, mockEventObject.data, 'event-1.ics')
      ).rejects.toThrow('No network connection')
    })

    // Fastmail/Google/iCloud omit ETag on PUT — recover it via follow-up PROPFIND.
    it('fetches the etag via PROPFIND when the create response omits it', async () => {
      await client.connect()

      // No headers on the create response → empty etag → follow-up PROPFIND.
      mockClientMethods.createCalendarObject.mockResolvedValue({
        url: mockEventObject.url,
      })
      fetchSpy.mockResolvedValueOnce(
        new Response(
          `<d:multistatus xmlns:d="DAV:"><d:response><d:href>${mockEventObject.url}</d:href><d:propstat><d:prop><d:getetag>"recovered-etag"</d:getetag></d:prop></d:propstat></d:response></d:multistatus>`,
          { status: 207 }
        )
      )

      const result = await client.createEvent(mockCalendar.url, mockEventObject.data, 'event-1.ics')

      expect(result.etag).toBe('"recovered-etag"')
      // PROPFIND targeted the new event URL.
      expect(fetchSpy).toHaveBeenCalledWith(
        mockEventObject.url,
        expect.objectContaining({ method: 'PROPFIND' })
      )
    })

    it('uses the ETag header when present without a follow-up PROPFIND', async () => {
      await client.connect()

      mockClientMethods.createCalendarObject.mockResolvedValue({
        url: mockEventObject.url,
        headers: new Headers({ etag: '"header-etag"' }),
      })

      const result = await client.createEvent(mockCalendar.url, mockEventObject.data, 'event-1.ics')

      expect(result.etag).toBe('"header-etag"')
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    // Issue #110. sabre-based servers (Baikal, Nextcloud) XML-escape the quotes
    // an etag contains. Scraping the raw response text handed back the literal
    // `&quot;abc&quot;`, which went out as an If-Match no server could match —
    // so the next write or delete came back 412. Radicale writes the quotes
    // literally, which is why it looked server-specific.
    it('decodes XML entities in an etag recovered by PROPFIND', async () => {
      await client.connect()

      mockClientMethods.createCalendarObject.mockResolvedValue({
        url: mockEventObject.url,
      })
      fetchSpy.mockResolvedValueOnce(
        new Response(
          `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/event-1.ics</d:href>
             <d:propstat><d:prop><d:getetag>&quot;sabre-etag&quot;</d:getetag></d:prop>
             <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,
          { status: 207 }
        )
      )

      const result = await client.createEvent(mockCalendar.url, mockEventObject.data, 'event-1.ics')

      expect(result.etag).toBe('"sabre-etag"')
    })

    it('returns an empty etag (not throwing) when the follow-up PROPFIND fails', async () => {
      await client.connect()

      mockClientMethods.createCalendarObject.mockResolvedValue({
        url: mockEventObject.url,
      })
      fetchSpy.mockRejectedValueOnce(new Error('network down'))

      const result = await client.createEvent(mockCalendar.url, mockEventObject.data, 'event-1.ics')

      expect(result.url).toBe(mockEventObject.url)
      expect(result.etag).toBe('')
    })
  })

  describe('settings event UID (per-instance)', () => {
    const settingsCalendarUrl = 'https://caldav.example.com/calendars/test/calino-settings/'
    const settingsCalendar = {
      url: settingsCalendarUrl,
      displayName: 'Calino Settings',
      components: ['VEVENT'],
    }

    // Regression: the SETTINGS_EVENT_UID is the literal `calino-settings`.
    // Earlier R1.9 derived a per-instance UID (`calino-settings-<uuid>`),
    // which broke cross-device sync — a fresh device could not find the
    // settings VEVENT uploaded by the original device. The current
    // design stores the single settings event in a dedicated calendar
    // collection, so a shared literal UID is safe and any device on the
    // same CalDAV account can read/update it.
    it('writes settings event with the literal UID `calino-settings`', async () => {
      await client.connect()

      // `putSettingsEvent` calls the tsdav client directly to discover the
      // settings calendar, so we override the default fetchCalendars mock
      // to return one entry whose URL matches the SETTINGS_CAL_NAME.
      mockClientMethods.fetchCalendars.mockResolvedValue([settingsCalendar])
      mockClientMethods.createCalendarObject.mockResolvedValue({
        url: `${settingsCalendarUrl}calino-settings.ics`,
        headers: new Headers({ etag: '"new-etag"' }),
      })

      // Pass `existingEvent: null` so `putSettingsEvent` skips the REPORT
      // lookup and falls through to the "create new" branch, which is the
      // path that bakes `CalDAVClient.SETTINGS_EVENT_UID` into the iCal
      // payload via `createCalendarObject`.
      await client.putSettingsEvent(settingsCalendarUrl, 'QkFTRTY0UEFZTExPQUQ=', undefined, null)

      expect(mockClientMethods.createCalendarObject).toHaveBeenCalledTimes(1)
      const [{ iCalString }] = mockClientMethods.createCalendarObject.mock.calls[0]

      // Exact literal UID — stable across devices, lets cross-device
      // sync work because the dedicated settings calendar only ever
      // contains this one event.
      expect(iCalString).toMatch(/^UID:calino-settings\r\n/m)

      // The old hardcoded value and the abandoned per-instance form
      // must NOT be used anymore.
      expect(iCalString).not.toContain('UID:00000000-calino-')
      expect(iCalString).not.toMatch(/UID:calino-settings-[0-9a-f]{8}-/)
    })

    // R2.7 review follow-up (Gap 1): the full VEVENT assembly is the
    // contract of putSettingsEvent. Without this test, a future refactor
    // of eventToICAL (e.g. one that folds the SUMMARY line or drops
    // TRANSP) would silently corrupt the settings sync path while the
    // per-instance UID test above would still pass.
    it('produces a fully-formed VCALENDAR with proper CRLF, line folding, and base64 round-trip', async () => {
      await client.connect()
      mockClientMethods.fetchCalendars.mockResolvedValue([settingsCalendar])
      mockClientMethods.createCalendarObject.mockResolvedValue({
        url: `${settingsCalendarUrl}calino-settings.ics`,
        headers: new Headers({ etag: '"new-etag"' }),
      })

      // Use a long enough base64 to exercise line folding on the ATTACH
      // value. 800 chars of base64 ≈ 600 bytes of decoded JSON.
      const originalJson = JSON.stringify({
        theme: 'dark',
        reminders: Array.from({ length: 12 }, (_, i) => ({ id: i, label: `pref-${i}` })),
      })
      const base64 = btoa(originalJson)

      await client.putSettingsEvent(settingsCalendarUrl, base64, undefined, null)

      const [{ iCalString }] = mockClientMethods.createCalendarObject.mock.calls[0]

      // VCALENDAR / VEVENT scaffold
      expect(iCalString).toMatch(/^BEGIN:VCALENDAR\r\n/)
      expect(iCalString).toMatch(/\r\nEND:VCALENDAR$/)
      expect(iCalString).toContain('BEGIN:VEVENT')
      expect(iCalString).toContain('END:VEVENT')

      // Required Calino settings fields
      expect(iCalString).toMatch(/DTSTAMP:\d{8}T\d{6}Z\r\n/)
      expect(iCalString).toContain('DTSTART:19700101T000000Z')
      expect(iCalString).toContain('DTEND:19700101T000001Z')
      expect(iCalString).toContain('SUMMARY:Calino Settings')
      expect(iCalString).toContain('TRANSP:TRANSPARENT')
      expect(iCalString).toContain('CLASS:PRIVATE')
      expect(iCalString).toContain('X-CALINO-VERSION:1')

      // ATTACH line carries the full base64 payload (may be folded across
      // multiple physical lines — the regex below is CRLF+space tolerant).
      const unfolded = iCalString.replace(/\r\n[ \t]/g, '')
      expect(unfolded).toContain(`ATTACH;ENCODING=BASE64;FMTTYPE=app/json:${base64}`)

      // RFC 5545 §3.1 — every physical line must be ≤75 octets.
      const physicalLines = iCalString.split('\r\n')
      for (const line of physicalLines) {
        const octets = new TextEncoder().encode(line).length
        expect(octets).toBeLessThanOrEqual(75)
      }

      // No stray LFs without a preceding CR (the spec disallows \n alone).
      expect(iCalString).not.toMatch(/[^\r]\n/)

      // Round-trip: extractSettingsFromVEVENT must recover the original JSON.
      const extracted = client.extractSettingsFromVEVENT(iCalString)
      expect(extracted).toBe(originalJson)
    })
  })

  // Regression coverage for issue #52: discoverSettingsCalendar/fetchSettingsEvent
  // used to parse multistatus XML with regexes hardcoded to a literal lowercase
  // `d:` namespace prefix. WebDAV namespace prefixes are arbitrary per spec — a
  // server can emit `D:`, some other prefix, or a default namespace with none at
  // all — so a server that doesn't happen to use `d:` (e.g. Fastmail) silently
  // failed to be discovered even though the calendar/event existed. These tests
  // exercise the namespace-aware DOMParser-based parsing across prefix variants.
  describe('discoverSettingsCalendar', () => {
    const calendarHomeUrl = 'https://caldav.example.com/calendars/test/'
    const settingsCalUrl = `${calendarHomeUrl}calino-settings/`

    it('finds the settings calendar via dead property with a lowercase d: prefix', async () => {
      fetchSpy.mockResolvedValue(
        new Response(
          `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:C="http://calino.app/ns/">
  <d:response>
    <d:href>${settingsCalUrl}</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>Calino Settings</d:displayname>
        <C:X-CALINO-SETTINGS-CALENDAR>1</C:X-CALINO-SETTINGS-CALENDAR>
      </d:prop>
    </d:propstat>
  </d:response>
</d:multistatus>`,
          { status: 207 }
        )
      )

      const result = await client.discoverSettingsCalendar(calendarHomeUrl)
      expect(result).toEqual({ url: settingsCalUrl })
    })

    it('finds the settings calendar with an uppercase D: prefix (Fastmail/Cyrus-style)', async () => {
      fetchSpy.mockResolvedValue(
        new Response(
          `<?xml version="1.0"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="http://calino.app/ns/">
  <D:response>
    <D:href>${settingsCalUrl}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>Calino Settings</D:displayname>
        <C:X-CALINO-SETTINGS-CALENDAR>1</C:X-CALINO-SETTINGS-CALENDAR>
      </D:prop>
    </D:propstat>
  </D:response>
</D:multistatus>`,
          { status: 207 }
        )
      )

      const result = await client.discoverSettingsCalendar(calendarHomeUrl)
      expect(result).toEqual({ url: settingsCalUrl })
    })

    it('finds the settings calendar with an arbitrary namespace prefix', async () => {
      fetchSpy.mockResolvedValue(
        new Response(
          `<?xml version="1.0"?>
<x1:multistatus xmlns:x1="DAV:" xmlns:x2="http://calino.app/ns/">
  <x1:response>
    <x1:href>${settingsCalUrl}</x1:href>
    <x1:propstat>
      <x1:prop>
        <x1:displayname>Calino Settings</x1:displayname>
        <x2:X-CALINO-SETTINGS-CALENDAR>1</x2:X-CALINO-SETTINGS-CALENDAR>
      </x1:prop>
    </x1:propstat>
  </x1:response>
</x1:multistatus>`,
          { status: 207 }
        )
      )

      const result = await client.discoverSettingsCalendar(calendarHomeUrl)
      expect(result).toEqual({ url: settingsCalUrl })
    })

    it('finds the settings calendar with a default namespace (no prefix)', async () => {
      fetchSpy.mockResolvedValue(
        new Response(
          `<?xml version="1.0"?>
<multistatus xmlns="DAV:" xmlns:C="http://calino.app/ns/">
  <response>
    <href>${settingsCalUrl}</href>
    <propstat>
      <prop>
        <displayname>Calino Settings</displayname>
        <C:X-CALINO-SETTINGS-CALENDAR>1</C:X-CALINO-SETTINGS-CALENDAR>
      </prop>
    </propstat>
  </response>
</multistatus>`,
          { status: 207 }
        )
      )

      const result = await client.discoverSettingsCalendar(calendarHomeUrl)
      expect(result).toEqual({ url: settingsCalUrl })
    })

    it('falls back to displayname + URL fragment when the dead property is absent', async () => {
      fetchSpy.mockResolvedValue(
        new Response(
          `<?xml version="1.0"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>${settingsCalUrl}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>Calino Settings</D:displayname>
      </D:prop>
    </D:propstat>
  </D:response>
</D:multistatus>`,
          { status: 207 }
        )
      )

      const result = await client.discoverSettingsCalendar(calendarHomeUrl)
      expect(result).toEqual({ url: settingsCalUrl })
    })

    it('returns null when no matching collection is present', async () => {
      fetchSpy.mockResolvedValue(
        new Response(
          `<?xml version="1.0"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>${calendarHomeUrl}default/</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>Default Calendar</D:displayname>
      </D:prop>
    </D:propstat>
  </D:response>
</D:multistatus>`,
          { status: 207 }
        )
      )

      const result = await client.discoverSettingsCalendar(calendarHomeUrl)
      expect(result).toBeNull()
    })

    it('throws a clear error on malformed XML instead of failing silently', async () => {
      fetchSpy.mockResolvedValue(
        new Response('<D:multistatus xmlns:D="DAV:"><D:response>', { status: 207 })
      )

      await expect(client.discoverSettingsCalendar(calendarHomeUrl)).rejects.toThrow(
        /Failed to parse WebDAV XML response/
      )
    })
  })

  describe('fetchSettingsEvent', () => {
    const settingsCalUrl = 'https://caldav.example.com/calendars/test/calino-settings/'
    const eventHref = `${settingsCalUrl}calino-settings.ics`
    const icalData = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:calino-settings\r\nDTSTAMP:20260101T000000Z\r\nEND:VEVENT\r\nEND:VCALENDAR`

    it('parses href, etag, and calendar-data with a lowercase d: prefix', async () => {
      fetchSpy.mockResolvedValue(
        new Response(
          `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>${eventHref}</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>"etag-1"</d:getetag>
        <c:calendar-data>${icalData}</c:calendar-data>
      </d:prop>
    </d:propstat>
  </d:response>
</d:multistatus>`,
          { status: 207 }
        )
      )

      const result = await client.fetchSettingsEvent(settingsCalUrl)
      expect(result).not.toBeNull()
      expect(result?.href).toBe(eventHref)
      expect(result?.etag).toBe('"etag-1"')
      expect(result?.dtstamp).toBe('20260101T000000Z')
      expect(result?.data).toContain('UID:calino-settings')
    })

    it('parses correctly when calendar-data uses a different prefix than href/getetag', async () => {
      // Realistic on real servers: many declare a separate xmlns:cal for CalDAV
      // properties distinct from the DAV: prefix used for href/getetag.
      fetchSpy.mockResolvedValue(
        new Response(
          `<?xml version="1.0"?>
<D:multistatus xmlns:D="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>${eventHref}</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>"etag-2"</D:getetag>
        <cal:calendar-data>${icalData}</cal:calendar-data>
      </D:prop>
    </D:propstat>
  </D:response>
</D:multistatus>`,
          { status: 207 }
        )
      )

      const result = await client.fetchSettingsEvent(settingsCalUrl)
      expect(result).not.toBeNull()
      expect(result?.href).toBe(eventHref)
      expect(result?.etag).toBe('"etag-2"')
      expect(result?.data).toContain('UID:calino-settings')
    })

    it('parses correctly with a default namespace (no prefix)', async () => {
      fetchSpy.mockResolvedValue(
        new Response(
          `<?xml version="1.0"?>
<multistatus xmlns="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <response>
    <href>${eventHref}</href>
    <propstat>
      <prop>
        <getetag>"etag-3"</getetag>
        <cal:calendar-data>${icalData}</cal:calendar-data>
      </prop>
    </propstat>
  </response>
</multistatus>`,
          { status: 207 }
        )
      )

      const result = await client.fetchSettingsEvent(settingsCalUrl)
      expect(result).not.toBeNull()
      expect(result?.etag).toBe('"etag-3"')
    })

    it('returns null when no matching event is present', async () => {
      fetchSpy.mockResolvedValue(
        new Response('<D:multistatus xmlns:D="DAV:"></D:multistatus>', { status: 207 })
      )

      const result = await client.fetchSettingsEvent(settingsCalUrl)
      expect(result).toBeNull()
    })

    it('throws a clear error on malformed XML instead of failing silently', async () => {
      fetchSpy.mockResolvedValue(
        new Response('<D:multistatus xmlns:D="DAV:"><D:response>', { status: 207 })
      )

      await expect(client.fetchSettingsEvent(settingsCalUrl)).rejects.toThrow(
        /Failed to parse WebDAV XML response/
      )
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

    // Issue #110 — same reasoning as createEvent's proxy case.
    it('returns raw URL without proxy prefix', async () => {
      const proxyClient = new CalDAVClient(
        mockCredentials.serverUrl,
        mockCredentials,
        'https://proxy.example.com'
      )
      await proxyClient.connect()

      mockClientMethods.updateCalendarObject.mockResolvedValue({
        url: buildProxyUrl('https://proxy.example.com', mockEventObject.url),
      })

      const result = await proxyClient.updateEvent(
        mockCalendar.url,
        mockEventObject.url,
        mockEventObject.data,
        mockEventObject.etag
      )

      expect(result.url).toBe(mockEventObject.url)
      expect(result.url).not.toContain('proxy.example.com')
    })

    // Same silent-swallow class as deleteEvent: tsdav's updateObject returns
    // the raw Response without checking res.ok, so a 5xx must be surfaced
    // here or a failed destination write looks like success (which would let
    // a move delete its source after the write never landed).
    it('throws when the server responds with a non-2xx status', async () => {
      await client.connect()
      mockClientMethods.updateCalendarObject.mockResolvedValue(
        new Response('oops', { status: 500 })
      )

      await expect(
        client.updateEvent(
          mockCalendar.url,
          mockEventObject.url,
          mockEventObject.data,
          mockEventObject.etag
        )
      ).rejects.toThrow(/HTTP 500/)
    })

    // Bug 20: offline detection
    it('throws when offline', async () => {
      onLineSpy.mockReturnValue(false)
      await client.connect()

      await expect(
        client.updateEvent(
          mockCalendar.url,
          mockEventObject.url,
          mockEventObject.data,
          mockEventObject.etag
        )
      ).rejects.toThrow('No network connection')
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

    // tsdav's deleteObject returns the raw Response without checking `res.ok`,
    // so a 5xx resolves silently. moveEventGroup depends on a failed cleanup
    // DELETE being observable to queue its delete-href retry (#86).
    it('throws when the server responds with a non-2xx status', async () => {
      await client.connect()
      mockClientMethods.deleteCalendarObject.mockResolvedValue(
        new Response('oops', { status: 500 })
      )

      await expect(client.deleteEvent(mockEventObject.url, mockEventObject.etag)).rejects.toThrow(
        /HTTP 500/
      )
    })

    it('attaches the HTTP status to the thrown error so callers can classify it', async () => {
      await client.connect()
      mockClientMethods.deleteCalendarObject.mockResolvedValue(
        new Response('oops', { status: 502 })
      )

      const error = await client
        .deleteEvent(mockEventObject.url, mockEventObject.etag)
        .catch((e: unknown) => e)
      expect((error as Error).message).toContain('HTTP 502')
      expect((error as { status?: number }).status).toBe(502)
    })

    // 404/410 mean the resource is already gone — the outcome a delete wants.
    it('treats 404 as success (resource already gone)', async () => {
      await client.connect()
      mockClientMethods.deleteCalendarObject.mockResolvedValue(
        new Response('gone', { status: 404 })
      )

      await expect(
        client.deleteEvent(mockEventObject.url, mockEventObject.etag)
      ).resolves.toBeUndefined()
    })

    it('treats 410 as success (resource already gone)', async () => {
      await client.connect()
      mockClientMethods.deleteCalendarObject.mockResolvedValue(
        new Response('gone', { status: 410 })
      )

      await expect(
        client.deleteEvent(mockEventObject.url, mockEventObject.etag)
      ).resolves.toBeUndefined()
    })

    // Bug 20: offline detection
    it('throws when offline', async () => {
      onLineSpy.mockReturnValue(false)
      await client.connect()

      await expect(client.deleteEvent(mockEventObject.url, mockEventObject.etag)).rejects.toThrow(
        'No network connection'
      )
    })
  })

  // Finding 6: assertResponseOk must surface the server's Retry-After on
  // rate-limit errors so the pending-change backoff can honor it. Exercised
  // through the public deleteEvent path, which routes every non-2xx response
  // through assertResponseOk.
  describe('Retry-After handling', () => {
    it('attaches a numeric Retry-After to a 429 error', async () => {
      await client.connect()
      mockClientMethods.deleteCalendarObject.mockResolvedValue(
        new Response('slow down', { status: 429, headers: { 'retry-after': '120' } })
      )

      const error = await client
        .deleteEvent(mockEventObject.url, mockEventObject.etag)
        .catch((e: unknown) => e)
      expect((error as { status?: number }).status).toBe(429)
      expect((error as { retryAfter?: number }).retryAfter).toBe(120)
    })

    it('parses an HTTP-date Retry-After into seconds until that date', async () => {
      await client.connect()
      const inFiveMinutes = new Date(Date.now() + 5 * 60_000).toUTCString()
      mockClientMethods.deleteCalendarObject.mockResolvedValue(
        new Response('slow down', { status: 429, headers: { 'retry-after': inFiveMinutes } })
      )

      const error = await client
        .deleteEvent(mockEventObject.url, mockEventObject.etag)
        .catch((e: unknown) => e)
      const retryAfter = (error as { retryAfter?: number }).retryAfter
      expect(retryAfter).toBeGreaterThanOrEqual(290)
      expect(retryAfter).toBeLessThanOrEqual(310)
    })

    it('omits retryAfter when the header is invalid', async () => {
      await client.connect()
      mockClientMethods.deleteCalendarObject.mockResolvedValue(
        new Response('slow down', { status: 429, headers: { 'retry-after': 'not-a-date' } })
      )

      const error = await client
        .deleteEvent(mockEventObject.url, mockEventObject.etag)
        .catch((e: unknown) => e)
      expect((error as { status?: number }).status).toBe(429)
      expect((error as { retryAfter?: number }).retryAfter).toBeUndefined()
    })

    it('omits retryAfter when the header is missing', async () => {
      await client.connect()
      mockClientMethods.deleteCalendarObject.mockResolvedValue(
        new Response('slow down', { status: 429 })
      )

      const error = await client
        .deleteEvent(mockEventObject.url, mockEventObject.etag)
        .catch((e: unknown) => e)
      expect((error as { status?: number }).status).toBe(429)
      expect((error as { retryAfter?: number }).retryAfter).toBeUndefined()
    })

    it('clamps an oversized Retry-After to the safe cap', async () => {
      await client.connect()
      mockClientMethods.deleteCalendarObject.mockResolvedValue(
        new Response('slow down', { status: 429, headers: { 'retry-after': '99999999' } })
      )

      const error = await client
        .deleteEvent(mockEventObject.url, mockEventObject.etag)
        .catch((e: unknown) => e)
      expect((error as { retryAfter?: number }).retryAfter).toBe(3600)
    })
  })

  describe('calendar caching (Bug 32)', () => {
    it('caches calendars after first fetchCalendars() call', async () => {
      await client.connect()

      await client.fetchCalendars()

      // Second call should NOT hit the network again because we cache
      mockClientMethods.fetchCalendars.mockClear()

      // Call fetchEvents which needs to find a calendar
      mockClientMethods.fetchCalendarObjects
        .mockResolvedValueOnce([mockEventObject])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])

      await client.fetchEvents(mockCalendar.url, '2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z')

      // fetchCalendars should NOT have been called again — cached
      expect(mockClientMethods.fetchCalendars).not.toHaveBeenCalled()
    })

    it('fetches calendars once and reuses cache for createEvent', async () => {
      await client.connect()

      await client.fetchCalendars()
      mockClientMethods.fetchCalendars.mockClear()

      mockClientMethods.createCalendarObject.mockResolvedValue({
        url: mockEventObject.url,
      })

      await client.createEvent(mockCalendar.url, mockEventObject.data, 'event-1.ics')

      expect(mockClientMethods.fetchCalendars).not.toHaveBeenCalled()
    })

    it('fetches calendars once and reuses cache for updateEvent', async () => {
      await client.connect()

      await client.fetchCalendars()
      mockClientMethods.fetchCalendars.mockClear()

      mockClientMethods.updateCalendarObject.mockResolvedValue({
        url: mockEventObject.url,
      })

      await client.updateEvent(
        mockCalendar.url,
        mockEventObject.url,
        mockEventObject.data,
        mockEventObject.etag
      )

      expect(mockClientMethods.fetchCalendars).not.toHaveBeenCalled()
    })

    it('fetches calendars lazily on first findCalendarByUrl if cache is empty', async () => {
      await client.connect()
      // Do NOT call fetchCalendars() explicitly — cache should be populated lazily

      mockClientMethods.fetchCalendars.mockClear()
      mockClientMethods.fetchCalendarObjects
        .mockResolvedValueOnce([mockEventObject])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])

      await client.fetchEvents(mockCalendar.url, '2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z')

      // Should have fetched calendars once (lazy init)
      expect(mockClientMethods.fetchCalendars).toHaveBeenCalledTimes(1)

      // Now subsequent calls should use cache
      mockClientMethods.fetchCalendars.mockClear()
      mockClientMethods.fetchCalendarObjects
        .mockResolvedValueOnce([mockEventObject])
        .mockResolvedValueOnce([])

      await client.createEvent(mockCalendar.url, mockEventObject.data, 'event-1.ics')

      // Should NOT fetch calendars again
      expect(mockClientMethods.fetchCalendars).not.toHaveBeenCalled()
    })
  })

  describe('network timeout (Bug 13)', () => {
    it('abort controller is used in proxy fetch path', async () => {
      const proxyClient = new CalDAVClient(
        mockCredentials.serverUrl,
        mockCredentials,
        'https://proxy.example.com'
      )

      // Spy on global fetch to verify AbortController is passed
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(null, { status: 200 }))

      await proxyClient.connect()

      // Verify createDAVClient was called with a custom fetch function
      expect(mockCreateDAVClient).toHaveBeenCalledWith(
        expect.objectContaining({
          fetch: expect.any(Function),
        })
      )

      // Extract the custom fetch function and invoke it to test timeout
      const customFetch = mockCreateDAVClient.mock.calls[0][0].fetch
      // tsdav types `fetch` as optional, so narrow rather than assert: the
      // expectation above already proves it was passed.
      if (!customFetch) throw new Error('createDAVClient was called without a fetch function')
      await customFetch('https://caldav.example.com/dav.php')

      // Verify fetch was called with a signal (from AbortController)
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      )

      fetchSpy.mockRestore()
    })
  })

  describe('buildProxyUrl', () => {
    it('encodes only the origin, path stays unencoded', () => {
      const result = buildProxyUrl('https://proxy.example.com', 'https://caldav.example.com/dav')
      expect(result).toBe(
        `https://proxy.example.com/${encodeURIComponent('https://caldav.example.com')}/dav`
      )
    })

    it('strips trailing slash from proxy base', () => {
      const result = buildProxyUrl('https://proxy.example.com/', 'https://target.com')
      expect(result).toBe(`https://proxy.example.com/${encodeURIComponent('https://target.com')}/`)
    })
  })

  describe('prefixUrlWithProxy', () => {
    it('prefixes a raw server URL', () => {
      expect(prefixUrlWithProxy('https://dav.example.com/x.ics', 'https://proxy.example.com')).toBe(
        buildProxyUrl('https://proxy.example.com', 'https://dav.example.com/x.ics')
      )
    })

    // Issue #110 — versions up to 0.27.1 persisted proxied URLs as
    // `resourceHref`, so those hrefs are still sitting in users' stores.
    // Re-prefixing one produces a URL that resolves to nothing.
    it('leaves an already-proxied URL alone', () => {
      const proxied = buildProxyUrl('https://proxy.example.com', 'https://dav.example.com/x.ics')
      expect(prefixUrlWithProxy(proxied, 'https://proxy.example.com')).toBe(proxied)
      expect(prefixUrlWithProxy(proxied, 'https://proxy.example.com/')).toBe(proxied)
    })
  })

  describe('normalizeColor', () => {
    it('normalizes 6-digit hex to uppercase', () => {
      expect(normalizeColor('#ff5722')).toBe('#FF5722')
    })

    it('strips alpha channel from 8-digit hex', () => {
      expect(normalizeColor('#FF5722FF')).toBe('#FF5722')
    })

    it('expands 3-digit shorthand hex', () => {
      expect(normalizeColor('#F52')).toBe('#FF5522')
    })

    it('returns default for null', () => {
      expect(normalizeColor(null)).toBe('#4285F4')
    })

    it('returns default for undefined', () => {
      expect(normalizeColor(undefined)).toBe('#4285F4')
    })

    it('returns default for empty string', () => {
      expect(normalizeColor('')).toBe('#4285F4')
    })

    it('returns default for invalid color', () => {
      expect(normalizeColor('not-a-color')).toBe('#4285F4')
    })

    it('trims whitespace', () => {
      expect(normalizeColor('  #FF5722  ')).toBe('#FF5722')
    })

    it('returns default for non-string values (tsdav XML object)', () => {
      // tsdav returns an object like { _attributes: { ... } } when
      // the server has no color for a calendar
      expect(
        normalizeColor({ _attributes: { xmlns: 'http://apple.com/ns/ical/' } } as unknown as string)
      ).toBe('#4285F4')
    })

    it('returns default for numeric values', () => {
      expect(normalizeColor(42 as unknown as string)).toBe('#4285F4')
    })
  })

  describe('fetchResourceByHref', () => {
    const href = 'https://caldav.example.com/calendars/test/default/event-1.ics'
    const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR'

    it('GETs the resource and returns its body', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(ICS, { status: 200, headers: { ETag: '"etag-1"' } })
      )

      const result = await client.fetchResourceByHref(href)

      expect(result).toEqual({ url: href, data: ICS, etag: '"etag-1"' })
      const [calledUrl, init] = fetchSpy.mock.calls[0]
      expect(String(calledUrl)).toBe(href)
      expect(init?.method).toBe('GET')
    })

    it('returns null when the resource vanished between REPORT and GET', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('', { status: 404 }))

      // A tombstone the next REPORT will describe properly — not a reason to
      // fail the whole calendar's sync.
      await expect(client.fetchResourceByHref(href)).resolves.toBeNull()
    })

    it('throws on a server error so the caller leaves its sync token alone', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('', { status: 503 }))

      await expect(client.fetchResourceByHref(href)).rejects.toThrow('503')
    })

    it('omits the etag when the browser cannot read the header', async () => {
      // Radicale sends no access-control-expose-headers, so ETag is invisible
      // to a cross-origin browser read. The caller falls back to the etag the
      // REPORT already gave it.
      fetchSpy.mockResolvedValueOnce(new Response(ICS, { status: 200 }))

      const result = await client.fetchResourceByHref(href)

      expect(result?.etag).toBeUndefined()
      expect(result?.data).toBe(ICS)
    })
  })

  describe('syncCollection (RFC 6578)', () => {
    const collectionUrl = 'https://caldav.example.com/calendars/test/default/'

    function multistatusResponse(body: string, status = 207): Response {
      return new Response(body, { status })
    }

    it('parses added/changed resources and captures the returned sync token', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/calendars/test/default/event-1.ics</D:href>
    <D:propstat>
      <D:prop><D:getetag>"etag-1"</D:getetag></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/calendars/test/default/event-2.ics</D:href>
    <D:propstat>
      <D:prop><D:getetag>"etag-2"</D:getetag></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:sync-token>https://caldav.example.com/sync/2</D:sync-token>
</D:multistatus>`
      fetchSpy.mockResolvedValueOnce(multistatusResponse(xml))

      const result = await client.syncCollection(collectionUrl, 'https://caldav.example.com/sync/1')

      expect(result.tokenInvalidated).toBe(false)
      expect(result.newSyncToken).toBe('https://caldav.example.com/sync/2')
      expect(result.changes).toEqual([
        {
          href: 'https://caldav.example.com/calendars/test/default/event-1.ics',
          etag: '"etag-1"',
          status: 'changed',
        },
        {
          href: 'https://caldav.example.com/calendars/test/default/event-2.ics',
          etag: '"etag-2"',
          status: 'changed',
        },
      ])

      // Sent a REPORT carrying the supplied sync token.
      const [, init] = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1]
      expect(init?.method).toBe('REPORT')
      expect(String(init?.body)).toContain('<D:sync-token>https://caldav.example.com/sync/1</D:sync-token>')
    })

    it('parses tombstoned (removed) resources reported as a top-level 404', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/calendars/test/default/event-deleted.ics</D:href>
    <D:status>HTTP/1.1 404 Not Found</D:status>
  </D:response>
  <D:sync-token>https://caldav.example.com/sync/3</D:sync-token>
</D:multistatus>`
      fetchSpy.mockResolvedValueOnce(multistatusResponse(xml))

      const result = await client.syncCollection(collectionUrl, 'https://caldav.example.com/sync/2')

      expect(result.tokenInvalidated).toBe(false)
      expect(result.changes).toEqual([
        {
          href: 'https://caldav.example.com/calendars/test/default/event-deleted.ics',
          etag: null,
          status: 'removed',
        },
      ])
    })

    it.each([400, 403, 409, 507])(
      'sets tokenInvalidated on a %d response and drops the token',
      async (status) => {
        fetchSpy.mockResolvedValueOnce(new Response('', { status }))

        const result = await client.syncCollection(collectionUrl, 'stale-token')

        expect(result).toEqual({ changes: [], newSyncToken: null, tokenInvalidated: true })
      }
    )

    it('treats the DAV:valid-sync-token precondition as a rejected token', async () => {
      // Verified against Radicale 3: a stale or unparsable token comes back as
      // 403 carrying this precondition element, NOT the 400/507 this code
      // originally enumerated. The fallback survived only because of the
      // catch-all for non-2xx; this pins the real-world shape so a future
      // narrowing of that branch cannot quietly strand the cursor.
      fetchSpy.mockResolvedValueOnce(
        new Response(
          `<?xml version='1.0' encoding='utf-8'?>\n<error xmlns="DAV:"><valid-sync-token /></error>`,
          { status: 403 }
        )
      )

      const result = await client.syncCollection(collectionUrl, 'stale-token')

      expect(result).toEqual({ changes: [], newSyncToken: null, tokenInvalidated: true })
    })

    it('sets tokenInvalidated when the request throws (network failure)', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('network down'))

      const result = await client.syncCollection(collectionUrl, 'token-1')

      expect(result).toEqual({ changes: [], newSyncToken: null, tokenInvalidated: true })
    })

    it('parses an UNPREFIXED (Radicale-shaped) multistatus — this is exactly what a prefix-bound regex misses', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:">
  <response>
    <href>/ivan/calendars/default/event-radicale.ics</href>
    <propstat>
      <prop><getetag>"radicale-etag"</getetag></prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
  <response>
    <href>/ivan/calendars/default/event-gone.ics</href>
    <status>HTTP/1.1 404 Not Found</status>
  </response>
  <sync-token>http://radicale.malinov.ski/sync/7</sync-token>
</multistatus>`
      fetchSpy.mockResolvedValueOnce(multistatusResponse(xml))

      const result = await client.syncCollection(collectionUrl, null)

      expect(result.tokenInvalidated).toBe(false)
      expect(result.newSyncToken).toBe('http://radicale.malinov.ski/sync/7')
      expect(result.changes).toEqual([
        {
          href: 'https://caldav.example.com/ivan/calendars/default/event-radicale.ics',
          etag: '"radicale-etag"',
          status: 'changed',
        },
        {
          href: 'https://caldav.example.com/ivan/calendars/default/event-gone.ics',
          etag: null,
          status: 'removed',
        },
      ])
    })

    it('resolves an absolute href unchanged', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>https://other-host.example.com/cal/event-abs.ics</D:href>
    <D:propstat>
      <D:prop><D:getetag>"abs-etag"</D:getetag></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:sync-token>tok-abs</D:sync-token>
</D:multistatus>`
      fetchSpy.mockResolvedValueOnce(multistatusResponse(xml))

      const result = await client.syncCollection(collectionUrl, null)

      expect(result.changes).toEqual([
        {
          href: 'https://other-host.example.com/cal/event-abs.ics',
          etag: '"abs-etag"',
          status: 'changed',
        },
      ])
    })

    it('resolves a relative href against the collection URL', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>event-rel.ics</D:href>
    <D:propstat>
      <D:prop><D:getetag>"rel-etag"</D:getetag></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:sync-token>tok-rel</D:sync-token>
</D:multistatus>`
      fetchSpy.mockResolvedValueOnce(multistatusResponse(xml))

      const result = await client.syncCollection(collectionUrl, null)

      expect(result.changes).toEqual([
        {
          href: 'https://caldav.example.com/calendars/test/default/event-rel.ics',
          etag: '"rel-etag"',
          status: 'changed',
        },
      ])
    })

    it('preserves a percent-encoded href exactly as the server sent it', async () => {
      // %20 round-trips through a decode, but %23/%3F do not: decoding them
      // first yields a literal '#'/'?' which `new URL()` reparses as a
      // fragment/query, truncating the path. A later GET would then fetch the
      // wrong resource and the href would not match the stored one.
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/calendars/test/my%20calendar/event%20four.ics</D:href>
    <D:propstat>
      <D:prop><D:getetag>"enc-etag"</D:getetag></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/calendars/test/hash%231.ics</D:href>
    <D:propstat>
      <D:prop><D:getetag>"hash-etag"</D:getetag></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/calendars/test/query%3Fx.ics</D:href>
    <D:propstat>
      <D:prop><D:getetag>"query-etag"</D:getetag></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:sync-token>tok-enc</D:sync-token>
</D:multistatus>`
      fetchSpy.mockResolvedValueOnce(multistatusResponse(xml))

      const result = await client.syncCollection(collectionUrl, null)

      expect(result.changes).toEqual([
        {
          href: 'https://caldav.example.com/calendars/test/my%20calendar/event%20four.ics',
          etag: '"enc-etag"',
          status: 'changed',
        },
        {
          href: 'https://caldav.example.com/calendars/test/hash%231.ics',
          etag: '"hash-etag"',
          status: 'changed',
        },
        {
          href: 'https://caldav.example.com/calendars/test/query%3Fx.ics',
          etag: '"query-etag"',
          status: 'changed',
        },
      ])
    })

    it('sends an empty sync-token element for a full (initial) sync', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:sync-token>tok-initial</D:sync-token>
</D:multistatus>`
      fetchSpy.mockResolvedValueOnce(multistatusResponse(xml))

      const result = await client.syncCollection(collectionUrl, null)

      expect(result.newSyncToken).toBe('tok-initial')
      expect(result.changes).toEqual([])
      const [, init] = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1]
      expect(String(init?.body)).toContain('<D:sync-token/>')
    })
  })
})
