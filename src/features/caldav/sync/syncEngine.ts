import type { CalendarEvent } from '@/types'
import type { SyncResult, ConflictResolution } from '../types'
import { CalDAVClient } from '../client/CalDAVClient'
import { eventToICAL, parseICALEvent } from '../adapter/iCalendarAdapter'
import * as storage from './accountStorage'

export class SyncEngine {
  private client: CalDAVClient
  private calendarId: string

  constructor(client: CalDAVClient, calendarId: string) {
    this.client = client
    this.calendarId = calendarId
  }

  async fullSync(
    start: string,
    end: string,
    existingEvents: CalendarEvent[]
  ): Promise<{ events: CalendarEvent[]; result: SyncResult }> {
    const calendar = storage.getAllCalendars().find((c) => c.id === this.calendarId)

    if (!calendar) {
      throw new Error(`Calendar not found: ${this.calendarId}`)
    }

    const serverEvents = await this.client.fetchEvents(calendar.url, start, end)

    const parsedEvents: CalendarEvent[] = []
    for (const serverEvent of serverEvents) {
      const events = parseICALEvent(serverEvent.data, this.calendarId)
      parsedEvents.push(...events)
    }

    const result: SyncResult = {
      added: [],
      updated: [],
      deleted: [],
      conflicts: [],
    }

    const serverEventIds = new Set(parsedEvents.map((e) => e.id))

    for (const event of parsedEvents) {
      const localEvent = existingEvents.find((e) => e.id === event.id)

      if (!localEvent) {
        result.added.push(event.id)
      } else if (this.hasConflict(localEvent, event)) {
        result.conflicts.push(event.id)
      } else if (this.isNewer(event, localEvent)) {
        result.updated.push(event.id)
      }
    }

    for (const localEvent of existingEvents) {
      if (!serverEventIds.has(localEvent.id)) {
        result.deleted.push(localEvent.id)
      }
    }

    return {
      events: parsedEvents,
      result,
    }
  }

  async pushEvent(event: CalendarEvent): Promise<{ url: string; etag: string }> {
    const calendar = storage.getAllCalendars().find((c) => c.id === this.calendarId)

    if (!calendar) {
      throw new Error(`Calendar not found: ${this.calendarId}`)
    }

    console.log('[SyncEngine] pushEvent', { calendarUrl: calendar.url, eventId: event.id })
    const iCalString = eventToICAL(event)
    const filename = `${event.id}.ics`

    console.log('[SyncEngine] full iCal content:', iCalString)
    return this.client.createEvent(calendar.url, iCalString, filename)
  }

  async updateEvent(event: CalendarEvent, etag: string): Promise<{ url: string; etag: string }> {
    const calendar = storage.getAllCalendars().find((c) => c.id === this.calendarId)

    if (!calendar) {
      throw new Error(`Calendar not found: ${this.calendarId}`)
    }

    console.log('[SyncEngine] updateEvent', { calendarUrl: calendar.url, eventId: event.id })
    const iCalString = eventToICAL(event)
    const eventUrl = `${calendar.url}${event.id}.ics`

    console.log('[SyncEngine] full iCal content:', iCalString)
    return this.client.updateEvent(calendar.url, eventUrl, iCalString, etag)
  }

  async deleteEvent(eventUrl: string, etag: string): Promise<void> {
    return this.client.deleteEvent(eventUrl, etag)
  }

  private hasConflict(local: CalendarEvent, server: CalendarEvent): boolean {
    return local.start !== server.start || local.end !== server.end || local.title !== server.title
  }

  private isNewer(server: CalendarEvent, local: CalendarEvent): boolean {
    const serverTime = new Date(server.start).getTime()
    const localTime = new Date(local.start).getTime()
    return serverTime > localTime
  }

  resolveConflict(
    _event: CalendarEvent,
    resolution: ConflictResolution,
    localVersion: CalendarEvent,
    serverVersion: CalendarEvent
  ): CalendarEvent {
    switch (resolution) {
      case 'server-wins':
        return serverVersion
      case 'local-wins':
        return localVersion
      case 'merge':
        return {
          ...serverVersion,
          title: localVersion.title || serverVersion.title,
          description: localVersion.description || serverVersion.description,
          location: localVersion.location || serverVersion.location,
        }
      default:
        return serverVersion
    }
  }
}

export function createSyncEngine(client: CalDAVClient, calendarId: string): SyncEngine {
  return new SyncEngine(client, calendarId)
}
