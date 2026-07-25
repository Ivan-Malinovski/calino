import { createDAVClient } from 'tsdav'
import { webFetch } from '@/lib/webFetch'

const DISCOVERY_TIMEOUT_MS = 8_000

/**
 * Known CalDAV providers that require non-standard URLs.
 * Maps a hostname (or hostname pattern) to:
 *   - baseUrl: the CalDAV root
 *   - urlTemplate: a URL template where {email} is replaced with the user's email.
 *     When the user enters just the base URL, we expand the template using the username.
 *     null means no template (we can only suggest, not auto-construct).
 */
const KNOWN_CALENDAR_PROVIDERS: Record<
  string,
  {
    baseUrl: string
    urlTemplate: string | null
    /**
     * Guidance shown when the server rejects the credentials (401/403).
     * Many providers (Fastmail, iCloud, Google) reject the account login
     * password and require a provider-generated app-specific password.
     */
    authHint: string | null
  }
> = {
  'fastmail.com': {
    baseUrl: 'https://caldav.fastmail.com',
    urlTemplate: 'https://caldav.fastmail.com/dav/principals/user/{email}/',
    authHint:
      'Fastmail rejected these credentials. Fastmail requires an app-specific password for CalDAV — your normal login password will not work. Create one at Settings → Privacy & Security → Integrations → New App Password (grant it "Calendars (CalDAV)" access), then use your email as the username and that password.',
  },
}

/**
 * For known providers, try to expand the server URL using the username (email).
 * Returns the expanded URL if the provider is recognized and the URL looks like
 * a bare base (no principal path), or null if we can't expand.
 */
export function expandProviderUrl(serverUrl: string, username: string): string | null {
  try {
    const parsed = new URL(serverUrl)
    const bareDomain = parsed.hostname.replace(/^www\./, '')
    for (const [domain, info] of Object.entries(KNOWN_CALENDAR_PROVIDERS)) {
      if (bareDomain === domain || bareDomain.endsWith('.' + domain)) {
        // Only expand when the URL is the bare base (no meaningful path).
        // Don't replace URLs that already point to a specific CalDAV path.
        const path = parsed.pathname.replace(/\/$/, '')
        const isBareBase = path === '' || path === '/dav'
        if (isBareBase && username.includes('@') && info.urlTemplate) {
          return info.urlTemplate.replace('{email}', encodeURIComponent(username))
        }
      }
    }
  } catch { /* invalid URL — ignore */ }
  return null
}

/**
 * Suggest a user-friendly URL hint when the connection fails.
 * Returns null when we don't have provider-specific guidance.
 */
export function suggestCalDAVUrl(serverUrl: string): string | null {
  try {
    const hostname = new URL(serverUrl).hostname
    for (const [domain, info] of Object.entries(KNOWN_CALENDAR_PROVIDERS)) {
      if (hostname === domain || hostname.endsWith('.' + domain)) {
        if (!info.urlTemplate) return null
        return `For ${domain}, try entering: ${info.urlTemplate.replace('{email}', 'your-email@' + domain)}`
      }
    }
  } catch { /* invalid URL — ignore */ }
  return null
}

/**
 * When the server rejects the credentials (401/403), suggest provider-specific
 * guidance — most often that the provider needs an app-specific password rather
 * than the account login password. Returns null when we have no guidance.
 */
export function suggestAuthHint(serverUrl: string): string | null {
  try {
    const hostname = new URL(serverUrl).hostname
    for (const [domain, info] of Object.entries(KNOWN_CALENDAR_PROVIDERS)) {
      if (hostname === domain || hostname.endsWith('.' + domain)) {
        return info.authHint
      }
    }
  } catch { /* invalid URL — ignore */ }
  return null
}

/**
 * Discover the CalDAV base URL by probing /.well-known/caldav (RFC 6749 §3.1).
 *
 * The server responds with a redirect (301/302) to its actual CalDAV endpoint:
 *   - Baikal:  → /dav.php
 *   - Radicale: → /
 *   - Nextcloud: → /remote.php/dav
 *
 * When a proxy is used, redirects are followed manually because the Location
 * header is relative to the target server, not the proxy.
 */
