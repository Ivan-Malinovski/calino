import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeConnection } from '../discovery'
import { connectionErrorMessage } from '../errorMessages'
import { createCalendarBackend } from '../createBackend'
import { jmapMockResponse } from '../../../../../e2e/fixtures/vite-jmap-mock'
import { json, session } from '@/features/jmap/client/__tests__/fixtures'

const serverUrl = 'https://calendar.test'
const probe = (options = {}) =>
  probeConnection(serverUrl, 'test-user', 'test-password', undefined, undefined, {}, options)

function jmapFetch(failApi?: () => Response | Promise<never>) {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') {
      if (failApi) return failApi()
      const body = JSON.parse(init.body as string)
      expect(body.methodCalls[0][1].accountId).toBe('a')
      return json({
        sessionState: 's1',
        methodResponses: [
          ['Calendar/get', { accountId: 'a', state: 'c1', list: [], notFound: [] }, 'probe'],
        ],
      })
    }
    return json(session())
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('calendar connection protocol', () => {
  it('prefers JMAP and uses the real session account id without any DAV requests', async () => {
    const fetchMock = jmapFetch()
    vi.stubGlobal('fetch', fetchMock)
    expect(await probe()).toMatchObject({
      ok: true,
      protocol: 'jmap',
      resolvedUrl: `${serverUrl}/.well-known/jmap`,
    })
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== 'PROPFIND')).toBe(true)
  })

  it('the browser fixture drives discovery and the real JMAP calendar backend offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (!new URL(url).pathname.startsWith('/mock-jmap'))
          return new Response(null, { status: 404 })
        const response = jmapMockResponse(
          url,
          init?.method ?? 'GET',
          init?.body as string | undefined
        )
        return new Response(response.body, { status: response.status, headers: response.headers })
      })
    )
    const result = await probeConnection(
      `${serverUrl}/mock-jmap`,
      'fixture-user',
      'fixture-password'
    )
    expect(result).toMatchObject({ ok: true, protocol: 'jmap' })
    const backend = await createCalendarBackend(
      result.resolvedUrl!,
      {
        id: 'fixture-credential',
        serverUrl: result.resolvedUrl!,
        username: 'fixture-user',
        password: 'fixture-password',
      },
      null,
      result.protocol
    )
    const calendars = await backend.fetchCalendars()
    expect(calendars[0]).toMatchObject({
      name: 'JMAP Personal',
      readOnly: false,
      supportedComponents: ['VEVENT'],
    })
    expect(
      await backend.fetchEvents(
        calendars[0].url,
        '2026-01-01T00:00:00Z',
        '2027-01-01T00:00:00Z',
        true
      )
    ).toEqual({ objects: [], hadComponentFailures: false })
  })

  it('reports a JMAP authentication failure without falling through to DAV', async () => {
    const fetchMock = vi.fn(async () =>
      json({}, { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="JMAP"' } })
    )
    vi.stubGlobal('fetch', fetchMock)
    const result = await probe()
    expect(result).toMatchObject({ ok: false, protocol: 'jmap', status: 401, code: 'auth' })
    expect(connectionErrorMessage(result.error!, result.code)).toBe(
      'The server rejected these credentials.'
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to CalDAV when there is no JMAP session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('/.well-known/jmap')) return new Response(null, { status: 404 })
        if (init?.method === 'PROPFIND') return new Response(null, { status: 207 })
        const response = new Response(null)
        Object.defineProperty(response, 'url', { value: `${serverUrl}/dav/` })
        return response
      })
    )
    expect(await probe()).toMatchObject({
      ok: true,
      protocol: 'caldav',
      resolvedUrl: `${serverUrl}/dav/`,
    })
  })

  it('force-CalDAV skips every JMAP session request even on a dual-protocol server', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).not.toContain('jmap')
      if (init?.method === 'PROPFIND') return new Response(null, { status: 207 })
      const response = new Response(null)
      Object.defineProperty(response, 'url', { value: `${serverUrl}/dav/` })
      return response
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(await probe({ forceCalDAV: true })).toMatchObject({ ok: true, protocol: 'caldav' })
  })

  it('keeps stored CalDAV accounts on CalDAV when the server later adds JMAP', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).not.toContain('jmap')
      return new Response(null, { status: 207 })
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(await probe({ protocol: 'caldav' })).toMatchObject({ ok: true, protocol: 'caldav' })
  })

  it('reports missing calendar capability for an explicit JMAP session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(
          session({
            capabilities: { 'urn:ietf:params:jmap:core': {} },
            primaryAccounts: {},
          })
        )
      )
    )
    const result = await probeConnection(`${serverUrl}/jmap/session`, 'test-user', 'test-password')
    expect(result).toMatchObject({ ok: false, protocol: 'jmap', code: 'unknown' })
    expect(result.error).toBe('This JMAP account does not support calendars.')
  })

  it.each(['Failed to fetch', 'CORS blocked'])('surfaces JMAP API failure: %s', async (message) => {
    vi.stubGlobal(
      'fetch',
      jmapFetch(() => Promise.reject(new Error(message)))
    )
    const result = await probe()
    expect(result).toMatchObject({
      ok: false,
      protocol: 'jmap',
      code: message.includes('CORS') ? 'cors' : 'network',
    })
    expect(connectionErrorMessage(result.error!, result.code)).toContain('JMAP')
  })

  it('does not downgrade an unreachable stored JMAP account', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('GET')
      throw new Error('Failed to fetch')
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(await probe({ protocol: 'jmap' })).toMatchObject({
      ok: false,
      protocol: 'jmap',
      code: 'network',
    })
  })

  it('carries custom headers through detection, session load and API calls', async () => {
    const fetchMock = jmapFetch()
    vi.stubGlobal('fetch', fetchMock)
    const result = await probeConnection(
      serverUrl,
      'test-user',
      'test-password',
      undefined,
      undefined,
      { 'X-Test-Gateway': 'fixture-value' }
    )
    expect(result.ok).toBe(true)
    for (const [, init] of fetchMock.mock.calls) {
      const headers = new Headers(init?.headers)
      expect(headers.get('X-Test-Gateway')).toBe('fixture-value')
      expect(headers.has('Authorization')).toBe(true)
    }
  })

  it('uses the configured proxy for all JMAP traffic and stores the upstream URL', async () => {
    const fetchMock = jmapFetch()
    vi.stubGlobal('fetch', fetchMock)
    const result = await probeConnection(
      serverUrl,
      'test-user',
      'test-password',
      'https://proxy.test'
    )
    expect(result).toMatchObject({
      ok: true,
      protocol: 'jmap',
      resolvedUrl: `${serverUrl}/.well-known/jmap`,
    })
    expect(
      fetchMock.mock.calls.every(([url]) => String(url).startsWith('https://proxy.test/'))
    ).toBe(true)
  })

  it('reports Calendar/get permission failures as JMAP without DAV fallback', async () => {
    vi.stubGlobal(
      'fetch',
      jmapFetch(() => json({}, { status: 403 }))
    )
    expect(await probe()).toMatchObject({
      ok: false,
      protocol: 'jmap',
      status: 403,
      code: 'forbidden',
    })
  })
})

const env =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
const live = Boolean(
  env.CALINO_TEST_JMAP_URL && env.CALINO_TEST_JMAP_USER && env.CALINO_TEST_JMAP_PASS
)
it.skipIf(!live)(
  'live: auto-detects JMAP and validates the calendar account',
  async () => {
    const result = await probeConnection(
      env.CALINO_TEST_JMAP_URL!,
      env.CALINO_TEST_JMAP_USER!,
      env.CALINO_TEST_JMAP_PASS!
    )
    // Do not include errors or connection options in assertion output: they may contain server data.
    expect(result.ok).toBe(true)
    expect(result.protocol).toBe('jmap')
  },
  30_000
)
