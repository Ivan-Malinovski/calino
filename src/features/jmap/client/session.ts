import { basicAuthHeader } from '@/features/caldav/client/basicAuth'
import { createDirectDavFetch, validateCustomHeaders } from '@/features/caldav/client/customHeaders'
import {
  createProxyFetch,
  fetchWithTimeout,
  prefixUrlWithProxy,
} from '@/features/caldav/client/CalDAVClient'
import { webFetch } from '@/lib/webFetch'
import { JMAP_CALENDARS, JMAP_CORE, type JsonObject } from '../types'
import { assertJmapResponse, JmapError, transportError } from './errors'

export interface JmapClientOptions {
  serverUrl: string
  username: string
  password: string
  customHeaders?: Record<string, string>
  proxyUrl?: string | null
}

export type JmapInvocation = [name: string, arguments: JsonObject, callId: string]
export interface JmapResponse {
  methodResponses: JmapInvocation[]
  sessionState: string
  createdIds?: Record<string, string>
}
export interface JmapAccount {
  name: string
  isPersonal: boolean
  isReadOnly: boolean
  accountCapabilities: Record<string, JsonObject>
}
export interface JmapSession {
  capabilities: Record<string, JsonObject>
  accounts: Record<string, JmapAccount>
  primaryAccounts: Record<string, string>
  username: string
  apiUrl: string
  uploadUrl: string
  downloadUrl: string
  eventSourceUrl: string
  state: string
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeJmapUrl(url: string): string {
  const trimmed = url.trim()
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    throw new JmapError('Enter an HTTP(S) server URL')
  }
  const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new JmapError('Enter an HTTP(S) server URL without embedded credentials')
  }
  parsed.hash = ''
  return parsed.href
}

export function sessionCandidates(url: string): string[] {
  const parsed = new URL(normalizeJmapUrl(url))
  if (/\/(?:jmap\/session|\.well-known\/jmap)\/?$/.test(parsed.pathname)) return [parsed.href]
  const candidates = [new URL('/.well-known/jmap', parsed).href]
  if (parsed.pathname !== '/') {
    parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/.well-known/jmap`
    parsed.search = ''
    candidates.push(parsed.href)
  }
  return candidates
}

export function parseSession(value: unknown): JmapSession {
  if (
    !isObject(value) ||
    !isObject(value.capabilities) ||
    !isObject(value.capabilities[JMAP_CORE]) ||
    !isObject(value.accounts) ||
    !isObject(value.primaryAccounts) ||
    !['username', 'apiUrl', 'uploadUrl', 'downloadUrl', 'eventSourceUrl', 'state'].every(
      (key) => typeof value[key] === 'string'
    ) ||
    !Object.values(value.capabilities).every(isObject) ||
    !Object.values(value.primaryAccounts).every((id) => typeof id === 'string') ||
    !Object.values(value.accounts).every(
      (account) =>
        isObject(account) &&
        typeof account.name === 'string' &&
        typeof account.isPersonal === 'boolean' &&
        typeof account.isReadOnly === 'boolean' &&
        isObject(account.accountCapabilities) &&
        Object.values(account.accountCapabilities).every(isObject)
    )
  ) {
    throw new JmapError('Invalid JMAP session document or missing core capability', {
      type: 'invalidSession',
    })
  }
  return value as unknown as JmapSession
}

export function calendarAccountId(session: JmapSession): string | undefined {
  const id = session.primaryAccounts[JMAP_CALENDARS]
  return isObject(session.capabilities[JMAP_CALENDARS]) &&
    id &&
    isObject(session.accounts[id]?.accountCapabilities[JMAP_CALENDARS])
    ? id
    : undefined
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '[::1]' || /^127\./.test(hostname)
}

/** Preserve URI template variables while resolving relative session URLs. */
export function resolveTemplate(url: string, base: string): string {
  const resolved = new URL(url, base)
  // A server configured as `localhost` (Stalwart's default) advertises
  // https://localhost/... even when it was reached elsewhere. Only loopback
  // advertisements are rebased onto the origin we already talk to, so a server
  // cannot redirect credentials to a third-party host.
  const reached = new URL(base)
  if (resolved.origin !== reached.origin && isLoopbackHost(resolved.hostname)) {
    resolved.protocol = reached.protocol
    resolved.host = reached.host
  }
  if (!['http:', 'https:'].includes(resolved.protocol) || resolved.username || resolved.password) {
    throw new JmapError('Invalid JMAP endpoint URL', { type: 'invalidSession' })
  }
  return resolved.href.replace(/%7B/gi, '{').replace(/%7D/gi, '}')
}

export function expandTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/g, (_, key: string) => {
    if (!(key in values)) throw new JmapError(`Unsupported JMAP URL template variable: ${key}`)
    return encodeURIComponent(values[key])
  })
}

/** Normal JSON calls share DAV plumbing. Discovery supplies its own shorter timeout. */
export function createJmapTransport(opts: JmapClientOptions) {
  const serverUrl = normalizeJmapUrl(opts.serverUrl)
  validateCustomHeaders(opts.customHeaders ?? {}, opts.proxyUrl)
  const headers = { Authorization: basicAuthHeader(opts.username, opts.password) }
  const fetchJson = opts.proxyUrl
    ? createProxyFetch(opts.proxyUrl)
    : createDirectDavFetch(serverUrl, opts.customHeaders, fetchWithTimeout)
  const raw = (transport: typeof fetch) =>
    createDirectDavFetch(serverUrl, opts.proxyUrl ? {} : opts.customHeaders, transport)
  const targetUrl = (url: string) =>
    opts.proxyUrl
      ? prefixUrlWithProxy(url, opts.proxyUrl).replace(/%7B/gi, '{').replace(/%7D/gi, '}')
      : url
  return {
    headers,
    targetUrl,
    responseUrl(response: Response, fallback: string): string {
      const upstream = response.headers.get('X-Target-URL')
      if (upstream) return upstream
      const final = response.url || fallback
      return opts.proxyUrl && final.startsWith(opts.proxyUrl.replace(/\/$/, '') + '/')
        ? fallback
        : final
    },
    async request(url: string, init: RequestInit = {}): Promise<Response> {
      const merged = new Headers(init.headers)
      merged.set('Authorization', headers.Authorization)
      try {
        return await fetchJson(url, { ...init, headers: merged })
      } catch (error) {
        throw transportError(error)
      }
    },
    // Abortable discovery, or binary/streaming requests which the native text bridge cannot carry.
    async rawRequest(
      url: string,
      init: RequestInit,
      transport: typeof fetch = webFetch
    ): Promise<Response> {
      const merged = new Headers(init.headers)
      merged.set('Authorization', headers.Authorization)
      if (opts.proxyUrl && init.method === 'GET') merged.set('X-Follow-Redirects', '1')
      try {
        return await raw(transport)(targetUrl(url), { ...init, headers: merged })
      } catch (error) {
        throw transportError(error)
      }
    },
  }
}

export type JmapTransport = ReturnType<typeof createJmapTransport>

export async function fetchSession(
  transport: JmapTransport,
  url: string,
  timeoutMs = 8000,
  checkResponse = true
): Promise<{ response: Response; session: JmapSession; sessionUrl: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await transport.rawRequest(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (checkResponse) await assertJmapResponse(response)
    const session = parseSession(await response.json())
    // X-Target-URL is the upstream final URL when the account proxy follows redirects.
    const sessionUrl = transport.responseUrl(response, url)
    return { response, session, sessionUrl }
  } finally {
    clearTimeout(timer)
  }
}
