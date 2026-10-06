import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JMAP_CALENDARS, JMAP_CORE } from '../../types'
import { detectProtocol } from '../detect'
import { json, options, session } from './fixtures'

describe('protocol detection', () => {
  const fetchMock = vi.fn<typeof fetch>()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('chooses JMAP when calendars are available, including servers also supporting DAV', async () => {
    fetchMock.mockResolvedValueOnce(json(session(), {}, 'https://calendar.test/jmap/session'))
    expect(await detectProtocol(options)).toEqual({
      protocol: 'jmap',
      session: session(),
      serverUrl: 'https://calendar.test/jmap/session',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    'calendar.test',
    'https://calendar.test',
    'http://localhost:18080',
    'https://calendar.test/jmap/session',
    'https://calendar.test/.well-known/jmap/',
  ])('normalizes typed URL %s', async (serverUrl) => {
    fetchMock.mockResolvedValueOnce(json(session()))
    const result = await detectProtocol({ ...options, serverUrl })
    expect(result.protocol).toBe('jmap')
    const expected = serverUrl.includes('localhost')
      ? 'http://localhost:18080/.well-known/jmap'
      : serverUrl.includes('/jmap/session') || serverUrl.includes('/.well-known')
        ? serverUrl
        : 'https://calendar.test/.well-known/jmap'
    expect(fetchMock.mock.calls[0][0]).toBe(expected)
  })

  it('tries origin then typed path without provider-specific rewriting', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }))
    fetchMock.mockResolvedValueOnce(json(session()))
    expect(
      (await detectProtocol({ ...options, serverUrl: 'https://calendar.test/tenant/?query=1' }))
        .protocol
    ).toBe('jmap')
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'https://calendar.test/.well-known/jmap',
      'https://calendar.test/tenant/.well-known/jmap',
    ])
  })

  it.each([404, 405])('falls through on %s', async (status) => {
    fetchMock.mockResolvedValueOnce(new Response('', { status }))
    expect(await detectProtocol(options)).toEqual({ protocol: 'caldav' })
  })

  it('falls through on HTML/login redirects/non-JSON', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<html>Login</html>', { headers: { 'Content-Type': 'text/html' } })
    )
    expect(await detectProtocol(options)).toEqual({ protocol: 'caldav' })
    fetchMock.mockResolvedValueOnce(json({ message: 'Login' }, {}, 'https://calendar.test/login'))
    expect(await detectProtocol(options)).toEqual({ protocol: 'caldav' })
  })

  it('throws auth for a JSON 401 challenge instead of trying CalDAV', async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        { type: 'unauthorized' },
        { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="JMAP"' } }
      )
    )
    await expect(
      detectProtocol({ ...options, serverUrl: 'https://calendar.test/dav' })
    ).rejects.toMatchObject({ code: 'auth', status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('ignores generic/HTML 401 challenges', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<html>Unauthorized</html>', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic' },
      })
    )
    expect(await detectProtocol(options)).toEqual({ protocol: 'caldav' })
  })

  it.each([
    session({ capabilities: { [JMAP_CORE]: {} } }),
    session({
      accounts: {
        a: { name: 'Mail only', isPersonal: true, isReadOnly: false, accountCapabilities: {} },
      },
    }),
    session({ primaryAccounts: { [JMAP_CALENDARS]: 'missing' } }),
    session({ capabilities: { [JMAP_CALENDARS]: {} } }),
  ])(
    'requires core/global/account calendar capabilities and valid primary account',
    async (value) => {
      fetchMock.mockResolvedValueOnce(json(value))
      expect(await detectProtocol(options)).toEqual({ protocol: 'caldav' })
    }
  )

  it('falls through on CORS/network failures', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await detectProtocol(options)).toEqual({ protocol: 'caldav' })
  })

  it('aborts discovery at 8 seconds', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementationOnce(
      (_, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          )
        })
    )
    const result = detectProtocol(options)
    await vi.advanceTimersByTimeAsync(8000)
    expect(await result).toEqual({ protocol: 'caldav' })
  })
})