export async function discoverServerUrl(baseUrl: string, proxyUrl?: string): Promise<string> {
  const normalizedUrl = normalizeUrl(baseUrl)

  try {
    const discovered = await probeWellKnown(normalizedUrl, proxyUrl)
    if (discovered) {
      // Sanity check: the base must NOT be the .well-known/caldav URL itself.
      // If it is, the proxy followed the redirect internally and we never saw
      // the real Location header — discard and fall back to the base URL.
      const wellKnownPath = '/.well-known/caldav'
      if (discovered.endsWith(wellKnownPath) || discovered.endsWith(wellKnownPath + '/')) {
        console.log('[CalDAV] Discovery: probe returned .well-known/caldav as base — proxy likely followed redirect. Falling back.')
      } else {
        console.log('[CalDAV] Discovery: well-known probe succeeded:', discovered)
        return discovered
      }
    }
  } catch (error) {
    console.warn(
      '[CalDAV] Discovery: well-known probe failed:',
      error instanceof Error ? error.message : String(error)
    )
  }

  // Well-known didn't work. Try the caldav. subdomain as a fallback.
  // Many providers (Fastmail, etc.) host CalDAV at caldav.{domain} but don't
  // set up a well-known redirect from the main domain.
  try {
    const parsed = new URL(normalizedUrl)
    const bareDomain = parsed.hostname.replace(/^www\./, '')
    if (!bareDomain.startsWith('caldav.')) {
      const caldavBase = `${parsed.protocol}//caldav.${bareDomain}${parsed.port ? `:${parsed.port}` : ''}`
      const caldavDiscovered = await probeWellKnown(caldavBase, proxyUrl)
      if (caldavDiscovered) {
        console.log('[CalDAV] Discovery: caldav. subdomain probe succeeded:', caldavDiscovered)
        return caldavDiscovered
      }
    }
  } catch {
    // caldav. subdomain probe failed — fall through to base URL
  }

  console.log('[CalDAV] Discovery: falling back to base URL:', normalizedUrl)
  return normalizedUrl.replace(/\/$/, '')
}

/**
 * Probe /.well-known/caldav and follow the redirect to the real CalDAV base.
 * Returns null if the server doesn't support well-known (e.g. returns 404).
 */
async function probeWellKnown(
  baseUrl: string,
  proxyUrl?: string
): Promise<string | null> {
  const wellKnownUrl = new URL('/.well-known/caldav', baseUrl).href

  if (proxyUrl) {
    return probeWellKnownViaProxy(wellKnownUrl, baseUrl, proxyUrl)
  }

  return probeWellKnownDirect(wellKnownUrl, baseUrl)
}

/**
 * Check whether a path is (or contains) the .well-known/caldav endpoint.
 * If the server responded at .well-known itself (no redirect happened),
 * we treat it as unsupported and fall back to the base URL.
 */
function isWellKnownPath(pathname: string): boolean {
  const wellKnownSuffix = '/.well-known/caldav'
  return pathname === wellKnownSuffix || pathname === wellKnownSuffix + '/'
}

/** Direct fetch: follow redirect and compare final URL to detect .well-known discovery. */
async function probeWellKnownDirect(
  wellKnownUrl: string,
  baseUrl: string
): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS)
  try {
    // Use redirect:'follow' — cross-origin redirect:'manual' returns an opaque
    // response (status 0, empty headers) in browsers, even with CORS exposed headers.
    const response = await webFetch(wellKnownUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    })

    const finalUrl = new URL(response.url)
    // Keep trailing slash — some servers (Davis) require it for PROPFIND.
    const finalPath = finalUrl.pathname

    // If the final URL is still .well-known/caldav, no redirect happened.
    // RFC 5785 says the actual service MUST NOT be at .well-known, so this
    // means the server doesn't support well-known discovery.
    if (isWellKnownPath(finalPath)) {
      return null
    }

    // We were redirected to a different path — that's the real CalDAV endpoint.
    // Pass finalUrl.origin so cross-domain redirects (e.g. www → caldav subdomain)
    // keep the redirect target's host instead of the original server's host.
    return buildBaseUrl(baseUrl, finalPath, finalUrl.origin)
  } finally {
    clearTimeout(timer)
  }
}

/** Proxy fetch: same logic as direct — the proxy handles redirects. */
async function probeWellKnownViaProxy(
  wellKnownUrl: string,
  baseUrl: string,
  proxyUrl: string
): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS)
  try {
    const response = await proxyFetch(proxyUrl, wellKnownUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    })

    // Same logic as probeWellKnownDirect: check if we ended up somewhere else.
    // If the proxy followed a redirect, the X-Target-URL header reveals the
    // real endpoint. Preserve trailing slash — some servers (Davis) require it.
    const targetUrl = response.headers.get('X-Target-URL')
    if (targetUrl) {
      const finalUrl = new URL(targetUrl)
      const finalPath = finalUrl.pathname
      if (!isWellKnownPath(finalPath)) {
        return buildBaseUrl(baseUrl, finalPath, finalUrl.origin)
      }
    }

    // No X-Target-URL: infer from status.
    // 401/403 could mean the redirect requires authentication — we can't
    // determine the actual path, so fall back to base URL.
    if (response.status === 401 || response.status === 403) {
      return null
    }

    // 200 at .well-known itself — server doesn't redirect (unsupported)
    if (response.ok) {
      return null
    }

    // 404/405 — not supported
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Build a normalized base URL from the server's origin + discovered path.
 * When the redirect crosses domains (e.g. www.fastmail.com → caldav.fastmail.com),
 * the caller should pass `finalOrigin` so we use the redirect target's host,
 * not the original server's host.
 */
