/**
 * Loose JSCalendar / JMAP typings. JMAP Calendars is still an Internet-Draft
 * and servers differ (Stalwart already speaks the post-RFC 8984 vocabulary:
 * singular `recurrenceRule`, `calendarAddress`, `organizerCalendarAddress`).
 * Converters must accept both vocabularies, so these stay deliberately loose.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

/** A JSCalendar Event/Task object as returned by `CalendarEvent/get`. */
export type JSCalendarObject = JsonObject

/** A JMAP PatchObject: slash-separated property paths to new values (null deletes). */
export type JmapPatch = { [path: string]: JsonValue }

export const JMAP_CORE = 'urn:ietf:params:jmap:core'
export const JMAP_CALENDARS = 'urn:ietf:params:jmap:calendars'
export const JMAP_CALENDARS_PARSE = 'urn:ietf:params:jmap:calendars:parse'
export const JMAP_CONTACTS = 'urn:ietf:params:jmap:contacts'
export const JMAP_PRINCIPALS = 'urn:ietf:params:jmap:principals'
export const JMAP_PRINCIPALS_AVAILABILITY = 'urn:ietf:params:jmap:principals:availability'
export const JMAP_WEBSOCKET = 'urn:ietf:params:jmap:websocket'
