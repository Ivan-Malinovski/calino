import type {
  CalDAVCalendar,
  CalendarProtocol,
  CreateCalendarOptions,
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
  connect(): Promise<void>
  getServerUrl(): string
  getProxyUrl(): string | null

  fetchCalendars(): Promise<CalDAVCalendar[]>
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