function buildBaseUrl(serverBaseUrl: string, discoveredPath: string, finalOrigin?: string): string {
  const origin = finalOrigin || new URL(serverBaseUrl).origin
  // Keep trailing slash if the server redirected to one (e.g. Davis → /dav/).
  // Some servers (Davis) require the trailing slash for PROPFIND to work;
  // others (Baikal, Radicale) work either way. tsdav uses new URL() which
  // handles both forms correctly.
  // Root path becomes just the origin (e.g. https://radicale.example.com)
  return discoveredPath === '' || discoveredPath === '/' ? origin : `${origin}${discoveredPath}`
}


export async function testConnection(
  serverUrl: string,
  credentials: { username: string; password: string },
  proxyUrl?: string | null
): Promise<boolean> {
  try {
    const fetchFn = proxyUrl ? createProxyFetch(proxyUrl) : webFetch

    const client = await createDAVClient({
      serverUrl,
      credentials: {
        username: credentials.username,
        password: credentials.password,
      },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
      fetch: fetchFn,
    })

    await client.fetchCalendars()
    return true
  } catch {
    return false
  }
}

export interface ProbeResult {
  ok: boolean
  /** HTTP status of the last attempt. Absent when the request never completed. */
  status?: number
  error?: string
  /** Provider-specific guidance for the failure, when we have any. */
  hint?: string
  /** The URL that actually answered. Only set when `ok`. */
  resolvedUrl?: string
}

/**
 * Probe a CalDAV endpoint with the given credentials and report *why* it failed.
 *
 * Unlike `testConnection`, which answers a bare yes/no via tsdav, this issues a
 * raw PROPFIND so the HTTP status survives, letting callers distinguish a bad
 * password (401) from a bad URL (404) from a CORS wall (network throw).
 *
 * `originalUrl` is the URL the user actually typed, before `expandProviderUrl`
 * rewrote it; hints are keyed off that so we suggest the provider they meant.
 */
export async function probeConnection(
  serverUrl: string,
  username: string,
  password: string,
  proxyUrl?: string | null,
  originalUrl?: string
): Promise<ProbeResult> {
  const hintUrl = originalUrl || serverUrl

  try {
    let baseUrl = await discoverServerUrl(serverUrl, proxyUrl ?? undefined)

    const attempt = async (url: string): Promise<{ ok: boolean; status: number }> => {
      const init: RequestInit = {
        method: 'PROPFIND',
        headers: {
          Authorization: `Basic ${btoa(`${username}:${password}`)}`,
          'Content-Type': 'application/xml',
          Depth: '0',
        },
        body: `<?xml version="1.0" encoding="UTF-8"?>
            <d:propfind xmlns:d="DAV:">
              <d:prop>
                <d:displayname/>
              </d:prop>
            </d:propfind>`,
      }

      const response = proxyUrl
        ? await proxyFetch(proxyUrl, url, init)
        : await webFetch(url, init)

      // 207 Multi-Status is the success case for PROPFIND.
      return { ok: response.ok || response.status === 207, status: response.status }
    }

    let result = await attempt(baseUrl)

    // Fallback: if the discovered URL fails, try the original base URL.
    // This handles cases like Radicale where the well-known redirect chain
    // ends at the web UI (/.web/) instead of the CalDAV endpoint (/).
    if (!result.ok) {
      const normalizedBase = serverUrl.replace(/\/$/, '')
      if (baseUrl !== normalizedBase) {
        console.log('[CalDAV] Probe: discovered URL failed (' + result.status + '), trying base URL:', normalizedBase)
        const fallback = await attempt(normalizedBase)
        if (fallback.ok) {
          baseUrl = normalizedBase
          result = fallback
        }
      }
    }

    if (result.ok) {
      return { ok: true, status: result.status, resolvedUrl: baseUrl }
    }

    // Auth failures (401/403) usually mean an app-specific password is
    // needed, not a wrong URL — prefer the auth hint in that case.
    const authFailed = result.status === 401 || result.status === 403
    const hint = (authFailed && suggestAuthHint(hintUrl)) || suggestCalDAVUrl(hintUrl)

    return {
      ok: false,
      status: result.status,
      error: `Server returned status ${result.status}`,
      hint: hint ?? undefined,
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    return {
      ok: false,
      error: `Connection failed: ${errorMsg}. This may be a CORS issue - the server must allow cross-origin requests.`,
      hint: suggestCalDAVUrl(hintUrl) ?? undefined,
    }
  }
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
    return proxyFetch(proxyUrl, url, init)
  }
}

async function proxyFetch(
  proxyUrl: string,
  targetUrl: string,
  init?: RequestInit
): Promise<Response> {
  // The proxy expects the server origin encoded as the first path segment,
  // with the rest of the path as unencoded segments.
  // e.g. proxy.calino.io/https%3A%2F%2Fdav.example.com/principals/user
  const parsed = new URL(targetUrl)
  const encodedOrigin = encodeURIComponent(parsed.origin)
  const path = parsed.pathname + parsed.search + parsed.hash
  const proxyBase = proxyUrl.replace(/\/$/, '')
  const proxiedUrl = `${proxyBase}/${encodedOrigin}${path}`
  return webFetch(proxiedUrl, init)
}

function normalizeUrl(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `https://${url}`
  }
  return url
}
