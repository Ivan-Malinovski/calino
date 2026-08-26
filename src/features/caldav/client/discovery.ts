import { createDAVClient } from 'tsdav'
import { webFetch } from '@/lib/webFetch'
import { basicAuthHeader } from './basicAuth'
import i18n from '@/lib/i18n'

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
     * i18n key for guidance shown when the server rejects the credentials
     * (401/403). Many providers (Fastmail, iCloud, Google) reject the account
     * login password and require a provider-generated app-specific password.
     */
    authHintKey: string | null
  }
> = {
  'fastmail.com': {
    baseUrl: 'https://caldav.fastmail.com',
    urlTemplate: 'https://caldav.fastmail.com/dav/principals/user/{email}/',
    authHintKey: 'errors:connection.fastmailAuthHint',
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
  } catch {
    /* invalid URL — ignore */
  }
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
        return i18n.t('errors:connection.urlHint', {
          domain,
          url: info.urlTemplate.replace('{email}', 'your-email@' + domain),
        })
      }
    }
  } catch {
    /* invalid URL — ignore */
  }
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
        return info.authHintKey ? i18n.t(info.authHintKey) : null
      }
    }
  } catch {
    /* invalid URL — ignore */
  }
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
        console.log(
          '[CalDAV] Discovery: probe returned .well-known/caldav as base — proxy likely followed redirect. Falling back.'
        )
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
 * Does this status come from something that speaks DAV?
 *
 * 207 is the success case; 401 counts too, because an auth challenge means the
 * endpoint understood the method and only wants credentials. A 403/404/500 is
 * what a non-DAV URL answers — which matters because `discoverServerUrl`
 * follows the whole redirect chain, and on some servers that runs past the DAV
 * endpoint into a web interface (Radicale sends /.well-known/caldav → / →
 * /.web). Callers use this to decide whether to fall back to the URL the user
 * actually entered.
 *
 * `probeConnection` below deliberately keeps a laxer test of its own — it also
 * accepts any 2xx — because it predates this and tightening it would change
 * which servers pass setup.
 */
export function isDavStatus(status: number): boolean {
  return status === 207 || status === 401
}

/**
 * Probe /.well-known/caldav and follow the redirect to the real CalDAV base.
 * Returns null if the server doesn't support well-known (e.g. returns 404).
 */
async function probeWellKnown(baseUrl: string, proxyUrl?: string): Promise<string | null> {
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
async function probeWellKnownDirect(wellKnownUrl: string, baseUrl: string): Promise<string | null> {
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

/**
 * Proxy fetch: ask the proxy to follow the upstream redirect chain itself
 * (X-Follow-Redirects — see proxy/server.mjs). The browser cannot do it: a
 * cross-origin Location the proxy relays fails CORS when followed, and
 * `redirect: 'manual'` comes back opaque, headers unreadable. With the chain
 * followed proxy-side, X-Target-URL reports the final URL.
 *
 * The probe is a PROPFIND (not GET): a DAV server redirects it exactly like
 * the GET the RFC suggests, but the *final* answer is then a 207/401 that
 * `isDavStatus` can validate — a followed chain that overshoots into a web
 * interface (Radicale → / → /.web) ends in 404/405 and is rejected instead
 * of being adopted as the CalDAV endpoint.
 */
async function probeWellKnownViaProxy(
  wellKnownUrl: string,
  baseUrl: string,
  proxyUrl: string
): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS)
  try {
    const response = await proxyFetch(proxyUrl, wellKnownUrl, {
      method: 'PROPFIND',
      headers: {
        'X-Follow-Redirects': '1',
        Depth: '0',
      },
      redirect: 'follow',
      signal: controller.signal,
    })

    // Final URL of a followed chain (new proxies), or the originally
    // requested URL (old proxies / no redirect happened).
    const targetUrl = response.headers.get('X-Target-URL')
    if (targetUrl) {
      const finalUrl = new URL(targetUrl)
      const finalPath = finalUrl.pathname
      if (isWellKnownPath(finalPath)) {
        // Still on .well-known: no redirect happened → unsupported.
        return null
      }
      // The chain moved somewhere — only trust it when the final endpoint
      // actually spoke DAV to the PROPFIND.
      if (isDavStatus(response.status)) {
        return buildBaseUrl(baseUrl, finalPath, finalUrl.origin)
      }
      return null
    }

    // Old proxy relaying the 3xx with an exposed Location: the redirect is
    // the server's own declaration of its CalDAV endpoint (RFC 6764 §5), so
    // resolve it and hand it back — probeConnection verifies it afterwards.
    const location = response.headers.get('Location')
    if (response.status >= 300 && response.status < 400 && location) {
      try {
        const resolved = new URL(location, wellKnownUrl)
        if (!isWellKnownPath(resolved.pathname)) {
          return buildBaseUrl(baseUrl, resolved.pathname, resolved.origin)
        }
      } catch {
        // Malformed Location — fall through.
      }
      return null
    }

    // No X-Target-URL: infer from status.
    // 401/403 could mean the redirect requires authentication — we can't
    // determine the actual path, so fall back to base URL.
    if (response.status === 401 || response.status === 403) {
      return null
    }

    // Anything else (200/404/405 at .well-known itself) — unsupported.
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
  proxyUrl?: string | null,
  authMode: 'basic' | 'browser-session' = 'basic'
): Promise<boolean> {
  try {
    const fetchFn = proxyUrl ? createProxyFetch(proxyUrl) : webFetch

    const client = await createDAVClient({
      serverUrl,
      credentials: {
        username: credentials.username,
        password: credentials.password,
      },
      authMethod: 'Custom',
      authFunction: async (): Promise<Record<string, string>> =>
        authMode === 'browser-session'
          ? {}
          : { Authorization: basicAuthHeader(credentials.username, credentials.password) },
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
  originalUrl?: string,
  authMode: 'basic' | 'browser-session' = 'basic'
): Promise<ProbeResult> {
  const hintUrl = originalUrl || serverUrl

  try {
    let baseUrl = await discoverServerUrl(serverUrl, proxyUrl ?? undefined)

    const attempt = async (url: string): Promise<{ ok: boolean; status: number }> => {
      const init: RequestInit = {
        method: 'PROPFIND',
        headers: {
          ...(authMode === 'browser-session'
            ? {}
            : { Authorization: basicAuthHeader(username, password) }),
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

      const response = proxyUrl ? await proxyFetch(proxyUrl, url, init) : await webFetch(url, init)

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
        console.log(
          '[CalDAV] Probe: discovered URL failed (' + result.status + '), trying base URL:',
          normalizedBase
        )
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
      error: i18n.t('errors:connection.badStatus', { status: result.status }),
      hint: hint ?? undefined,
    }
  } catch (error) {
    const errorMsg =
      error instanceof Error ? error.message : i18n.t('errors:connection.unknownError')
    return {
      ok: false,
      error: i18n.t('errors:connection.failedGeneric', { message: errorMsg }),
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

export async function proxyFetch(
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
