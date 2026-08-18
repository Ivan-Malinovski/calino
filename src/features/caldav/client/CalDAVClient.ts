import { createDAVClient } from 'tsdav'
import type {
  CalDAVCredentials,
  CalDAVCalendar,
  CreateCalendarOptions,
  UpdateCalendarOptions,
} from '../types'
import { basicAuthHeader } from './basicAuth'
import { v4 as uuidv4 } from 'uuid'
import { decodeBase64 } from '@/lib/settingsSync'
import { webFetch } from '@/lib/webFetch'

import { DEFAULT_CALENDAR_COLOR } from '@/config'
import { useSettingsStore } from '@/store/settingsStore'
import { eventToICAL, foldICalLines } from '@/features/caldav/adapter/iCalendarAdapter'
import type { CalendarEvent } from '@/types'
import type { FreeBusyPeriod } from '@/lib/freeBusyCalculator'
import {
  buildFreeBusyQueryXml,
  buildFreeBusyRequestIcs,
  parseScheduleResponse,
  parseVFreeBusy,
} from './freeBusy'

const NETWORK_TIMEOUT_MS = 15_000

// ---------------------------------------------------------------------------
// sync-collection REPORT (RFC 6578) types
// ---------------------------------------------------------------------------

/**
 * One entry from a sync-collection REPORT response. `href` is always
 * resolved to an absolute URL (relative/percent-encoded server hrefs are
 * normalized via `resolveDavHref`). `changed` covers both newly-added and
 * modified resources — sync-collection alone cannot distinguish the two;
 * the caller determines that by checking whether the href is already known.
 */
export interface SyncCollectionChange {
  href: string
  etag: string | null
  status: 'changed' | 'removed'
}

export interface SyncCollectionResult {
  changes: SyncCollectionChange[]
  newSyncToken: string | null
  /** True when the server rejected the token (400/507) or the request otherwise
   * failed — the caller must fall back to a full sync and discard the old token. */
  tokenInvalidated: boolean
}

// Upper bound for an honored Retry-After (seconds). Anything larger — or
// unparseable — is treated as absent, so a misbehaving server can't stall the
// pending-change queue for hours on a single 429.
const MAX_HONORED_RETRY_AFTER_SECONDS = 3600

/**
 * Parse an HTTP `Retry-After` header value into whole seconds, clamped to
 * [0, MAX_HONORED_RETRY_AFTER_SECONDS]. Supports both RFC 9110 forms:
 * integer delay-seconds and an HTTP-date. Returns undefined for missing,
 * empty, or unparseable values (the caller then falls back to the pure
 * exponential backoff).
 */
function parseRetryAfterSeconds(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  let seconds: number
  if (/^\d+$/.test(trimmed)) {
    seconds = Number(trimmed)
  } else {
    const when = Date.parse(trimmed)
    if (Number.isNaN(when)) return undefined
    seconds = Math.max(0, Math.ceil((when - Date.now()) / 1000))
  }
  if (!Number.isFinite(seconds) || seconds < 0) return undefined
  return Math.min(seconds, MAX_HONORED_RETRY_AFTER_SECONDS)
}

/**
 * Interpret a DAV:current-user-privilege-set as parsed by tsdav/xml-js
 * (roughly `{ privilege: { read: {}, write: {}, ... } }`). Returns null when
 * the server did not answer the property — distinct from "answered with no
 * write grant", which is a genuine read-only calendar (RFC 3744 §5.1: a
 * writable collection grants `write`; `all` or `unlocked` imply it).
 */
/**
 * Resolve a server-returned DAV href against a base URL. Hrefs are usually
 * paths (`/ivan/calendars/`); some servers return absolute URLs. Unresolvable
 * input is returned unchanged rather than throwing.
 */
export function resolveDavHref(baseUrl: string, href: string): string {
  try {
    return new URL(href, baseUrl).href
  } catch {
    return href
  }
}

/**
 * tsdav's DAVCalendar type does not declare `projectedProps`, which is where it
 * stashes the values of any extra props passed via `customProps`/`props`.
 */
function projectedProps(cal: object): Record<string, unknown> | undefined {
  const projected = (cal as { projectedProps?: unknown }).projectedProps
  if (projected == null || typeof projected !== 'object') return undefined
  return projected as Record<string, unknown>
}

/**
 * Collect every element name appearing anywhere under a parsed privilege tree.
 *
 * Three shapes have to survive this, and only the first is obvious:
 *
 *  - RFC 3744 defines `current-user-privilege-set` as a *sequence* of
 *    `<privilege>` elements, and xml-js (compact mode, `alwaysArray: false`)
 *    turns repeated siblings into an ARRAY. Reading `Object.keys()` off that
 *    array yields "0", "1", "2" — no privilege name in sight, which reads as
 *    "granted something, but not write" and marks every calendar read-only.
 *  - `<write>` is an aggregate of `<write-content>`/`<write-properties>`
 *    (§3.2), and `<all>` aggregates everything, so the privilege that matters
 *    may be nested rather than top-level.
 *  - XML prefixes are arbitrary: sabre sends `<d:write/>`, Radicale sends
 *    `<write/>`. Compare on the local name.
 *
 * Keys beginning with `_` are xml-js metadata (`_attributes`, `_text`), not
 * elements.
 */
function collectPrivilegeNames(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectPrivilegeNames(item, into)
    return
  }
  if (node == null || typeof node !== 'object') return
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('_')) continue
    into.add(key.slice(key.indexOf(':') + 1).toLowerCase())
    collectPrivilegeNames(value, into)
  }
}

function parsePrivileges(raw: unknown): { canWrite: boolean } | null {
  if (raw == null || typeof raw !== 'object') return null
  const privilege = (raw as { privilege?: unknown }).privilege
  if (privilege == null || typeof privilege !== 'object') return null
  const granted = new Set<string>()
  collectPrivilegeNames(privilege, granted)
  if (granted.size === 0) return null
  const canWrite =
    granted.has('write') ||
    granted.has('all') ||
    granted.has('unlocked') ||
    granted.has('write-content') ||
    granted.has('write-properties') ||
    // A calendar you may add resources to is writable even if the server
    // spells that as bind/unbind rather than as a write aggregate.
    granted.has('bind')
  return { canWrite }
}

function escapeXml(str: string): string {
  return (
    str
      // Remove XML-illegal control characters (except tab, newline, carriage return)
      .split('')
      .filter((c) => {
        const code = c.charCodeAt(0)
        return code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d
      })
      .join('')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  )
}

/**
 * Normalize a color string from a CalDAV server into a valid 6-digit hex color.
 * Handles: alpha-suffixed hex (#RRGGBBAA), shorthand (#RGB), case variations.
 * Returns DEFAULT_CALENDAR_COLOR for null/undefined/invalid input.
 */
