import type { CalendarEvent } from '@/types'
import type { SyncResult, ConflictResolution } from '../types'
import { CalDAVClient } from '../client/CalDAVClient'
import {
  eventToICAL,
  eventsToICAL,
  parseICALData,
  taskToICAL,
  journalToICAL,
} from '../adapter/iCalendarAdapter'
import { isUUID } from '@/lib/uuid'
import * as storage from './accountStorage'
import { getAttachments, putAttachments } from '@/lib/attachmentStore'
import { putRawIcs, deleteRawIcs, getRawIcs } from '@/lib/rawIcsStore'
import { patchICALData } from '../adapter/icalPatch'

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

/**
 * True when `href` names a resource inside `calendarUrl`'s collection.
 *
 * Used to reject a stale `resourceHref` when an event has been reassigned to a
 * different calendar: `CalDAVClient.updateEvent` PUTs to the href and treats the
 * collection URL as validation only, so writing to an href from another
 * collection silently puts the event back where it came from (issue #86).
 *
 * `resourceHref` may be origin-relative, so both sides are resolved against the
 * collection URL before comparing paths.
 */
export function resourceIsInCollection(href: string, calendarUrl: string): boolean {
  try {
    const withSlash = (p: string): string => (p.endsWith('/') ? p : `${p}/`)
    const collection = new URL(calendarUrl)
    const resource = new URL(href, calendarUrl)
    if (resource.origin !== collection.origin) return false
    return resource.pathname.startsWith(withSlash(collection.pathname))
  } catch {
    return false
  }
}

