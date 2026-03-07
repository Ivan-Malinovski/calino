import { createDAVClient } from 'tsdav'
import type { CalDAVCredentials, CalDAVCalendar } from '../types'

export function buildProxyUrl(proxyBase: string, targetUrl: string): string {
  const encodedTarget = encodeURIComponent(targetUrl)
  const proxyBaseClean = proxyBase.replace(/\/$/, '')
  return `${proxyBaseClean}/${encodedTarget}`
}

function prefixUrlWithProxy(url: string, proxyBase: string): string {
  if (!proxyBase) {
    return url
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    return buildProxyUrl(proxyBase, url)
  }

  if (url.startsWith('/')) {
    return buildProxyUrl(proxyBase, url)
  }

  return buildProxyUrl(proxyBase, url)
}

function createProxyFetch(proxyUrl: string): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url: string
    if (typeof input === 'string') {
      url = input
    } else if (input instanceof Request) {
      url = input.url
    } else {
      url = input.toString()
    }
    const proxiedUrl = prefixUrlWithProxy(url, proxyUrl)
    return fetch(proxiedUrl, init)
  }
}

export class CalDAVClient {
  private client: Awaited<ReturnType<typeof createDAVClient>> | null = null
  private serverUrl: string
  private proxyUrl: string | null
  private credentials: CalDAVCredentials

  constructor(serverUrl: string, credentials: CalDAVCredentials, proxyUrl: string | null = null) {
    this.serverUrl = serverUrl
    this.proxyUrl = proxyUrl
    this.credentials = credentials
  }

  async connect(): Promise<void> {
    this.client = await createDAVClient({
      serverUrl: this.serverUrl,
      credentials: {
        username: this.credentials.username,
        password: this.credentials.password,
      },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
      fetch: this.proxyUrl ? createProxyFetch(this.proxyUrl) : undefined,
    })
  }

  private getClient() {
    if (!this.client) {
      throw new Error('Client not connected. Call connect() first.')
    }
    return this.client
  }

  async fetchCalendars(): Promise<CalDAVCalendar[]> {
    const client = this.getClient()
    const davCalendars = await client.fetchCalendars()

    return davCalendars.map((cal, index) => ({
      id: cal.url || `cal-${index}-${Date.now()}`,
      accountId: this.credentials.id,
      url: this.proxyUrl ? prefixUrlWithProxy(cal.url || '', this.proxyUrl) : cal.url || '',
      name: typeof cal.displayName === 'string' ? cal.displayName : 'Unnamed Calendar',
      color: '#4285F4',
      ctag: null,
      syncToken: null,
      isVisible: true,
      isDefault: false,
    }))
  }

  async fetchEvents(
    calendarUrl: string,
    start: string,
    end: string
  ): Promise<{ url: string; data: string; etag?: string }[]> {
    const client = this.getClient()

    const calendars = await client.fetchCalendars()
    const calendar = calendars.find(
      (c) =>
        c.url === calendarUrl ||
        (this.proxyUrl && prefixUrlWithProxy(c.url || '', this.proxyUrl) === calendarUrl)
    )

    if (!calendar) {
      throw new Error(`Calendar not found: ${calendarUrl}`)
    }

    // Fetch VEVENTs with time range
    const eventObjects = await client.fetchCalendarObjects({
      calendar,
      timeRange: {
        start,
        end,
      },
    })

    // Fetch VTODOs with custom filter (tsdav defaults to VEVENT only)
    const todoObjects = await client.fetchCalendarObjects({
      calendar,
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

    const allItems = [...eventObjects, ...todoObjects]

    // Remove duplicates by URL
    const uniqueByUrl = new Map<string, { url: string; data: string; etag?: string }>()
    for (const obj of allItems) {
      if (!uniqueByUrl.has(obj.url)) {
        uniqueByUrl.set(obj.url, {
          url: this.proxyUrl ? prefixUrlWithProxy(obj.url, this.proxyUrl) : obj.url,
          data: obj.data as string,
          etag: obj.etag,
        })
      }
    }

    return Array.from(uniqueByUrl.values())
  }

  async createEvent(
    calendarUrl: string,
    iCalString: string,
    filename: string
  ): Promise<{ url: string; etag: string }> {
    const client = this.getClient()

    const calendars = await client.fetchCalendars()
    const calendar = calendars.find(
      (c) =>
        c.url === calendarUrl ||
        (this.proxyUrl && prefixUrlWithProxy(c.url || '', this.proxyUrl) === calendarUrl)
    )

    if (!calendar) {
      throw new Error(`Calendar not found: ${calendarUrl}`)
    }

    const result = await client.createCalendarObject({
      calendar,
      filename,
      iCalString,
    })

    return {
      url: this.proxyUrl ? prefixUrlWithProxy(result.url, this.proxyUrl) : result.url,
      etag: '',
    }
  }

  async updateEvent(
    calendarUrl: string,
    eventUrl: string,
    iCalString: string,
    etag: string
  ): Promise<{ url: string; etag: string }> {
    const client = this.getClient()

    const calendars = await client.fetchCalendars()
    const calendar = calendars.find(
      (c) =>
        c.url === calendarUrl ||
        (this.proxyUrl && prefixUrlWithProxy(c.url || '', this.proxyUrl) === calendarUrl)
    )

    if (!calendar) {
      throw new Error(`Calendar not found: ${calendarUrl}`)
    }

    const result = await client.updateCalendarObject({
      calendarObject: { url: eventUrl, etag, data: iCalString },
    })

    return {
      url: this.proxyUrl ? prefixUrlWithProxy(result.url, this.proxyUrl) : result.url,
      etag: '',
    }
  }

  async deleteEvent(eventUrl: string, etag: string): Promise<void> {
    const client = this.getClient()

    await client.deleteCalendarObject({
      calendarObject: { url: eventUrl, etag },
    })
  }

  getServerUrl(): string {
    return this.serverUrl
  }

  getProxyUrl(): string | null {
    return this.proxyUrl
  }
}

export async function createCalDAVClient(
  serverUrl: string,
  credentials: CalDAVCredentials,
  proxyUrl: string | null = null
): Promise<CalDAVClient> {
  const client = new CalDAVClient(serverUrl, credentials, proxyUrl)
  await client.connect()
  return client
}