export function normalizeColor(color: string | null | undefined): string {
  if (!color || typeof color !== 'string') return DEFAULT_CALENDAR_COLOR
  let c = color.trim()
  // Strip alpha channel (e.g. #FF5722FF → #FF5722)
  if (/^#[0-9A-Fa-f]{8}$/.test(c)) {
    c = c.slice(0, 7)
  }
  // Full hex
  if (/^#[0-9A-Fa-f]{6}$/.test(c)) return c.toUpperCase()
  // Shorthand hex (#F52 → #FF5522)
  if (/^#[0-9A-Fa-f]{3}$/.test(c)) {
    return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`.toUpperCase()
  }
  return DEFAULT_CALENDAR_COLOR
}

export function buildProxyUrl(proxyBase: string, targetUrl: string): string {
  // The proxy expects the server origin encoded as the first path segment,
  // with the rest of the path as unencoded segments.
  // e.g. proxy.calino.io/https%3A%2F%2Fdav.example.com/principals/user
  const parsed = new URL(targetUrl)
  const encodedOrigin = encodeURIComponent(parsed.origin)
  const path = parsed.pathname + parsed.search + parsed.hash
  const proxyBaseClean = proxyBase.replace(/\/$/, '')
  return `${proxyBaseClean}/${encodedOrigin}${path}`
}

export function prefixUrlWithProxy(url: string, proxyBase: string): string {
  if (!proxyBase) {
    return url
  }

  // Already pointing at the proxy — prefixing again yields
  // `proxy/https%3A%2F%2Fproxy/https%3A%2F%2Fdav…`, which resolves to nothing.
  // Versions up to 0.27.1 persisted proxied URLs as `resourceHref` (see
  // createEvent), so those rows are still in users' stores: this keeps them
  // working until the next sync rewrites the href from the server listing.
  if (url.replace(/\/$/, '').startsWith(proxyBase.replace(/\/$/, '') + '/')) {
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
    return fetchWithTimeout(proxiedUrl, init)
  }
}

// Takes the full `fetch` input type, not just `string | URL`: tsdav types its
// `fetch` option as `typeof fetch`, so a narrower parameter is not assignable.
async function fetchWithTimeout(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS)
  try {
    return await webFetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export class CalDAVClient {
  private client: Awaited<ReturnType<typeof createDAVClient>> | null = null
  // Cache of raw DAV calendar objects from tsdav, keyed by URL matching.
  // Populated on the first fetchCalendars() call and reused by findCalendarByUrl().
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private cachedCalendars: any[] = []
  private serverUrl: string
  private proxyUrl: string | null
  private credentials: CalDAVCredentials
  // Cached base64 auth header — avoids re-encoding on every request
  private authHeader: string
  // Cached calendar home URL — avoids re-discovery on every createCalendar
  private cachedCalendarHomeUrl: string | null = null
  // Proxy-aware fetch function (applied to all direct fetch calls)
  private proxyFetch: (url: string | URL, init?: RequestInit) => Promise<Response>

  constructor(serverUrl: string, credentials: CalDAVCredentials, proxyUrl: string | null = null) {
    this.serverUrl = serverUrl
    this.proxyUrl = proxyUrl
    this.credentials = credentials
    // UTF-8-safe Basic auth (btoa alone mangles non-ASCII credentials).
    this.authHeader = basicAuthHeader(credentials.username, credentials.password)
    this.proxyFetch = proxyUrl ? createProxyFetch(proxyUrl) : fetchWithTimeout
  }

  async connect(): Promise<void> {
    this.client = await createDAVClient({
      serverUrl: this.serverUrl,
      credentials: {
        username: this.credentials.username,
        password: this.credentials.password,
      },
      // tsdav's own Basic auth encodes Latin-1 codepoints and throws on
      // anything above U+00FF — hand it the same UTF-8 header we use for
      // direct requests so every tsdav call authenticates identically.
      authMethod: 'Custom',
      authFunction: async () => ({ Authorization: this.authHeader }),
      defaultAccountType: 'caldav',
      fetch: this.proxyUrl ? createProxyFetch(this.proxyUrl) : fetchWithTimeout,
    })
  }

  private getClient() {
    if (!this.client) {
      throw new Error('Client not connected. Call connect() first.')
    }
    return this.client
  }

  async fetchCalendars(): Promise<CalDAVCalendar[]> {
    if (!navigator.onLine) {
      throw new Error('No network connection. Please check your internet connection.')
    }
    const client = this.getClient()
    // tsdav's defaults are replaced wholesale when `props` is passed, so spell
    // them out and add the Phase 4 extras: current-user-privilege-set (readOnly),
    // cs:subscribed and cs:calendar-order. `projectedProps` carries the raw
    // parsed extras onto the returned calendar objects.
    const davCalendars = await client.fetchCalendars({
      props: {
        'c:calendar-description': {},
        'c:calendar-timezone': {},
        'd:displayname': {},
        'ca:calendar-color': {},
        'cs:getctag': {},
        'd:resourcetype': {},
        'c:supported-calendar-component-set': {},
        'd:sync-token': {},
        'd:current-user-privilege-set': {},
        'cs:subscribed': {},
        'cs:calendar-order': {},
      },
      projectedProps: {
        currentUserPrivilegeSet: true,
        subscribed: true,
        calendarOrder: true,
      },
    })

    this.cachedCalendars = davCalendars

    return davCalendars
      .filter((cal) => {
        // A schedule inbox/outbox is a CalDAV collection but never a calendar
        // the user reads or writes events from.
        const resourceTypes: string[] = cal.resourcetype ?? []
        return !resourceTypes.some(
          (rt) =>
            rt === 'inbox' ||
            rt === 'schedule-inbox' ||
            rt === 'outbox' ||
            rt === 'schedule-outbox'
        )
      })
      .map((cal, index) => {
        const supportedComponents = cal.components?.filter(
          (component): component is 'VEVENT' | 'VTODO' | 'VJOURNAL' =>
            component === 'VEVENT' || component === 'VTODO' || component === 'VJOURNAL'
        )

        const projected = projectedProps(cal)
        const privileges = parsePrivileges(projected?.currentUserPrivilegeSet)
        const isSubscribed = Boolean(projected?.subscribed)
        // No privilege info at all (server didn't answer the prop) → assume
        // writable; undefined must not read as read-only. A subscription is
        // read-only regardless of what the privileges claim.
        const readOnly = isSubscribed || (privileges !== null && !privileges.canWrite)
        const calendarOrderRaw = projected?.calendarOrder
        const calendarOrder = Number(calendarOrderRaw)

        return {
          id: cal.url || `cal-${index}-${uuidv4()}`,
          // Note: accountId is NOT set here - the caller must set it
          // this.credentials.id is the credential ID, not the account ID
          url: cal.url || '',
          name: typeof cal.displayName === 'string' ? cal.displayName : 'Unnamed Calendar',
          color: normalizeColor(cal.calendarColor as string | null | undefined),
          // tsdav already parsed cs:getctag / d:sync-token from the same
          // PROPFIND — capture them instead of discarding.
          ctag: (cal.ctag as string | null | undefined) ?? null,
          syncToken: (cal.syncToken as string | null | undefined) ?? null,
          isVisible: true,
          isDefault: index === 0,
          supportedComponents: cal.components ? supportedComponents : undefined,
          readOnly,
          isSubscribed: isSubscribed || undefined,
          calendarOrder: Number.isFinite(calendarOrder) ? calendarOrder : undefined,
        }
      })
  }

  /**
   * Find a raw DAV calendar object by URL, using the cache when available.
   * Falls back to a network fetch if the cache is empty (e.g. after connect()
   * but before the first explicit fetchCalendars() call).
   */
  private async findCalendarByUrl(calendarUrl: string) {
    // Lazily populate cache on first use after connect()
    if (this.cachedCalendars.length === 0) {
      const client = this.getClient()
      this.cachedCalendars = await client.fetchCalendars()
    }

    const calendar = this.cachedCalendars.find((c) => {
      if (c.url === calendarUrl) return true
      // Legacy: stored URL may be proxy-prefixed (e.g. proxy/cal-encoded), decode it
      try {
        const decoded = decodeURIComponent(calendarUrl)
        if (decoded === c.url) return true
      } catch {
        /* ignore decode errors */
      }
      return false
    })

    if (!calendar) {
      throw new Error(`Calendar not found: ${calendarUrl}`)
    }

    return calendar
  }

  async fetchEvents(
    calendarUrl: string,
    start: string,
    end: string,
    includeAllEvents = false
  ): Promise<{ url: string; data: string; etag?: string }[]> {
    if (!navigator.onLine) {
      throw new Error('No network connection. Please check your internet connection.')
    }
    const client = this.getClient()
    const calendar = await this.findCalendarByUrl(calendarUrl)

    // A regular sync needs the complete VEVENT listing so an absent resource
    // can be identified as a remote deletion. Initial imports may stay bounded.
    const eventObjects = await client.fetchCalendarObjects({
      calendar,
      ...(includeAllEvents
        ? {
            filters: {
              'comp-filter': {
                _attributes: { name: 'VCALENDAR' },
                'comp-filter': { _attributes: { name: 'VEVENT' } },
              },
            },
          }
        : {
            timeRange: { start, end },
          }),
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

    // Fetch VJOURNALs with custom filter
    const journalObjects = await client.fetchCalendarObjects({
      calendar,
      filters: {
        'comp-filter': {
          _attributes: {
            name: 'VCALENDAR',
          },
          'comp-filter': {
            _attributes: {
              name: 'VJOURNAL',
            },
          },
        },
      },
    })

    const allItems = [...eventObjects, ...todoObjects, ...journalObjects]

    // Remove duplicates by URL - store raw server URLs consistently
    const uniqueByUrl = new Map<string, { url: string; data: string; etag?: string }>()
    for (const obj of allItems) {
      if (!uniqueByUrl.has(obj.url)) {
        uniqueByUrl.set(obj.url, {
          url: obj.url,
          data: obj.data as string,
          etag: obj.etag,
        })
      }
    }

    return Array.from(uniqueByUrl.values())
  }

  /**
   * GET a single calendar object resource by its href.
   *
   * `fetchEvents` is time-windowed and comp-filtered; a `sync-collection`
   * REPORT can name a resource that no such query would return — an event far
   * outside the window, or one whose metadata changed without DTSTART moving.
   * Incremental reconciliation therefore fetches changed resources directly.
   *
   * Returns `null` for 404/410: the resource vanished between the REPORT and
   * this GET, which is a tombstone the next sync will report properly, not an
   * error worth failing the whole calendar over. Any other non-OK status
   * throws, so the caller leaves the sync token where it is and retries.
   *
   * The returned `etag` is best-effort: Radicale sends no
   * `access-control-expose-headers`, so a browser cannot read `ETag` off this
   * response. Callers that already hold the etag from the REPORT should prefer
   * theirs.
   */
  async fetchResourceByHref(
    href: string
  ): Promise<{ url: string; data: string; etag?: string } | null> {
    if (!navigator.onLine) {
      throw new Error('No network connection. Please check your internet connection.')
    }

    const response = await this.proxyFetch(href, {
      method: 'GET',
      headers: {
        Authorization: this.authHeader,
        Accept: 'text/calendar',
      },
    })

    if (response.status === 404 || response.status === 410) return null
    if (!response.ok) {
      throw new Error(`Failed to fetch resource ${href}: ${response.status}`)
    }

    const data = await response.text()
    return { url: href, data, etag: response.headers.get('etag') ?? undefined }
  }

  async createEvent(
    calendarUrl: string,
    iCalString: string,
    filename: string
  ): Promise<{ url: string; etag: string }> {
    if (!navigator.onLine) {
      throw new Error('No network connection. Please check your internet connection.')
    }
    const client = this.getClient()
    const calendar = await this.findCalendarByUrl(calendarUrl)

    // The resource URL as tsdav computes it — NOT `result.url`. Behind a CORS
    // proxy the response's URL is the proxied one, and persisting that as the
    // event's `resourceHref` means the next request proxies an already-proxied
    // URL (`proxy/https%3A%2F%2Fproxy/https%3A%2F%2Fdav…`). DELETE has no
    // collection guard to fall back on, so it hit that dead URL and servers
    // that see an If-Match on a resource they don't have answer 412 — issue
    // #110, "Failed to sync deletion. It will be retried."
    const eventUrl = new URL(filename, calendar.url).href

    const result = await client.createCalendarObject({
      calendar,
      filename,
      iCalString,
    })
    await this.assertResponseOk(result, 'PUT', calendarUrl)

    // Extract ETag from response headers
    let etag = result.headers?.get('etag') || ''

    // Some servers (Google, iCloud) omit the ETag header on PUT — and in the
    // browser a server that doesn't send `Access-Control-Expose-Headers: ETag`
    // is indistinguishable from one that omits it, so this is the common path
    // on the web, not an edge case. Persisting an empty etag with syncStatus
    // 'synced' means the next update sends an empty If-Match — the stale-etag
    // conflict we want to avoid. Recover it with a follow-up PROPFIND. Never
    // throw: a missing etag must not fail creation.
    if (!etag) {
      etag = await this.fetchEtag(eventUrl)
    }

    return {
      url: eventUrl,
      etag,
    }
  }

  /**
   * Fetch the current ETag for a single calendar object via PROPFIND (Depth 0).
   * Returns '' on any failure — callers treat a missing etag as non-fatal.
   *
   * Public so the pending-change replay can recover from a stale-etag 412:
   * it re-fetches the current etag and re-applies the write against it
   * instead of replaying the dead If-Match forever.
   */
  async fetchEtag(eventUrl: string): Promise<string> {
    try {
      const response = await this.proxyFetch(eventUrl, {
        method: 'PROPFIND',
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          Authorization: this.authHeader,
          Depth: '0',
        },
        body: `<?xml version="1.0" encoding="UTF-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:getetag/>
  </d:prop>
</d:propfind>`,
      })

      if (!response.ok && response.status !== 207) {
        return ''
      }

      const text = await response.text()
      // Parsed, not regex-scraped: an etag is a quoted string, and sabre
      // (Baikal, Nextcloud) XML-escapes those quotes —
      // `<d:getetag>&quot;abc&quot;</d:getetag>`. Scraping the raw text handed
      // back the literal `&quot;abc&quot;`, which then went out as an If-Match
      // that could never match, so every write after a create 412'd (issue
      // #110). Radicale writes the quotes literally, which is why it looked
      // server-specific. `textContent` decodes entities for us.
      const doc = new DOMParser().parseFromString(text, 'application/xml')
      if (doc.getElementsByTagName('parsererror').length > 0) return ''
      return this.getDavElementText(doc, 'getetag')?.trim() || ''
    } catch {
      return ''
    }
  }

  async updateEvent(
    calendarUrl: string,
    eventUrl: string,
    iCalString: string,
    etag: string
  ): Promise<{ url: string; etag: string }> {
    if (!navigator.onLine) {
      throw new Error('No network connection. Please check your internet connection.')
    }
    const client = this.getClient()
    await this.findCalendarByUrl(calendarUrl)

    const result = await client.updateCalendarObject({
      calendarObject: { url: eventUrl, etag, data: iCalString },
    })
    await this.assertResponseOk(result, 'PUT', eventUrl)

    // Extract ETag from response headers; if the server omits it (Google,
    // iCloud), re-fetch it with a PROPFIND instead of keeping the stale
    // pre-update etag — the old one will 412 the next update. Mirrors the
    // createEvent fallback. Never throw: a missing etag must not fail the
    // update, and a fresh etag is preferred over the stale one but either is
    // accepted.
    let newEtag = result.headers?.get('etag') || ''
    if (!newEtag) {
      newEtag = await this.fetchEtag(eventUrl)
    }

    // `eventUrl`, not `result.url` — see the note in createEvent: the response
    // URL is proxy-prefixed behind a CORS proxy.
    return {
      url: eventUrl,
      etag: newEtag || etag,
    }
  }

  async deleteEvent(eventUrl: string, etag: string): Promise<void> {
    if (!navigator.onLine) {
      throw new Error('No network connection. Please check your internet connection.')
    }
    const client = this.getClient()

    const response = await client.deleteCalendarObject({
      calendarObject: { url: eventUrl, etag },
    })
    // 404/410 mean the resource is already gone — the outcome a delete wants.
    await this.assertResponseOk(response, 'DELETE', eventUrl, true)
  }

  /**
   * tsdav's createObject/updateObject/deleteObject return the raw fetch
   * `Response` without ever checking `res.ok` — a 5xx (or any non-2xx)
   * resolves silently and is indistinguishable from success. Central check:
   * throw a status-carrying error on non-2xx so callers can classify and retry
   * instead of believing a failed write landed. `tolerateGone` additionally
   * treats 404/410 as success — the outcome a DELETE wants.
   */
  private async assertResponseOk(
    response: Response | undefined | null,
    method: string,
    url: string,
    tolerateGone = false
  ): Promise<void> {
    if (!response) return
    // Only a real fetch Response carries `ok`/`status`; mock or unknown shapes
    // must not be misread as failures.
    if (response.ok === undefined && response.status === undefined) return
    if (response.ok) return
    if (tolerateGone && (response.status === 404 || response.status === 410)) return
    // Carry the response body on the error: some servers (iCloud, Google)
    // express a CalDAV precondition such as <C:no-uid-conflict/> through a
    // non-409 status (403), and callers need the body to tell a "duplicate
    // UID" from a plain permission denial — the two demand opposite recovery
    // (delete-source-and-retry vs. abort and leave the source untouched).
    const body = await response.text().catch(() => '')
    const error = new Error(
      `${method} ${url} failed: HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`
    ) as Error & { status: number; body?: string; retryAfter?: number }
    error.status = response.status
    if (body) error.body = body
    // A rate-limited response (429) may carry Retry-After — the server's own
    // minimum wait before the next attempt, in seconds (integer or HTTP-date).
    // Attach it (clamped) so the pending-change backoff can honor it. Missing
    // or invalid values degrade to the exponential schedule. The optional
    // chaining keeps mock Responses without headers from throwing here.
    const retryAfter = parseRetryAfterSeconds(response.headers?.get?.('retry-after'))
    if (retryAfter !== undefined) error.retryAfter = retryAfter
    throw error
  }

  async createCalendar(options: CreateCalendarOptions): Promise<CalDAVCalendar> {
    if (!navigator.onLine) {
      throw new Error('No network connection. Please check your internet connection.')
    }

    // Build the MKCALENDAR XML body
    const components = options.components || ['VEVENT', 'VTODO']
    const componentXml = components.map((comp) => `<C:comp name="${comp}"/>`).join('\n          ')

    let colorXml = ''
    if (options.color) {
      colorXml = `
        <ICAL:calendar-color xmlns:ICAL="http://apple.com/ns/ical/">${escapeXml(options.color)}</ICAL:calendar-color>`
    }

    let descriptionXml = ''
    if (options.description) {
      descriptionXml = `
        <C:calendar-description>${escapeXml(options.description)}</C:calendar-description>`
    }

    const xmlBody = `<?xml version="1.0" encoding="UTF-8" ?>
<D:mkcol xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set>
    <D:prop>
      <D:resourcetype>
        <D:collection/>
        <C:calendar/>
      </D:resourcetype>
      <D:displayname>${escapeXml(options.name)}</D:displayname>${descriptionXml}${colorXml}
      <C:supported-calendar-component-set>
          ${componentXml}
      </C:supported-calendar-component-set>
    </D:prop>
  </D:set>
</D:mkcol>`

    // Find the calendar home set by querying the principal
    const calendarHomeUrl = await this.findCalendarHome()

    // Create a new calendar collection under the calendar home
    const baseUri = options.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    // Append short random suffix to prevent URI collisions
    const randomSuffix = uuidv4().substring(0, 8)
    const calendarUri = `${baseUri}-${randomSuffix}`
    const calendarUrl = `${calendarHomeUrl}${calendarUri}/`

    const headers: Record<string, string> = {
      'Content-Type': 'application/xml; charset=utf-8',
      Authorization: this.authHeader,
    }

    const response = await this.proxyFetch(calendarUrl, {
      method: 'MKCOL',
      headers,
      body: xmlBody,
    })

    if (!response.ok && response.status !== 201 && response.status !== 204) {
      const errorText = await response.text()
      throw new Error(`Failed to create calendar: ${response.status} ${errorText}`)
    }

    // Return the created calendar (accountId is NOT set here - the caller provides it)
    return {
      id: calendarUrl,
      accountId: '', // Will be set by caller
      url: calendarUrl,
      name: options.name,
      color: options.color || '#4285F4',
      ctag: null,
      syncToken: null,
      isVisible: true,
      isDefault: false,
      supportedComponents: components,
    }
  }

  private async findCalendarHome(): Promise<string> {
    // Return cached result if available
    if (this.cachedCalendarHomeUrl) {
      return this.cachedCalendarHomeUrl
    }

    // Method 1 (cheap): Derive from existing calendar URLs — no extra network calls
    try {
      const homeUrl = await this.findCalendarHomeFromCalendars()
      if (homeUrl) {
        this.cachedCalendarHomeUrl = homeUrl
        return homeUrl
      }
    } catch {
      // Method 1 failed, try fallback
    }

    // Method 2 (expensive): Try to find calendar-home-set from principal
    try {
      const homeUrl = await this.findCalendarHomeFromPrincipal()
      if (homeUrl) {
        this.cachedCalendarHomeUrl = homeUrl
        return homeUrl
      }
    } catch {
      // Method 2 failed too
    }

    throw new Error(
      'Could not determine calendar home URL. Please check your CalDAV server configuration.'
    )
  }

  /**
   * Real principal discovery (RFC 5397 + RFC 4791 §6.2.1):
   *   1. PROPFIND the server root for DAV:current-user-principal
   *   2. PROPFIND that principal for CALDAV:calendar-home-set
   * Both answers are parsed namespace-aware (getElementsByTagNameNS), so a
   * Radicale-shaped response whose inner <href> is unprefixed parses exactly
   * like a prefixed one — the regex this replaces matched only
   * `<C:calendar-home-set><d:href>` and failed on precisely that server.
   * Hrefs are resolved against the base URL (they are usually relative), and
   * the principal URL needs no username interpolation, so odd usernames never
   * break discovery.
   */
  private async findCalendarHomeFromPrincipal(): Promise<string | null> {
    const baseUrl = this.serverUrl.replace(/\/$/, '')
    try {
      const principalHref = await this.propfindFirstHref(
        baseUrl,
        'DAV:',
        'current-user-principal'
      )
      if (!principalHref) return null
      const principalUrl = resolveDavHref(baseUrl, principalHref)

      const homeHref = await this.propfindFirstHref(
        principalUrl,
        'urn:ietf:params:xml:ns:caldav',
        'calendar-home-set'
      )
      if (!homeHref) return null
      return resolveDavHref(baseUrl, homeHref)
    } catch {
      return null
    }
  }

  /**
   * First descendant element in `ns` with `localName`, falling back to a
   * local-name-only match. The fallback is deliberate: real servers (notably
   * Radicale) emit child `<href>` elements with no namespace at all when no
   * default namespace is declared — strictly invalid, but common enough that
   * a namespace-only lookup misses the very servers this discovery targets.
   */
  private firstElementByLocalName(
    scope: Element | Document,
    ns: string,
    localName: string
  ): Element | undefined {
    const strict = scope.getElementsByTagNameNS(ns, localName)[0]
    if (strict) return strict
    return Array.from(scope.getElementsByTagName('*')).find((el) => el.localName === localName)
  }

  /**
   * PROPFIND Depth:0 asking for one property; returns the text of its first
   * descendant href (the shape both current-user-principal and
   * calendar-home-set use), or null when the server did not answer it.
   */
  private async propfindFirstHref(
    url: string,
    namespace: string,
    localName: 'current-user-principal' | 'calendar-home-set'
  ): Promise<string | null> {
    const prop =
      localName === 'calendar-home-set'
        ? '<C:calendar-home-set xmlns:C="urn:ietf:params:xml:ns:caldav"/>'
        : '<d:current-user-principal xmlns:d="DAV:"/>'
    const body = `<?xml version="1.0" encoding="UTF-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    ${prop}
  </d:prop>
</d:propfind>`

    const response = await this.proxyFetch(url, {
      method: 'PROPFIND',
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        Authorization: this.authHeader,
        Depth: '0',
      },
      body,
    })

    if (!response.ok && response.status !== 207) return null
    const doc = this.parseXmlDocument(await response.text())
    const propEl = this.firstElementByLocalName(doc, namespace, localName)
    if (!propEl) return null
    const hrefEl = this.firstElementByLocalName(propEl, 'DAV:', 'href')
    return hrefEl?.textContent?.trim() || null
  }

  private async findCalendarHomeFromCalendars(): Promise<string | null> {
    const client = this.getClient()
    const calendars = await client.fetchCalendars()

    if (calendars.length === 0 || !calendars[0].url) {
      return null
    }

    // Parse the first calendar's URL to derive the home
    const calendarUrlStr = calendars[0].url

    // Handle both absolute and relative URLs
    let calendarUrl: URL
    try {
      calendarUrl = new URL(calendarUrlStr)
    } catch {
      calendarUrl = new URL(calendarUrlStr, this.serverUrl)
    }

    const pathParts = calendarUrl.pathname.split('/').filter(Boolean)

    if (pathParts.length < 2) {
      return null
    }

    // Remove the last part (calendar name) to get the home
    pathParts.pop()
    const homePath = '/' + pathParts.join('/') + '/'

    return calendarUrl.origin + homePath
  }

  async updateCalendar(calendarUrl: string, options: UpdateCalendarOptions): Promise<void> {
    if (!navigator.onLine) {
      throw new Error('No network connection. Please check your internet connection.')
    }

    // Build PROPPATCH XML
    let propXml = '<prop>'
    if (options.name !== undefined) {
      propXml += `\n      <displayname>${escapeXml(options.name)}</displayname>`
    }
    if (options.description !== undefined) {
      propXml += `\n      <C:calendar-description xmlns:C="urn:ietf:params:xml:ns:caldav">${escapeXml(options.description)}</C:calendar-description>`
    }
    if (options.color !== undefined) {
      const normalizedColor = escapeXml(options.color)
      propXml += `\n      <ICAL:calendar-color xmlns:ICAL="http://apple.com/ns/ical/">${normalizedColor}</ICAL:calendar-color>`
      propXml += `\n      <ICAL:COLOR xmlns:ICAL="urn:ietf:params:xml:ns:icalendar">${normalizedColor}</ICAL:COLOR>`
    }
    propXml += '\n    </prop>'

    const xmlBody = `<?xml version="1.0" encoding="UTF-8" ?>
<propertyupdate xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <set>
    ${propXml}
  </set>
</propertyupdate>`

    const headers: Record<string, string> = {
      'Content-Type': 'application/xml; charset=utf-8',
      Authorization: this.authHeader,
    }

    const response = await this.proxyFetch(calendarUrl, {
      method: 'PROPPATCH',
      headers,
      body: xmlBody,
    })

    if (!response.ok && response.status !== 207) {
      const errorText = await response.text()
      throw new Error(`Failed to update calendar: ${response.status} ${errorText}`)
    }
  }

  async deleteCalendar(calendarUrl: string): Promise<void> {
    if (!navigator.onLine) {
      throw new Error('No network connection. Please check your internet connection.')
    }

    const headers: Record<string, string> = {
      Authorization: this.authHeader,
    }

    const response = await this.proxyFetch(calendarUrl, {
      method: 'DELETE',
      headers,
    })

    if (!response.ok && response.status !== 204 && response.status !== 200) {
      const errorText = await response.text()
      throw new Error(`Failed to delete calendar: ${response.status} ${errorText}`)
    }
  }

  // ── Settings sync helpers ───────────────────────────────────────────────

  // Stable UID for the single settings VEVENT stored in the dedicated
  // "Calino Settings" calendar. Literal on purpose — the dedicated
  // collection only ever contains this one event, and a single shared
  // UID is what makes cross-device sync work (any device that opens the
  // same CalDAV account can find and update this event).
  private static readonly SETTINGS_EVENT_UID = 'calino-settings'
  private static readonly SETTINGS_CAL_NAME = 'calino-settings'
  private static readonly SETTINGS_CAL_DISPLAY = 'Calino Settings'
  private static readonly SETTINGS_DEAD_PROP = 'X-CALINO-SETTINGS-CALENDAR'
  private static readonly SETTINGS_FILENAME = 'calino-settings.ics'

  /**
   * Parse a WebDAV multistatus (or any XML) response body into a Document.
   * Uses DOMParser instead of regex so element lookups are namespace-aware —
   * servers are free to use any namespace prefix (or none), and a regex
   * hardcoded to one prefix silently fails to match on servers that differ.
   */
  private parseXmlDocument(text: string): Document {
    const doc = new DOMParser().parseFromString(text, 'application/xml')
    const parserError = doc.getElementsByTagName('parsererror')[0]
    if (parserError) {
      throw new Error(`Failed to parse WebDAV XML response: ${parserError.textContent}`)
    }
    return doc
  }

  /** All descendant elements matching a local name in the DAV: namespace. */
  private getDavElements(scope: Document | Element, localName: string): Element[] {
    return Array.from(scope.getElementsByTagNameNS('DAV:', localName))
  }

  /** Text content of the first descendant element matching a local name in the DAV: namespace. */
  private getDavElementText(scope: Document | Element, localName: string): string | null {
    return this.getDavElements(scope, localName)[0]?.textContent ?? null
  }

  // ---------------------------------------------------------------------------
  // sync-collection REPORT (RFC 6578)
  // ---------------------------------------------------------------------------

  /**
   * Perform an incremental sync of a single collection (calendar or address
   * book) using sync-collection REPORT (RFC 6578).
   *
   * With `syncToken: null` this is a full initial sync — the server returns
   * every member and a fresh token to store. On a subsequent call with that
   * token, the server returns only what changed (added/modified resources
   * with an etag, removed resources as a bare 404 status) plus a new token.
   *
   * Falls back gracefully (`tokenInvalidated: true`) when the server rejects
   * the token (400 Bad Request / 507 Insufficient Storage — RFC 6578 §3.2)
   * or the request otherwise fails; the caller must then discard the stored
   * token and perform a full resync.
   *
   * Namespace-aware by construction: response parsing goes through
   * `getDavElements`/`getDavElementText` (DOMParser + `getElementsByTagNameNS`),
   * not prefix-bound regexes — Radicale emits DAV elements unprefixed
   * (`<href>` rather than `<D:href>`), which defeats a prefix-bound matcher.
   */
  async syncCollection(
    collectionUrl: string,
    syncToken: string | null
  ): Promise<SyncCollectionResult> {
    const body = `<?xml version="1.0" encoding="UTF-8" ?>
<D:sync-collection xmlns:D="DAV:">
  ${syncToken ? `<D:sync-token>${escapeXml(syncToken)}</D:sync-token>` : '<D:sync-token/>'}
  <D:sync-level>1</D:sync-level>
  <D:prop>
    <D:getetag/>
  </D:prop>
</D:sync-collection>`

    const headers: Record<string, string> = {
      'Content-Type': 'application/xml; charset=utf-8',
      Authorization: this.authHeader,
    }

    try {
      const response = await this.proxyFetch(collectionUrl, {
        method: 'REPORT',
        headers,
        body,
      })

      // RFC 6578 §3.2: the server rejects an invalid/expired token with
      // 400 or 507. Treat any other non-2xx/207 the same way — there is no
      // token worth keeping if the REPORT didn't succeed.
      if (response.status === 400 || response.status === 507) {
        return { changes: [], newSyncToken: null, tokenInvalidated: true }
      }
      if (!response.ok && response.status !== 207) {
        return { changes: [], newSyncToken: null, tokenInvalidated: true }
      }

      const text = await response.text()
      const doc = this.parseXmlDocument(text)

      const newSyncToken = this.getDavElementText(doc, 'sync-token')
      const changes = this.parseSyncCollectionResponse(doc, collectionUrl)

      return { changes, newSyncToken, tokenInvalidated: false }
    } catch {
      return { changes: [], newSyncToken: null, tokenInvalidated: true }
    }
  }

  /**
   * Parse a sync-collection multistatus into individual changes.
   * Each `<response>` is either:
   * - a tombstone: a `<status>` directly under `<response>` reporting 404
   *   (the member was removed since the last sync);
   * - added/changed: a `<propstat>` carrying `<getetag>` (200).
   *
   * Hrefs are resolved to absolute URLs via `resolveDavHref` (handles
   * relative, absolute and percent-encoded forms) before being returned.
   */
  private parseSyncCollectionResponse(doc: Document, baseUrl: string): SyncCollectionChange[] {
    const changes: SyncCollectionChange[] = []
    const responseElements = this.getDavElements(doc, 'response')

    for (const responseEl of responseElements) {
      const rawHref = this.getDavElementText(responseEl, 'href')
      if (!rawHref) continue

      // Resolve the href EXACTLY as the server sent it. Do not percent-decode
      // first: `new URL()` re-encodes %C3%A9 and %20 losslessly, but a decoded
      // %23 or %3F becomes a literal '#'/'?' and is reparsed as a fragment or
      // query — `ev%231.ics` would resolve to `.../ev#1.ics`, so a later GET
      // fetches `/ev` and the href no longer matches the stored one. Principal
      // discovery (see resolveDavHref call sites above) resolves raw for the
      // same reason.
      const href = resolveDavHref(baseUrl, rawHref)

      // A tombstone reports its status directly on <response>, not nested
      // inside a <propstat>. Only consider a <status> that is a direct
      // child of this <response> — a <propstat><status> further down
      // covers a per-property failure, not a resource-level removal.
      const topStatusEl = this.getDavElements(responseEl, 'status').find(
        (el) => el.parentElement === responseEl
      )
      const topStatusMatch = topStatusEl?.textContent
        ? /HTTP\/\d\.\d\s+(\d+)/.exec(topStatusEl.textContent)
        : null

      if (topStatusMatch && parseInt(topStatusMatch[1], 10) === 404) {
        changes.push({ href, etag: null, status: 'removed' })
        continue
      }

      const etag = this.getDavElementText(responseEl, 'getetag')
      if (etag) {
        changes.push({ href, etag, status: 'changed' })
      }
    }

    return changes
  }

  /**
   * Discover whether the dedicated Calino Settings calendar exists.
   * Returns the calendar object + URL when found, null otherwise.
   */
  async discoverSettingsCalendar(
    calendarHomeUrl: string
  ): Promise<{ url: string /* raw DAV calendar */ } | null> {
    if (!navigator.onLine) {
      throw new Error('No network connection. Please check your internet connection.')
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/xml; charset=utf-8',
      Authorization: this.authHeader,
      Depth: '1',
    }

    // PROPFIND depth-1 on the calendar home to list all child collections
    const propfindXml = `<?xml version="1.0" encoding="UTF-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:C="http://calino.app/ns/">
  <d:prop>
    <d:resourcetype/>
    <d:displayname/>
    <C:${CalDAVClient.SETTINGS_DEAD_PROP}/>
  </d:prop>
</d:propfind>`

    const response = await this.proxyFetch(calendarHomeUrl, {
      method: 'PROPFIND',
      headers,
      body: propfindXml,
    })

    if (!response.ok && response.status !== 207) {
      return null
    }

    const text = await response.text()
    const doc = this.parseXmlDocument(text)

    // Iterate response elements independently of namespace prefix or property order
    const responseElements = this.getDavElements(doc, 'response')

    for (const responseEl of responseElements) {
      const href = this.getDavElementText(responseEl, 'href')
      if (!href) continue

      // Match by dead property (preferred) or displayname + URL fragment
      const deadPropText = responseEl.getElementsByTagNameNS(
        'http://calino.app/ns/',
        CalDAVClient.SETTINGS_DEAD_PROP
      )[0]?.textContent
      const hasDeadProp = deadPropText?.trim() === '1'

      const displayName = this.getDavElementText(responseEl, 'displayname')
      const hasDisplayName =
        displayName === CalDAVClient.SETTINGS_CAL_DISPLAY &&
        href.includes(CalDAVClient.SETTINGS_CAL_NAME)

      if (hasDeadProp || hasDisplayName) {
        let calUrl = href
        if (calUrl.startsWith('/')) {
          const homeOrigin = new URL(calendarHomeUrl).origin
          calUrl = homeOrigin + calUrl
        }
        return { url: calUrl }
      }
    }

    return null
  }

  /**
   * Create the dedicated Calino Settings calendar.
   * Sets the dead property X-CALINO-SETTINGS-CALENDAR: 1 via PROPPATCH.
   */
  async createSettingsCalendar(calendarHomeUrl: string): Promise<string> {
    if (!navigator.onLine) {
      throw new Error('No network connection. Please check your internet connection.')
    }

    const calUrl = `${calendarHomeUrl}${CalDAVClient.SETTINGS_CAL_NAME}/`

    // MKCALENDAR
    const mkcalXml = `<?xml version="1.0" encoding="UTF-8" ?>
<D:mkcol xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set>
    <D:prop>
      <D:resourcetype>
        <D:collection/>
        <C:calendar/>
      </D:resourcetype>
      <D:displayname>${escapeXml(CalDAVClient.SETTINGS_CAL_DISPLAY)}</D:displayname>
      <C:supported-calendar-component-set>
        <C:comp name="VEVENT"/>
      </C:supported-calendar-component-set>
    </D:prop>
  </D:set>
</D:mkcol>`

    const mkcolHeaders: Record<string, string> = {
      'Content-Type': 'application/xml; charset=utf-8',
      Authorization: this.authHeader,
    }

    const mkcolResp = await this.proxyFetch(calUrl, {
      method: 'MKCOL',
      headers: mkcolHeaders,
      body: mkcalXml,
    })

    if (!mkcolResp.ok && mkcolResp.status !== 201 && mkcolResp.status !== 204) {
      const err = await mkcolResp.text()
      throw new Error(`Failed to create settings calendar: ${mkcolResp.status} ${err}`)
    }

    // PROPPATCH to set the dead property marker
    const proppatchXml = `<?xml version="1.0" encoding="UTF-8" ?>
<D:propertyupdate xmlns:D="DAV:" xmlns:C="http://calino.app/ns/">
  <D:set>
    <D:prop>
      <D:displayname>${escapeXml(CalDAVClient.SETTINGS_CAL_DISPLAY)}</D:displayname>
      <C:${CalDAVClient.SETTINGS_DEAD_PROP}>1</C:${CalDAVClient.SETTINGS_DEAD_PROP}>
    </D:prop>
  </D:set>
</D:propertyupdate>`

    await this.proxyFetch(calUrl, {
      method: 'PROPPATCH',
      headers: mkcolHeaders,
      body: proppatchXml,
    })

    return calUrl
  }

  /**
   * Fetch the settings VEVENT from the settings calendar.
   * Returns the raw iCal data, ETag, and object href, or null when not found.
   */
  async fetchSettingsEvent(
    settingsCalendarUrl: string
  ): Promise<{ data: string; etag: string; href: string; dtstamp: string } | null> {
    if (!navigator.onLine) {
      throw new Error('No network connection. Please check your internet connection.')
    }

    const settingsUid = CalDAVClient.SETTINGS_EVENT_UID

    const reportXml = `<?xml version="1.0" encoding="UTF-8" ?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:prop-filter name="UID">
          <c:text-match collation="i;octet" negate="no">${escapeXml(settingsUid)}</c:text-match>
        </c:prop-filter>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`

    const headers: Record<string, string> = {
      'Content-Type': 'application/xml; charset=utf-8',
      Authorization: this.authHeader,
      Depth: '1',
    }

    const response = await this.proxyFetch(settingsCalendarUrl, {
      method: 'REPORT',
      headers,
      body: reportXml,
    })

    if (!response.ok && response.status !== 207) {
      if (response.status === 404) {
        throw new Error(`Settings calendar not found: ${settingsCalendarUrl}`)
      }
      return null
    }

    const text = await response.text()
    const doc = this.parseXmlDocument(text)

    // Iterate response elements — each contains href, etag, calendar-data
    const responseElements = this.getDavElements(doc, 'response')

    for (const responseEl of responseElements) {
      const href = this.getDavElementText(responseEl, 'href')
      const etag = this.getDavElementText(responseEl, 'getetag')
      const icalData = responseEl.getElementsByTagNameNS(
        'urn:ietf:params:xml:ns:caldav',
        'calendar-data'
      )[0]?.textContent

      if (href && icalData) {
        // Resolve relative hrefs against the calendar home origin
        let resolvedHref = href
        if (resolvedHref.startsWith('/')) {
          const homeOrigin = new URL(settingsCalendarUrl).origin
          resolvedHref = homeOrigin + resolvedHref
        }
        // Note: textContent from a parsed DOM node is already entity-decoded,
        // so no manual &quot;/&lt;/&gt;/&amp; unescaping is needed here.
        const trimmedData = icalData.trim()
        // Extract DTSTAMP for conflict resolution
        const dtstampMatch = trimmedData.match(/DTSTAMP:(\d{8}T\d{6}Z)/)
        const dtstamp = dtstampMatch?.[1] || ''
        return { data: trimmedData, etag: etag || '', href: resolvedHref, dtstamp }
      }
    }

    return null
  }

  /**
   * Extract the base64-encoded settings JSON from the ATTACH field of a VEVENT.
   */
  extractSettingsFromVEVENT(icalData: string): string | null {
    // First, unfold iCalendar lines (continuation lines start with space/tab)
    const unfolded = icalData.replace(/\r?\n[ \t]/g, '')
    // Match ATTACH;ENCODING=BASE64;FMTTYPE=app/json:<base64>
    const attachMatch = unfolded.match(/ATTACH[^:]*:([A-Za-z0-9+/=]+)/)
    if (!attachMatch?.[1]) {
      console.warn('[SettingsSync] No ATTACH found in VEVENT')
      return null
    }
    try {
      return decodeBase64(attachMatch[1])
    } catch {
      console.warn('[CalDAV] Failed to decode base64 settings from ATTACH')
      return null
    }
  }

  /**
   * Write (create or update) the settings VEVENT.
   * Uses optimistic locking via If-Match when an ETag is provided.
   * Returns the new ETag.
   */
  async putSettingsEvent(
    settingsCalendarUrl: string,
    base64Payload: string,
    etag?: string,
    existingEvent?: { href: string; etag: string } | null
  ): Promise<string> {
    if (!navigator.onLine) {
      throw new Error('No network connection. Please check your internet connection.')
    }

    // R2.7 review follow-up: defense-in-depth — reject any payload that
    // isn't valid base64 before splicing it into the iCal stream. All
    // current callers pass the output of `encodeBase64()` (charset
    // [A-Za-z0-9+/=]), so this branch is unreachable in practice; it
    // exists to prevent a future caller from injecting CRLF into the
    // ATTACH line and breaking out into arbitrary iCal properties.
    if (!/^[A-Za-z0-9+/=]*$/.test(base64Payload)) {
      throw new Error('Invalid base64 payload for settings sync')
    }

    const settingsUid = CalDAVClient.SETTINGS_EVENT_UID
    const filename = CalDAVClient.SETTINGS_FILENAME

    // R2.7 — Build the settings VEVENT through `eventToICAL` so we get
    // proper RFC 5545 §3.1 line folding + CRLF (and ical.js v2.2.1's
    // 76-octet foldline quirk is corrected by `foldICalLines` in the
    // adapter). The base eventToICAL output doesn't know about settings-
    // specific properties (ATTACH payload, CLASS:PRIVATE, X-CALINO-VERSION
    // marker), so we inject them via string replacement and re-fold to
    // ensure the long ATTACH base64 payload obeys the 75-octet limit.
    const settingsEvent: CalendarEvent = {
      id: settingsUid,
      title: 'Calino Settings',
      description: '',
      start: '1970-01-01T00:00:00.000Z',
      end: '1970-01-01T00:00:01.000Z',
      isAllDay: false,
      calendarId: 'settings',
      transparency: 'transparent',
    }
    const icalBase = eventToICAL(settingsEvent)
    const attachLine = `ATTACH;ENCODING=BASE64;FMTTYPE=app/json:${base64Payload}`
    const extraProps = `CLASS:PRIVATE\r\nX-CALINO-VERSION:1\r\n${attachLine}`
    const icalString = foldICalLines(
      icalBase.replace(/(SUMMARY:Calino Settings\r\n)/, `$1${extraProps}\r\n`)
    )

    // Skip the fetch if caller already knows the existing event
    let existing: { href: string; etag: string } | null | undefined = existingEvent
    if (existing === undefined) {
      if (useSettingsStore.getState().caldavDebugMode)
        console.log('[SettingsSync] putSettingsEvent: fetching existing event...')
      existing = await this.fetchSettingsEvent(settingsCalendarUrl)
      if (useSettingsStore.getState().caldavDebugMode)
        console.log('[SettingsSync] putSettingsEvent: existing =', existing?.href ?? 'null')
    }

    if (existing?.href) {
      // Update existing — always prefer the server's ETag over stale stored one
      const useEtag = existing.etag || etag
      if (!useEtag) {
        throw new Error('Cannot update settings event: no ETag available')
      }
      if (useSettingsStore.getState().caldavDebugMode)
        console.log(
          '[SettingsSync] putSettingsEvent: updating existing at',
          existing.href,
          'etag =',
          useEtag ? `${useEtag.slice(0, 8)}…` : useEtag
        )
      const client = this.getClient()
      const result = await client.updateCalendarObject({
        calendarObject: {
          url: existing.href,
          etag: useEtag,
          data: icalString,
        },
      })
      await this.assertResponseOk(result, 'PUT', existing.href)
      if (useSettingsStore.getState().caldavDebugMode)
        console.log('[SettingsSync] putSettingsEvent: update result status =', result.status)
      return result.headers?.get('etag') || useEtag
    }

    // No existing event found via REPORT
    // If we have a stored ETag, the event exists but REPORT failed — try update anyway
    if (etag) {
      if (useSettingsStore.getState().caldavDebugMode)
        console.log(
          '[SettingsSync] putSettingsEvent: no existing found, trying stored etag at constructed href'
        )
      // Reconstruct the likely href from the calendar URL + filename
      const possibleHref = settingsCalendarUrl + CalDAVClient.SETTINGS_FILENAME
      const client = this.getClient()
      try {
        const result = await client.updateCalendarObject({
          calendarObject: {
            url: possibleHref,
            etag,
            data: icalString,
          },
        })
        await this.assertResponseOk(result, 'PUT', possibleHref)
        return result.headers?.get('etag') || etag
      } catch {
        // If that also fails, the event might have been deleted — fall through to create
      }
    }

    // Create new
    {
      if (useSettingsStore.getState().caldavDebugMode)
        console.log('[SettingsSync] putSettingsEvent: creating new event')
      const client = this.getClient()
      // Find the settings calendar object for tsdav
      const calendars = await client.fetchCalendars()
      if (useSettingsStore.getState().caldavDebugMode)
        console.log('[SettingsSync] putSettingsEvent: found', calendars.length, 'calendars')
      const settingsCal = calendars.find((c) => {
        const calUrl = c.url || ''
        return (
          calUrl === settingsCalendarUrl || calUrl.endsWith(CalDAVClient.SETTINGS_CAL_NAME + '/')
        )
      })
      if (!settingsCal) {
        throw new Error('Settings calendar not found')
      }
      if (useSettingsStore.getState().caldavDebugMode)
        console.log('[SettingsSync] putSettingsEvent: creating calendar object in', settingsCal.url)
      const result = await client.createCalendarObject({
        calendar: settingsCal,
        filename,
        iCalString: icalString,
      })
      await this.assertResponseOk(result, 'PUT', settingsCal.url)
      return result.headers?.get('etag') || ''
    }
  }

  /**
   * Delete the settings VEVENT from the settings calendar.
   */
  async deleteSettingsEvent(settingsCalendarUrl: string): Promise<void> {
    if (!navigator.onLine) {
      throw new Error('No network connection. Please check your internet connection.')
    }
    const existing = await this.fetchSettingsEvent(settingsCalendarUrl)
    if (!existing?.href) return
    const client = this.getClient()
    const response = await client.deleteCalendarObject({
      calendarObject: { url: existing.href, etag: existing.etag },
    })
    // 404/410 mean the settings event is already gone — that is the goal.
    await this.assertResponseOk(response, 'DELETE', existing.href, true)
  }

  /**
   * Delete the entire settings calendar collection.
   */
  async deleteSettingsCalendar(settingsCalendarUrl: string): Promise<void> {
    if (!navigator.onLine) {
      throw new Error('No network connection. Please check your internet connection.')
    }
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
    }
    const resp = await this.proxyFetch(settingsCalendarUrl, {
      method: 'DELETE',
      headers,
    })
    // 404 is fine — already gone
    if (!resp.ok && resp.status !== 404) {
      const err = await resp.text()
      throw new Error(`Failed to delete settings calendar: ${resp.status} ${err}`)
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Free/busy (RFC 4791 §7.10 and RFC 6638 §4.1)
  //
  // These live on the client rather than in a standalone module because every
  // request has to go through `proxyFetch` and `authHeader` — a raw fetch from
  // the page to an arbitrary CalDAV host is blocked by CORS. They return null
  // (never throw) when the server can't or won't answer: "unknown" is the
  // expected outcome for most servers, not an error worth surfacing.
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Does this server do scheduling? RFC 6638 requires `calendar-auto-schedule`
   * in the `DAV:` header. Without it there is no Outbox and no point asking
   * about anyone but ourselves.
   */
  async supportsScheduling(url?: string): Promise<boolean> {
    try {
      const response = await this.proxyFetch(url ?? this.serverUrl, {
        method: 'OPTIONS',
        headers: { Authorization: this.authHeader },
      })
      const dav = response.headers?.get?.('dav') ?? ''
      return /calendar-auto-schedule/i.test(dav)
    } catch {
      return false
    }
  }

  /**
   * RFC 4791 §7.10 — when is the *owner of this collection* busy. The response
   * body is `text/calendar` (a VFREEBUSY), not a multistatus.
   */
  async queryFreeBusy(
    calendarUrl: string,
    start: Date,
    end: Date
  ): Promise<FreeBusyPeriod[] | null> {
    try {
      const response = await this.proxyFetch(calendarUrl, {
        method: 'REPORT',
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          Authorization: this.authHeader,
          Depth: '1',
        },
        body: buildFreeBusyQueryXml(start, end),
      })

      if (!response.ok) return null
      return parseVFreeBusy(await response.text())
    } catch {
      return null
    }
  }

  /**
   * RFC 6638 §4.1 — ask the scheduling Outbox about other people. Returns a map
   * keyed by lowercased email; a recipient the server declined to answer for
   * maps to null rather than to an empty (i.e. "free") list.
   */
  async queryAttendeeFreeBusy(
    outboxUrl: string,
    organizerEmail: string,
    attendeeEmails: string[],
    start: Date,
    end: Date
  ): Promise<Map<string, FreeBusyPeriod[] | null> | null> {
    if (attendeeEmails.length === 0) return new Map()

    try {
      const response = await this.proxyFetch(outboxUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
          Authorization: this.authHeader,
          Originator: `mailto:${organizerEmail}`,
          Recipient: attendeeEmails.map((e) => `mailto:${e}`).join(', '),
        },
        body: buildFreeBusyRequestIcs(organizerEmail, attendeeEmails, start, end),
      })

      if (!response.ok) return null

      const result = new Map<string, FreeBusyPeriod[] | null>()
      for (const entry of parseScheduleResponse(await response.text())) {
        result.set(entry.recipient.toLowerCase(), entry.periods)
      }
      return result
    } catch {
      return null
    }
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