/** Serialize one event with the representation its type requires. */
function serializeEvent(event: CalendarEvent): string {
  if (event.type === 'task') return taskToICAL(event)
  if (event.type === 'journal') return journalToICAL(event)
  return eventToICAL(event)
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
      // Keep the untouched text so a later save can patch it rather than
      // rebuild it. Once per resource, not per event: a recurrence master and
      // its overrides come from the same document. Never fatal — losing the
      // original costs fidelity on the next save, breaking the sync costs the
      // user their calendar.
      await putRawIcs(serverEvent.url, this.calendarId, serverEvent.data, serverEvent.etag).catch(
        () => {}
      )

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
    const iCalString = serializeEvent(enriched)
    const filename = eventResourceFilename(event.id)

    const written = await this.client.createEvent(calendar.url, iCalString, filename)
    await this.rememberRawIcs(written, iCalString)
    return written
  }

  async updateEvent(event: CalendarEvent, etag: string): Promise<{ url: string; etag: string }> {
    const calendar = storage.getAllCalendars().find((c) => c.id === this.calendarId)

    if (!calendar) {
      throw new Error(`Calendar not found: ${this.calendarId}`)
    }

    const enriched = await withInlineAttachments(event)
    // Never write to an href outside this calendar's collection: that's how a
    // reassigned event used to be PUT straight back into its old calendar (#86).
    const eventUrl =
      event.resourceHref && resourceIsInCollection(event.resourceHref, calendar.url)
        ? event.resourceHref
        : `${calendar.url}${eventResourceFilename(event.id)}`
    // `If-Match` is sent below, so a stale original is caught by a 412.
    const iCalString = await this.serializeForResource([enriched], eventUrl)

    const written = await this.client.updateEvent(calendar.url, eventUrl, iCalString, etag)
    await this.rememberRawIcs(written, iCalString, eventUrl)
    return written
  }

  async updateEventGroup(
    events: CalendarEvent[],
    etag: string
  ): Promise<{ url: string; etag: string }> {
    const calendar = storage.getAllCalendars().find((c) => c.id === this.calendarId)
    const master = events.find((event) => !event.recurrenceId)
    if (!calendar || !master) {
      throw new Error(`Calendar or recurrence master not found: ${this.calendarId}`)
    }

    const enriched = await Promise.all(events.map((event) => withInlineAttachments(event)))
    // Same collection guard as updateEvent — see #86.
    const eventUrl =
      master.resourceHref && resourceIsInCollection(master.resourceHref, calendar.url)
        ? master.resourceHref
        : `${calendar.url}${eventResourceFilename(master.id)}`
    // As in updateEvent: `If-Match` below makes a stale original a 412.
    const iCalString = await this.serializeForResource(enriched, eventUrl)
    const written = await this.client.updateEvent(calendar.url, eventUrl, iCalString, etag)
    await this.rememberRawIcs(written, iCalString, eventUrl)
    return written
  }

  /**
   * Write an event (or a whole recurrence group) into this engine's calendar at
   * the href derived from the master's id, ignoring any existing `resourceHref`.
   *
   * This is the destination half of a move. It deliberately sends an EMPTY etag:
   * tsdav drops a falsy `If-Match`, so a retried move overwrites its own partial
   * result instead of failing. `createEvent` can't be used for this because
   * tsdav hardcodes `If-None-Match: *` on creates, which would 412 on retry.
   */
  async putEventGroup(events: CalendarEvent[]): Promise<{ url: string; etag: string }> {
    const calendar = storage.getAllCalendars().find((c) => c.id === this.calendarId)
    const master = events.find((event) => !event.recurrenceId) ?? events[0]
    if (!calendar || !master) {
      throw new Error(`Calendar or recurrence master not found: ${this.calendarId}`)
    }

    const enriched = await Promise.all(events.map((event) => withInlineAttachments(event)))
    const eventUrl = `${calendar.url}${eventResourceFilename(master.id)}`
    // This path sends an empty `If-Match` on purpose (see above), so nothing
    // would catch a stale original — require the stored etag to match the one
    // the master was last seen with before trusting it.
    const iCalString = await this.serializeForResource(enriched, eventUrl, master.etag ?? '')
    const written = await this.client.updateEvent(calendar.url, eventUrl, iCalString, '')
    await this.rememberRawIcs(written, iCalString, eventUrl)
    return written
  }

  /**
   * Serialize a resource, preferring a patch of the bytes the server last gave
   * us over a from-scratch rebuild.
   *
   * Rebuilding drops every property Calino doesn't model, so patching is always
   * preferred — but only against an original we can show is current. Pass
   * `expectedEtag` on any path that does NOT send `If-Match`: elsewhere a stale
   * original is caught by the server returning 412, but an unconditional PUT
   * would silently resurrect properties the server has since dropped.
   *
   * Falls back to the previous behaviour whenever there is nothing stored or
   * the patch fails — a save that loses unmodelled properties beats no save.
   */
  private async serializeForResource(
    events: CalendarEvent[],
    href: string | undefined,
    expectedEtag?: string
  ): Promise<string> {
    const fromScratch = () =>
      events.length > 1 ? eventsToICAL(events) : serializeEvent(events[0])

    if (!href) return fromScratch()

    const original = await getRawIcs(href).catch(() => undefined)
    if (!original) return fromScratch()
    if (expectedEtag !== undefined && (!original.etag || original.etag !== expectedEtag)) {
      return fromScratch()
    }

    return patchICALData(original.ics, events) ?? fromScratch()
  }

  async deleteEvent(eventUrl: string, etag: string): Promise<void> {
    await this.client.deleteEvent(eventUrl, etag)
    // Centralised here rather than at the (four) call sites, so no delete path
    // can leave the original behind as an orphan.
    await deleteRawIcs(eventUrl).catch(() => {})
  }

  /**
   * Remember the exact bytes we just PUT, so consecutive edits keep patching a
   * current original instead of waiting for the next sync to refresh it.
   *
   * Keyed by the url the server reported; `fallbackUrl` covers a client that
   * answers without one. Non-fatal for the same reason as on read: the write
   * already succeeded, and failing it here would make the caller retry a PUT
   * that landed.
   */
  private async rememberRawIcs(
    written: { url?: string; etag?: string },
    ics: string,
    fallbackUrl?: string
  ): Promise<void> {
    const href = written?.url || fallbackUrl
    if (!href) return
    await putRawIcs(href, this.calendarId, ics, written.etag).catch(() => {})
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
