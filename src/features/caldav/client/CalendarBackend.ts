import type {
  CalDAVCalendar,
  CalendarProtocol,
  CalendarOwner,
  CalendarUser,
  CreateCalendarOptions,
  ServerSubscription,
  UpdateCalendarOptions,
} from '../types'
import type { FetchEventsResult, SyncCollectionResult } from './CalDAVClient'
import type { FreeBusyPeriod } from '@/lib/freeBusyCalculator'

export type { CalendarProtocol }

/**
 * Protocol-neutral calendar backend.
 *
 * This is the surface `SyncEngine`, `useCalDAV`, `useSettingsSync` and
 * `headless.ts` use. It is deliberately shaped like the CalDAV client: events
 * travel as iCalendar strings and are addressed by an opaque `url` (href) with
 * an opaque `etag`. A JMAP backend translates JSCalendar to and from iCalendar
 * at this boundary, so everything above it (adapter, raw-ICS store, patching,
 * conflict handling) is shared between protocols.
 *
 * Contract for implementations:
 * - `Calendar.url` and event `url` values are absolute URLs that are stable
 *   across sessions and where an event URL lies "inside" its calendar URL
 *   (`resourceIsInCollection` is used on them).
 * - `etag` changes whenever the server-side object changes.
 */
export interface CalendarBackend {
  readonly protocol: CalendarProtocol
  /**
   * True when `updateEvent` accepts an event URL from one calendar together with
   * a different target calendar URL and moves the resource atomically (JMAP).
   * Callers use it for same-account moves instead of write-then-delete.
   */
  readonly atomicMove?: boolean
  connect(): Promise<void>
  getServerUrl(): string
  getProxyUrl(): string | null
  /** Optional server push notification; callers trigger their usual sync. */
  watch?(onChange: () => void): () => void

  fetchCalendars(): Promise<CalDAVCalendar[]>
  /**
   * Collections the server keeps as subscriptions to external ICS feeds. They
   * are not calendars (no events live on the server), so they are reported
   * separately and imported as webcal subscriptions. CalDAV only.
   */
  fetchSubscribedCollections?(): Promise<ServerSubscription[]>
  fetchEvents(
    calendarUrl: string,
    start: string,
    end: string,
    includeAllEvents?: boolean
  ): Promise<FetchEventsResult>
  fetchResourceByHref(href: string): Promise<{ url: string; data: string; etag?: string } | null>
  createEvent(
    calendarUrl: string,
    iCalString: string,
    filename: string
  ): Promise<{ url: string; etag: string }>
  fetchEtag(eventUrl: string): Promise<string>
  updateEvent(
    calendarUrl: string,
    eventUrl: string,
    iCalString: string,
    etag: string
  ): Promise<{ url: string; etag: string }>
  deleteEvent(eventUrl: string, etag: string): Promise<void>
  createCalendar(options: CreateCalendarOptions): Promise<CalDAVCalendar>
  updateCalendar(calendarUrl: string, options: UpdateCalendarOptions): Promise<void>
  deleteCalendar(calendarUrl: string): Promise<void>
  syncCollection(collectionUrl: string, syncToken: string | null): Promise<SyncCollectionResult>

  discoverSettingsCalendar(calendarHomeUrl: string): Promise<{ url: string } | null>
  createSettingsCalendar(calendarHomeUrl: string): Promise<string>
  fetchSettingsEvent(
    settingsCalendarUrl: string
  ): Promise<{ data: string; etag: string; href: string; dtstamp: string } | null>
  extractSettingsFromVEVENT(icalData: string): string | null
  putSettingsEvent(
    settingsCalendarUrl: string,
    base64Payload: string,
    etag?: string,
    existingEvent?: { href: string; etag: string } | null
  ): Promise<string>
  deleteSettingsEvent(settingsCalendarUrl: string): Promise<void>
  deleteSettingsCalendar(settingsCalendarUrl: string): Promise<void>

  /**
   * RFC 6638 §2.4.1 — the signed-in user's calendar user address and name,
   * read from their principal. Null when the server could not be asked, so a
   * caller can ask again later. Optional: JMAP has no principal.
   */
  fetchCalendarUser?(): Promise<CalendarUser | null>
  /**
   * Owners of the calendars others share with the user (DAV:owner → their
   * principal's address). Throws when the listing fails. Optional: the JMAP
   * backend lists the calendars of the user's own account only, so it has no
   * shared calendar to name an owner for.
   */
  fetchCalendarOwners?(): Promise<CalendarOwner[]>
  supportsScheduling(url?: string): Promise<boolean>
  queryFreeBusy(calendarUrl: string, start: Date, end: Date): Promise<FreeBusyPeriod[] | null>
  queryAttendeeFreeBusy(
    outboxUrl: string,
    organizerEmail: string,
    attendeeEmails: string[],
    start: Date,
    end: Date
  ): Promise<Map<string, FreeBusyPeriod[] | null> | null>
}
