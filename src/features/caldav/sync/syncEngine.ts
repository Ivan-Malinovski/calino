import type { CalendarEvent } from '@/types'
import type { SyncResult, ConflictResolution } from '../types'
import { CalDAVClient } from '../client/CalDAVClient'
import { eventToICAL, eventsToICAL, parseICALData, taskToICAL, journalToICAL } from '../adapter/iCalendarAdapter'
import { isUUID } from '@/lib/uuid'
import * as storage from './accountStorage'
import { getAttachments, putAttachments } from '@/lib/attachmentStore'

/**
 * Map a local UID to a resource filename accepted by strict WebDAV servers.
 * Recurrence instance IDs include ISO timestamps (`:`), which Radicale rejects
 * in request paths before it can answer a CORS preflight.
 */
export function eventResourceFilename(eventId: string): string {
  return `${encodeURIComponent(eventId)
    .replace(/[!'()*~]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replaceAll('%', '~')}.ics`
}

/** Enrich an event with attachment data from IndexedDB before serializing. */
async function withInlineAttachments(event: CalendarEvent): Promise<CalendarEvent> {
  if (!event.attachments || event.attachments.length === 0) return event
  const needsInline = event.attachments.some((att) => !att.href)
  if (!needsInline) return event

  const stored = await getAttachments(event.id)
  if (stored.length === 0) return event

  return {
    ...event,
    attachments: event.attachments.map((att, i) => {
      if (!att.href && stored[i]) {
        return { ...att, href: stored[i].href }
      }
      return att
    }),
  }
}

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
  ): Promise<{ events: CalendarEvent[]; result: SyncResult; categoryNames: string[] }> {
    const calendar = storage.getAllCalendars().find((c) => c.id === this.calendarId)

    if (!calendar) {
      throw new Error(`Calendar not found: ${this.calendarId}`)
    }

    const serverEventsRaw = await this.client.fetchEvents(calendar.url, start, end, true)

    const parsedEvents: CalendarEvent[] = []
    const allCategoryNames = new Set<string>()
    for (const serverEvent of serverEventsRaw) {
      const events = parseICALData(serverEvent.data, this.calendarId)
      for (let event of events) {
        // Store inline attachments in IndexedDB, keep only metadata in zustand
        if (event.attachments && event.attachments.length > 0) {
          const hasInline = event.attachments.some((att) => att.href.startsWith('data:'))
          if (hasInline) {
            await putAttachments(event.id, event.attachments)
            // Strip base64 data from the event object
            event = {
              ...event,
              attachments: event.attachments.map((att) => ({
                ...att,
                href: att.href.startsWith('data:') ? '' : att.href,
              })),
            }
          }
        }
        parsedEvents.push({
          ...event,
          etag: serverEvent.etag,
          resourceHref: serverEvent.url,
        })
        if (event.categories) {
          for (const cat of event.categories) {
            if (!isUUID(cat)) {
              allCategoryNames.add(cat)
            }
          }
        }
      }
    }

    const result: SyncResult = {
      added: [],
      updated: [],
      deleted: [],
      conflicts: [],
    }

    const serverEventIds = new Set(parsedEvents.map((e) => e.id))
    const localEventsById = new Map(existingEvents.map((e) => [e.id, e]))

    for (const serverEvent of parsedEvents) {
      const localEvent = localEventsById.get(serverEvent.id)

      if (!localEvent) {
        result.added.push(serverEvent.id)
      } else if (this.hasConflict(localEvent, serverEvent)) {
        const conflictResolved = this.resolveVersionConflict(localEvent, serverEvent)
        if (conflictResolved === 'server') {
          result.updated.push(serverEvent.id)
        } else if (conflictResolved === 'local') {
          // Keep local version, mark as needing push
          result.conflicts.push(serverEvent.id)
        } else {
          result.conflicts.push(serverEvent.id)
        }
      } else if (this.isNewer(serverEvent, localEvent)) {
        result.updated.push(serverEvent.id)
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
      categoryNames: Array.from(allCategoryNames),
    }
  }

  async pushEvent(event: CalendarEvent): Promise<{ url: string; etag: string }> {
    const calendar = storage.getAllCalendars().find((c) => c.id === this.calendarId)

    if (!calendar) {
      throw new Error(`Calendar not found: ${this.calendarId}`)
    }

    const enriched = await withInlineAttachments(event)
    let iCalString: string
    if (enriched.type === 'task') {
      iCalString = taskToICAL(enriched)
    } else if (enriched.type === 'journal') {
      iCalString = journalToICAL(enriched)
    } else {
      iCalString = eventToICAL(enriched)
    }
    const filename = eventResourceFilename(event.id)

    return this.client.createEvent(calendar.url, iCalString, filename)
  }

  async updateEvent(event: CalendarEvent, etag: string): Promise<{ url: string; etag: string }> {
    const calendar = storage.getAllCalendars().find((c) => c.id === this.calendarId)

    if (!calendar) {
      throw new Error(`Calendar not found: ${this.calendarId}`)
    }

    const enriched = await withInlineAttachments(event)
    let iCalString: string
    if (enriched.type === 'task') {
      iCalString = taskToICAL(enriched)
    } else if (enriched.type === 'journal') {
      iCalString = journalToICAL(enriched)
    } else {
      iCalString = eventToICAL(enriched)
    }
    const eventUrl = event.resourceHref || `${calendar.url}${eventResourceFilename(event.id)}`

    return this.client.updateEvent(calendar.url, eventUrl, iCalString, etag)
  }

  async updateEventGroup(events: CalendarEvent[], etag: string): Promise<{ url: string; etag: string }> {
    const calendar = storage.getAllCalendars().find((c) => c.id === this.calendarId)
    const master = events.find((event) => !event.recurrenceId)
    if (!calendar || !master) {
      throw new Error(`Calendar or recurrence master not found: ${this.calendarId}`)
    }

    const enriched = await Promise.all(events.map((event) => withInlineAttachments(event)))
    const eventUrl = master.resourceHref || `${calendar.url}${eventResourceFilename(master.id)}`
    return this.client.updateEvent(calendar.url, eventUrl, eventsToICAL(enriched), etag)
  }

  async deleteEvent(eventUrl: string, etag: string): Promise<void> {
    return this.client.deleteEvent(eventUrl, etag)
  }

  private hasConflict(local: CalendarEvent, server: CalendarEvent): boolean {
    if (local.start !== server.start || local.end !== server.end || local.title !== server.title) {
      return true
    }
    if (local.description !== server.description) {
      return true
    }
    if (local.location !== server.location) {
      return true
    }
    return false
  }

  private isNewer(server: CalendarEvent, local: CalendarEvent): boolean {
    const serverSeq = server.sequence ?? 0
    const localSeq = local.sequence ?? 0

    if (serverSeq > localSeq) {
      return true
    }

    if (serverSeq < localSeq) {
      return false
    }

    // Bug 33 fix: sequences are equal — no reliable modification-time
    // heuristic is available, so treat as the same version (not newer).
    return false
  }

  private resolveVersionConflict(
    local: CalendarEvent,
    server: CalendarEvent
  ): 'server' | 'local' | 'conflict' {
    const serverSeq = server.sequence ?? 0
    const localSeq = local.sequence ?? 0

    if (serverSeq > localSeq) {
      return 'server'
    }

    if (localSeq > serverSeq) {
      return 'local'
    }

    return 'conflict'
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
