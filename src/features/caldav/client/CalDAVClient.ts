import { createDAVClient } from 'tsdav'
import type { CalDAVCredentials, CalDAVCalendar } from '../types'

export class CalDAVClient {
  private client: Awaited<ReturnType<typeof createDAVClient>> | null = null
  private serverUrl: string
  private credentials: CalDAVCredentials

  constructor(serverUrl: string, credentials: CalDAVCredentials) {
    this.serverUrl = serverUrl
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
      url: cal.url || '',
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
    const calendar = calendars.find((c) => c.url === calendarUrl)

    if (!calendar) {
      throw new Error(`Calendar not found: ${calendarUrl}`)
    }

    const calendarObjects = await client.fetchCalendarObjects({
      calendar,
      timeRange: {
        start,
        end,
      },
    })

    return calendarObjects.map((obj) => ({
      url: obj.url,
      data: obj.data as string,
      etag: obj.etag,
    }))
  }

  async createEvent(
    calendarUrl: string,
    iCalString: string,
    filename: string
  ): Promise<{ url: string; etag: string }> {
    const client = this.getClient()

    const calendars = await client.fetchCalendars()
    const calendar = calendars.find((c) => c.url === calendarUrl)

    if (!calendar) {
      throw new Error(`Calendar not found: ${calendarUrl}`)
    }

    const result = await client.createCalendarObject({
      calendar,
      filename,
      iCalString,
    })

    return {
      url: result.url,
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
    const calendar = calendars.find((c) => c.url === calendarUrl)

    if (!calendar) {
      throw new Error(`Calendar not found: ${calendarUrl}`)
    }

    const result = await client.updateCalendarObject({
      calendarObject: { url: eventUrl, etag, data: iCalString },
    })

    return {
      url: result.url,
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
}

export async function createCalDAVClient(
  serverUrl: string,
  credentials: CalDAVCredentials
): Promise<CalDAVClient> {
  const client = new CalDAVClient(serverUrl, credentials)
  await client.connect()
  return client
}
