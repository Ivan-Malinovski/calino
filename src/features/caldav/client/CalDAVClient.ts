import { createDAVClient } from 'tsdav'
import type { CalDAVCredentials, CalDAVCalendar, CreateCalendarOptions, UpdateCalendarOptions } from '../types'
import { v4 as uuidv4 } from 'uuid'
import { decodeBase64 } from '@/lib/settingsSync'
import { getInstanceId } from '@/lib/instanceId'
import { DEFAULT_CALENDAR_COLOR } from '@/config'
import { useSettingsStore } from '@/store/settingsStore'
import { eventToICAL, foldICalLines } from '@/features/caldav/adapter/iCalendarAdapter'
import type { CalendarEvent } from '@/types'

const NETWORK_TIMEOUT_MS = 15_000

function escapeXml(str: string): string {
  return str
    // Remove XML-illegal control characters (except tab, newline, carriage return)
    .split('')
    .filter((c) => {
      const code = c.charCodeAt(0)
      return code >= 0x20 || code === 0x09 || code === 0x0A || code === 0x0D
    })
    .join('')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
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

function prefixUrlWithProxy(url: string, proxyBase: string): string {
  if (!proxyBase) {
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

async function fetchWithTimeout(
  url: string | URL,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
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
    this.authHeader = `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`
    this.proxyFetch = proxyUrl ? createProxyFetch(proxyUrl) : fetchWithTimeout
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
      fetch: this.proxyUrl ? createProxyFetch(this.proxyUrl) : undefined,
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
    const davCalendars = await client.fetchCalendars()

    this.cachedCalendars = davCalendars

    return davCalendars.map((cal, index) => {
      const supportedComponents = cal.components?.filter(
        (component): component is 'VEVENT' | 'VTODO' =>
          component === 'VEVENT' || component === 'VTODO'
      )

      return {
        id: cal.url || `cal-${index}-${uuidv4()}`,
        // Note: accountId is NOT set here - the caller must set it
        // this.credentials.id is the credential ID, not the account ID
        url: cal.url || '',
        name: typeof cal.displayName === 'string' ? cal.displayName : 'Unnamed Calendar',
        color: normalizeColor(cal.calendarColor as string | null | undefined),
        ctag: null,
        syncToken: null,
        isVisible: true,
        isDefault: index === 0,
        supportedComponents: cal.components ? supportedComponents : undefined,
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
      } catch { /* ignore decode errors */ }
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
    end: string
  ): Promise<{ url: string; data: string; etag?: string }[]> {
    if (!navigator.onLine) {
      throw new Error('No network connection. Please check your internet connection.')
    }
    const client = this.getClient()
    const calendar = await this.findCalendarByUrl(calendarUrl)

    // Fetch VEVENTs with time range
    const eventObjects = await client.fetchCalendarObjects({
      calendar,
      timeRange: {
        start,
        end,
      },
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

    const result = await client.createCalendarObject({
      calendar,
      filename,
      iCalString,
    })

    // Extract ETag from response headers
    let etag = result.headers?.get('etag') || ''

    // Some servers (Google, iCloud) omit the ETag header on PUT. Persisting an
    // empty etag with syncStatus 'synced' means the next update sends an empty
    // If-Match — the stale-etag conflict we want to avoid. Recover it with a
    // follow-up PROPFIND. Never throw: a missing etag must not fail creation.
    if (!etag && result.url) {
      etag = await this.fetchEtag(result.url)
    }

    return {
      url: result.url,
      etag,
    }
  }

  /**
   * Fetch the current ETag for a single calendar object via PROPFIND (Depth 0).
   * Returns '' on any failure — callers treat a missing etag as non-fatal.
   */
  private async fetchEtag(eventUrl: string): Promise<string> {
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
      // Namespace-agnostic getetag match (d:, D:, or default namespace).
      const etagMatch = text.match(/<[^>]*getetag[^>]*>([^<]+)<\/[^>]*getetag>/)
      return etagMatch?.[1]?.trim() || ''
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

    // Extract ETag from response headers
    const newEtag = result.headers?.get('etag') || etag

    return {
      url: result.url,
      etag: newEtag,
    }
  }

  async deleteEvent(eventUrl: string, etag: string): Promise<void> {
    if (!navigator.onLine) {
      throw new Error('No network connection. Please check your internet connection.')
    }
    const client = this.getClient()

    await client.deleteCalendarObject({
      calendarObject: { url: eventUrl, etag },
    })
  }

  async createCalendar(options: CreateCalendarOptions): Promise<CalDAVCalendar> {
    if (!navigator.onLine) {
      throw new Error('No network connection. Please check your internet connection.')
    }

    // Build the MKCALENDAR XML body
    const components = options.components || ['VEVENT', 'VTODO']
    const componentXml = components
      .map((comp) => `<C:comp name="${comp}"/>`)
      .join('\n          ')

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

    throw new Error('Could not determine calendar home URL. Please check your CalDAV server configuration.')
  }

  private async findCalendarHomeFromPrincipal(): Promise<string | null> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/xml; charset=utf-8',
      Authorization: this.authHeader,
      Depth: '0',
    }

    // Try to find the current user's principal
    const principalXml = `<?xml version="1.0" encoding="UTF-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <C:calendar-home-set/>
  </d:prop>
</d:propfind>`

    // Try common principal URLs
    const principalPaths = [
      '/dav.php/principals/',
      '/principals/',
      '/remote.php/dav/principals/',
      '/dav/',
    ]

    for (const path of principalPaths) {
      const baseUrl = this.serverUrl.replace(/\/$/, '')
      const testUrl = `${baseUrl}${path}${this.credentials.username}/`
      
      try {
        const response = await this.proxyFetch(testUrl, {
          method: 'PROPFIND',
          headers,
          body: principalXml,
        })
        
        if (response.ok || response.status === 207) {
          const text = await response.text()
          const match = text.match(/<C:calendar-home-set>\s*<d:href>([^<]+)<\/d:href>/)
          if (match?.[1]) {
            return match[1].startsWith('http') ? match[1] : `${baseUrl}${match[1]}`
          }
        }
      } catch {
        // Try next path
      }
    }
    
    return null
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

  // Per-instance settings UID. Two Calino instances syncing to the same
  // CalDAV server would otherwise collide on a hardcoded UID and
  // overwrite each other's settings event. We derive from the per-
  // browser-instance UUID persisted in localStorage at first launch
  // (see lib/instanceId.ts) so the UID is stable for one Calino user
  // but unique across users sharing a server.
  private static readonly SETTINGS_EVENT_UID = `calino-settings-${getInstanceId()}`
  private static readonly SETTINGS_CAL_NAME = 'calino-settings'
  private static readonly SETTINGS_CAL_DISPLAY = 'Calino Settings'
  private static readonly SETTINGS_DEAD_PROP = 'X-CALINO-SETTINGS-CALENDAR'
  private static readonly SETTINGS_FILENAME = 'calino-settings.ics'

  /**
   * Discover whether the dedicated Calino Settings calendar exists.
   * Returns the calendar object + URL when found, null otherwise.
   */
  async discoverSettingsCalendar(
    calendarHomeUrl: string,
  ): Promise<{ url: string; /* raw DAV calendar */ } | null> {
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

    // Iterate response blocks independently of property order
    const responseBlocks = text.match(/<d:response>[\s\S]*?<\/d:response>/g) || []

    for (const block of responseBlocks) {
      const hrefMatch = block.match(/<d:href>([^<]+)<\/d:href>/)
      if (!hrefMatch?.[1]) continue

      // Match by dead property (preferred) or displayname + URL fragment
      const hasDeadProp = block.includes(`<${CalDAVClient.SETTINGS_DEAD_PROP}`) && block.includes(`>${CalDAVClient.SETTINGS_DEAD_PROP}`)
        ? block.match(new RegExp(`<[^:]*:${CalDAVClient.SETTINGS_DEAD_PROP}[^>]*>1</[^:]*:${CalDAVClient.SETTINGS_DEAD_PROP}>`))
        : block.match(new RegExp(`<${CalDAVClient.SETTINGS_DEAD_PROP}[^>]*>1</${CalDAVClient.SETTINGS_DEAD_PROP}>`))

      const displayNameMatch = block.match(/<d:displayname>([^<]*)<\/d:displayname>/)
      const hasDisplayName = displayNameMatch?.[1] === CalDAVClient.SETTINGS_CAL_DISPLAY &&
        hrefMatch[1].includes(CalDAVClient.SETTINGS_CAL_NAME)

      if (hasDeadProp || hasDisplayName) {
        let calUrl = hrefMatch[1]
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
    settingsCalendarUrl: string,
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

    // Extract the response blocks — each <d:response> contains href, etag, calendar-data
    const responseBlocks = text.match(/<d:response>[\s\S]*?<\/d:response>/g) || []

    for (const block of responseBlocks) {
      const hrefMatch = block.match(/<d:href>([^<]+)<\/d:href>/)
      const etagMatch = block.match(/<d:getetag>([^<]+)<\/d:getetag>/)
      const dataMatch = block.match(/<[^:]*:calendar-data[^>]*>([\s\S]*?)<\/[^:]*:calendar-data>/)

      if (hrefMatch?.[1] && dataMatch?.[1]) {
        // Resolve relative hrefs against the calendar home origin
        let href = hrefMatch[1]
        if (href.startsWith('/')) {
          const homeOrigin = new URL(settingsCalendarUrl).origin
          href = homeOrigin + href
        }
        // Decode HTML entities in ETag (e.g. &quot; → ")
        const rawEtag = etagMatch?.[1] || ''
        const etag = rawEtag.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        const icalData = dataMatch[1].trim()
        // Extract DTSTAMP for conflict resolution
        const dtstampMatch = icalData.match(/DTSTAMP:(\d{8}T\d{6}Z)/)
        const dtstamp = dtstampMatch?.[1] || ''
        return { data: icalData, etag, href, dtstamp }
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
    const attachMatch = unfolded.match(
      /ATTACH[^:]*:([A-Za-z0-9+/=]+)/,
    )
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
    existingEvent?: { href: string; etag: string } | null,
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
      icalBase.replace(
        /(SUMMARY:Calino Settings\r\n)/,
        `$1${extraProps}\r\n`,
      ),
    )

    // Skip the fetch if caller already knows the existing event
    let existing: { href: string; etag: string } | null | undefined = existingEvent
    if (existing === undefined) {
      if (useSettingsStore.getState().caldavDebugMode) console.log('[SettingsSync] putSettingsEvent: fetching existing event...')
      existing = await this.fetchSettingsEvent(settingsCalendarUrl)
      if (useSettingsStore.getState().caldavDebugMode) console.log('[SettingsSync] putSettingsEvent: existing =', existing?.href ?? 'null')
    }

    if (existing?.href) {
      // Update existing — always prefer the server's ETag over stale stored one
      const useEtag = existing.etag || etag
      if (!useEtag) {
        throw new Error('Cannot update settings event: no ETag available')
      }
      if (useSettingsStore.getState().caldavDebugMode) console.log('[SettingsSync] putSettingsEvent: updating existing at', existing.href, 'etag =', useEtag ? `${useEtag.slice(0, 8)}…` : useEtag)
      const client = this.getClient()
      const result = await client.updateCalendarObject({
        calendarObject: {
          url: existing.href,
          etag: useEtag,
          data: icalString,
        },
      })
      if (useSettingsStore.getState().caldavDebugMode) console.log('[SettingsSync] putSettingsEvent: update result status =', result.status)
      return result.headers?.get('etag') || useEtag
    }

    // No existing event found via REPORT
    // If we have a stored ETag, the event exists but REPORT failed — try update anyway
    if (etag) {
      if (useSettingsStore.getState().caldavDebugMode) console.log('[SettingsSync] putSettingsEvent: no existing found, trying stored etag at constructed href')
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
        return result.headers?.get('etag') || etag
      } catch {
        // If that also fails, the event might have been deleted — fall through to create
      }
    }

    // Create new
    {
      if (useSettingsStore.getState().caldavDebugMode) console.log('[SettingsSync] putSettingsEvent: creating new event')
      const client = this.getClient()
      // Find the settings calendar object for tsdav
      const calendars = await client.fetchCalendars()
      if (useSettingsStore.getState().caldavDebugMode) console.log('[SettingsSync] putSettingsEvent: found', calendars.length, 'calendars')
      const settingsCal = calendars.find((c) => {
        const calUrl = c.url || ''
        return calUrl === settingsCalendarUrl || calUrl.endsWith(CalDAVClient.SETTINGS_CAL_NAME + '/')
      })
      if (!settingsCal) {
        throw new Error('Settings calendar not found')
      }
      if (useSettingsStore.getState().caldavDebugMode) console.log('[SettingsSync] putSettingsEvent: creating calendar object in', settingsCal.url)
      const result = await client.createCalendarObject({
        calendar: settingsCal,
        filename,
        iCalString: icalString,
      })
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
    await client.deleteCalendarObject({
      calendarObject: { url: existing.href, etag: existing.etag },
    })
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
