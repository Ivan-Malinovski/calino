/**
 * IndexedDB-backed storage for the original iCalendar text of CalDAV resources.
 *
 * Calino models only the properties it understands, so re-serializing an event
 * from the store drops everything else the server sent (GEO, CLASS, PRIORITY,
 * RDATE, RELATED-TO, X-* properties, alarm and attendee details). Keeping the
 * bytes we last read from — or wrote to — the server lets a save patch that
 * original instead of rebuilding it, preserving the parts we don't model.
 *
 * The raw text is whole `.ics` documents, far past localStorage's ~5-10MB quota,
 * hence IndexedDB. This is a database of its own rather than a new version of
 * `calino-attachments`: bumping that one's version would force an upgrade
 * transaction on every existing user for an unrelated feature.
 */

import Dexie, { type EntityTable } from 'dexie'

interface RawIcsRecord {
  /**
   * The resource href, and the primary key: a raw blob belongs to one CalDAV
   * *resource*, so a recurrence master and its RECURRENCE-ID overrides — which
   * live in a single resource — share one record.
   */
  href: string
  calendarId: string
  ics: string
  etag?: string
  /**
   * Written on every put and never on read, so "not touched in N days" is the
   * signal that a resource is gone from the server and the blob is an orphan.
   */
  updatedAt: number
}

/**
 * How long an untouched blob survives the age sweep. Generous on purpose: the
 * cost of keeping one is a few KB, the cost of dropping one that's still live
 * is a save that silently loses the properties we don't model.
 */
export const RAW_ICS_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000

class RawIcsDatabase extends Dexie {
  rawIcs!: EntityTable<RawIcsRecord, 'href'>

  constructor() {
    super('calino-raw-ics')
    this.version(1).stores({
      rawIcs: 'href, calendarId, updatedAt',
    })
  }
}

const db = new RawIcsDatabase()

/**
 * Store the raw iCalendar text of a resource. Overwrites any existing blob.
 */
export async function putRawIcs(
  href: string,
  calendarId: string,
  ics: string,
  etag?: string
): Promise<void> {
  await db.rawIcs.put({ href, calendarId, ics, etag, updatedAt: Date.now() })
}

/**
 * Retrieve the raw iCalendar text for a resource, or undefined if we have none.
 *
 * The etag comes back with it so a caller can tell that the server has moved on
 * since we captured this original and decline to patch a stale one.
 */
export async function getRawIcs(
  href: string
): Promise<{ ics: string; etag?: string } | undefined> {
  const record = await db.rawIcs.get(href)
  if (!record) return undefined
  return { ics: record.ics, etag: record.etag }
}

/**
 * Delete the raw iCalendar text for a resource.
 */
export async function deleteRawIcs(href: string): Promise<void> {
  await db.rawIcs.delete(href)
}

/**
 * Delete every raw blob belonging to a calendar, for when the calendar itself
 * goes away.
 */
export async function deleteRawIcsForCalendar(calendarId: string): Promise<void> {
  await db.rawIcs.where('calendarId').equals(calendarId).delete()
}

/**
 * Drop blobs no write has touched for `maxAgeMs`.
 *
 * This is the only garbage collection for resources that vanished server-side
 * without the app seeing the delete. A per-sync set difference would be wrong:
 * `fullSync` only fetches a time window, so a resource outside it is absent
 * without being gone, and diffing would quietly discard the originals of every
 * past and future event.
 */
export async function pruneRawIcs(maxAgeMs: number = RAW_ICS_MAX_AGE_MS): Promise<void> {
  await db.rawIcs
    .where('updatedAt')
    .below(Date.now() - maxAgeMs)
    .delete()
}
