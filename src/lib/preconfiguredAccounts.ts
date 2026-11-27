/**
 * Bookkeeping for accounts that came from calino.config.json.
 *
 * The config can change between page loads (it is read at runtime from the
 * server), so the auto-connect has to know which stored account came from which
 * config entry: an entry that was removed drops its account, an entry whose
 * password or calendar selection changed updates its account in place. The
 * registry lives in localStorage next to the accounts themselves, keyed by
 * account id.
 *
 * It also holds each account's calendar selection, which the sync paths read
 * synchronously — a sync can start before the master password is entered.
 */

import { sha256 } from '@noble/hashes/sha2.js'

export interface CalendarSelectionEntry {
  /** Collection URL as discovered by the config generator. */
  url: string
  /** Display name at generation time; a fallback when the URL moved. */
  name: string
}

export interface PreconfiguredRegistryEntry {
  /** The URL as written in the config (before discovery rewrote it). */
  configUrl: string
  username: string
  /** SHA-256 of the name, password and headers, to notice changes. */
  secretHash: string
  /** Calendars to sync; absent means all of them. */
  calendars?: CalendarSelectionEntry[]
}

export type PreconfiguredRegistry = Record<string, PreconfiguredRegistryEntry>

const REGISTRY_KEY = 'calino.preconfigured.accounts'

export function readPreconfiguredRegistry(): PreconfiguredRegistry {
  try {
    const raw = localStorage.getItem(REGISTRY_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as PreconfiguredRegistry)
      : {}
  } catch {
    return {}
  }
}

export function writePreconfiguredRegistry(registry: PreconfiguredRegistry): void {
  try {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(registry))
  } catch {
    // localStorage unavailable
  }
}

export async function preconfiguredSecretHash(parts: {
  name: string
  password: string
  customHeaders?: Record<string, string>
}): Promise<string> {
  const headers = Object.entries(parts.customHeaders ?? {}).sort(([a], [b]) => a.localeCompare(b))
  const data = new TextEncoder().encode(JSON.stringify([parts.name, parts.password, headers]))
  // Not crypto.subtle: browsers hide it on plain-HTTP origins such as a
  // self-hosted instance opened by LAN address.
  return Array.from(sha256(data), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Same selection, ignoring order. Absent and absent are equal. */
export function sameCalendarSelection(
  a: CalendarSelectionEntry[] | undefined,
  b: CalendarSelectionEntry[] | undefined
): boolean {
  const key = (list: CalendarSelectionEntry[] | undefined): string =>
    list ? JSON.stringify(list.map((c) => calendarPath(c.url)).sort()) : ''
  return key(a) === key(b)
}

/**
 * A collection URL reduced to its decoded path without a trailing slash, so an
 * absolute URL from the generator and a server-relative one from discovery
 * compare equal.
 */
export function calendarPath(url: string): string {
  let path: string
  try {
    path = new URL(url, 'http://placeholder.invalid').pathname
  } catch {
    path = url
  }
  try {
    path = decodeURIComponent(path)
  } catch {
    // keep the raw path
  }
  return path.replace(/\/+$/, '')
}

function urlOrigin(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/**
 * Whether a stored account is the login a config entry describes: the same
 * username on the same server. The stored URL is the one discovery resolved
 * to, without a trailing slash, so it rarely equals the URL in the config
 * character for character.
 */
export function isSameLogin(
  account: { serverUrl: string; username: string },
  configUrl: string,
  username: string
): boolean {
  const origin = urlOrigin(account.serverUrl)
  return account.username === username && origin !== null && origin === urlOrigin(configUrl)
}

/** Whether two URLs point at the same path, ignoring trailing slashes. */
export function isSameUrlPath(a: string, b: string): boolean {
  return urlOrigin(a) === urlOrigin(b) && calendarPath(a) === calendarPath(b)
}

/**
 * The stored copies of a configured login to drop, given the one being kept.
 * A copy still holding changes that never reached the server stays, so
 * nothing unsynced is lost.
 */
export function removableDuplicates(
  copies: Array<{ id: string }>,
  keptId: string | undefined,
  calendarIdsOf: (accountId: string) => string[],
  events: Array<{ calendarId: string; syncStatus?: string }>
): string[] {
  return copies
    .filter((copy) => copy.id !== keptId)
    .filter((copy) => {
      const calendarIds = new Set(calendarIdsOf(copy.id))
      return !events.some(
        (e) =>
          calendarIds.has(e.calendarId) && e.syncStatus !== undefined && e.syncStatus !== 'synced'
      )
    })
    .map((copy) => copy.id)
}

function isSettingsCalendar(cal: { name: string; url?: string }): boolean {
  return cal.name === 'Calino Settings' || Boolean(cal.url?.includes('calino-settings'))
}

/**
 * Whether a stored calendar still holds events that were never uploaded.
 * Used before dropping a calendar that only fell out of a config selection:
 * unlike a collection deleted on the server, its unsynced events exist only
 * here, and deleting the calendar would destroy them.
 */
export function calendarHasUnsyncedEvents(
  events: Array<{ calendarId: string; syncStatus?: string }>,
  calendarId: string
): boolean {
  return events.some(
    (event) =>
      event.calendarId === calendarId && event.syncStatus !== undefined && event.syncStatus !== 'synced'
  )
}

/**
 * A collection created in Calino on a selection-restricted preconfigured
 * account must join its selection, or the next sync treats it as deselected
 * and drops the local copy of a collection that lives on the server.
 * Returns true when a restricted selection was extended.
 */
export function extendCalendarSelection(
  accountId: string,
  entry: CalendarSelectionEntry
): boolean {
  const registry = readPreconfiguredRegistry()
  const tracked = registry[accountId]
  if (!tracked?.calendars) return false
  if (tracked.calendars.some((c) => c.url === entry.url)) return false
  tracked.calendars = [...tracked.calendars, entry]
  writePreconfiguredRegistry(registry)
  return true
}

/**
 * The server calendars an account should keep, given its selection. Without a
 * selection every calendar is kept. The hidden Calino Settings calendar is
 * always kept, since settings sync depends on it.
 *
 * `selection` defaults to the one recorded for `accountId` in the registry.
 */
export function filterSelectedCalendars<T extends { name: string; url: string }>(
  calendars: T[],
  accountId: string | undefined,
  selection: CalendarSelectionEntry[] | undefined = accountId
    ? readPreconfiguredRegistry()[accountId]?.calendars
    : undefined
): T[] {
  if (!selection) return calendars

  const wantedPaths = new Set(selection.map((c) => calendarPath(c.url)))
  const matchedPaths = new Set(
    calendars.map((c) => calendarPath(c.url)).filter((p) => wantedPaths.has(p))
  )
  // A selected calendar whose URL is no longer listed (e.g. the server moved
  // it) is matched by its name instead.
  const fallbackNames = new Set(
    selection.filter((c) => !matchedPaths.has(calendarPath(c.url))).map((c) => c.name)
  )

  return calendars.filter(
    (cal) =>
      isSettingsCalendar(cal) ||
      wantedPaths.has(calendarPath(cal.url)) ||
      fallbackNames.has(cal.name)
  )
}
