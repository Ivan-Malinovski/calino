import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { basicAuthHeader } from '@/features/caldav/client/basicAuth'
import { classifyPendingChangeError } from '@/features/caldav/sync/pendingChangePolicy'
import { JMAP_CORE, JMAP_CALENDARS } from '../../types'
import { JmapClient, resultReference } from '../JmapClient'
import { JmapError, parseRetryAfter } from '../errors'
import type { JmapInvocation } from '../session'
import { json, options, session } from './fixtures'

describe('JmapClient', () => {
  const fetchMock = vi.fn<typeof fetch>()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function connected(overrides: Parameters<typeof session>[0] = {}) {
    fetchMock.mockResolvedValueOnce(
      json(session(overrides), {}, 'https://calendar.test/jmap/session')
    )
    const client = new JmapClient(options)
    await client.connect()
    return client
  }

  it('loads a redirected session, resolves templates and uses UTF-8 auth', async () => {
    const client = await connected({ apiUrl: 'api' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://calendar.test/.well-known/jmap')
    expect(init?.redirect).toBe('follow')
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      basicAuthHeader(options.username, options.password)
    )
    expect(client.apiUrl).toBe('https://calendar.test/jmap/api')
    expect(client.accountId).toBe('a')
    expect(client.accountCapabilities[JMAP_CALENDARS]).toEqual({})
    expect(client.username).toBe(options.username)
    expect(client.downloadUrl).toContain('{blobId}')
  })

  it('rejects invalid/core-less sessions and requires connect', async () => {
    const client = new JmapClient(options)
    expect(() => client.session).toThrow('not connected')
    fetchMock.mockResolvedValueOnce(json(session({ capabilities: { [JMAP_CALENDARS]: {} } })))
    await expect(client.connect()).rejects.toMatchObject({ type: 'invalidSession' })
  })

  it('batches methods, sends using and preserves result references in a request', async () => {
    const client = await connected()
    fetchMock.mockResolvedValueOnce(
      json({
        methodResponses: [
          ['Core/echo', { x: 1 }, 'one'],
          ['Core/echo', { x: 2 }, 'two'],
        ],
        sessionState: 's1',
      })
    )
    const reference = resultReference('x', 'one', 'Core/echo', '/x')
    const result = await client.call(
      [
        ['Core/echo', { x: 1 }, 'one'],
        ['Core/echo', reference, 'two'],
      ],
      [JMAP_CORE]
    )
    expect(result.methodResponses).toHaveLength(2)
    const body = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as {
      using: string[]
      methodCalls: JmapInvocation[]
    }
    expect(body.using).toEqual([JMAP_CORE])
    expect(body.methodCalls).toHaveLength(2)
    expect(body.methodCalls[1][1]).toEqual(reference)
    expect(resultReference('ids', 'q', 'CalendarEvent/query', '/ids')).toEqual({
      '#ids': { resultOf: 'q', name: 'CalendarEvent/query', path: '/ids' },
    })
  })

  it('splits /get, merges lists/notFound, and resolves query references', async () => {
    const client = await connected()
    fetchMock.mockResolvedValueOnce(
      json({
        methodResponses: [['CalendarEvent/query', { ids: ['1', '2', '3'] }, 'q']],
        sessionState: 's1',
      })
    )
    fetchMock.mockResolvedValueOnce(
      json({
        methodResponses: [
          [
            'CalendarEvent/get',
            { accountId: 'a', state: 'd1', list: [{ id: '1' }, { id: '2' }], notFound: [] },
            'g',
          ],
        ],
        sessionState: 's1',
      })
    )
    fetchMock.mockResolvedValueOnce(
      json({
        methodResponses: [
          ['CalendarEvent/get', { accountId: 'a', state: 'd1', list: [], notFound: ['3'] }, 'g'],
        ],
        sessionState: 's1',
      })
    )
    const result = await client.call([
      ['CalendarEvent/query', { accountId: 'a' }, 'q'],
      [
        'CalendarEvent/get',
        { accountId: 'a', ...resultReference('ids', 'q', 'CalendarEvent/query', '/ids') },
        'g',
      ],
    ])
    expect(result.methodResponses[1]).toEqual([
      'CalendarEvent/get',
      { accountId: 'a', state: 'd1', list: [{ id: '1' }, { id: '2' }], notFound: ['3'] },
      'g',
    ])
    expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body)).methodCalls[0][1].ids).toEqual([
      '3',
    ])
  })

  it('resolves escaped JSON pointers and wildcards across request limits', async () => {
    const client = await connected({
      capabilities: { [JMAP_CORE]: { maxCallsInRequest: 1 }, [JMAP_CALENDARS]: {} },
    })
    fetchMock.mockResolvedValueOnce(
      json({
        methodResponses: [['CalendarEvent/get', { 'a/b': [{ '~id': '1' }, { '~id': '2' }] }, 'g']],
        sessionState: 's1',
      })
    )
    fetchMock.mockResolvedValueOnce(
      json({ methodResponses: [['Core/echo', {}, 'e']], sessionState: 's1' })
    )
    await client.call([
      ['CalendarEvent/get', {}, 'g'],
      ['Core/echo', resultReference('ids', 'g', 'CalendarEvent/get', '/a~1b/*/~0id'), 'e'],
    ])
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body)).methodCalls[0][1]).toEqual({
      ids: ['1', '2'],
    })
  })

  it('splits /set by combined create/update/destroy count and carries creation ids/ifInState', async () => {
    const client = await connected()
    fetchMock.mockResolvedValueOnce(
      json({
        methodResponses: [
          [
            'CalendarEvent/set',
            {
              oldState: 'd0',
              newState: 'd1',
              created: { first: { id: 'real' } },
              updated: { u: null },
            },
            's',
          ],
        ],
        sessionState: 's1',
        createdIds: { first: 'real' },
      })
    )
    fetchMock.mockResolvedValueOnce(
      json({
        methodResponses: [
          [
            'CalendarEvent/set',
            { oldState: 'd1', newState: 'd2', created: null, destroyed: ['gone'] },
            's',
          ],
        ],
        sessionState: 's1',
      })
    )
    const result = await client.call([
      [
        'CalendarEvent/set',
        {
          accountId: 'a',
          ifInState: 'd0',
          create: { first: { title: 'New' } },
          update: { u: { title: 'Updated' } },
          destroy: ['gone'],
        },
        's',
      ],
    ])
    const body = JSON.parse(String(fetchMock.mock.calls[2][1]?.body))
    expect(body.createdIds).toEqual({ first: 'real' })
    expect(body.methodCalls[0][1]).toEqual({ accountId: 'a', ifInState: 'd1', destroy: ['gone'] })
    expect(result.methodResponses[0][1]).toMatchObject({
      oldState: 'd0',
      newState: 'd2',
      created: { first: { id: 'real' } },
      destroyed: ['gone'],
    })
  })

  it('splits batches at maxCallsInRequest', async () => {
    const client = await connected({
      capabilities: { [JMAP_CORE]: { maxCallsInRequest: 1 }, [JMAP_CALENDARS]: {} },
    })
    fetchMock.mockResolvedValueOnce(
      json({ methodResponses: [['Core/echo', {}, '1']], sessionState: 's1' })
    )
    fetchMock.mockResolvedValueOnce(
      json({ methodResponses: [['Core/echo', {}, '2']], sessionState: 's1' })
    )
    expect(
      (
        await client.call([
          ['Core/echo', {}, '1'],
          ['Core/echo', {}, '2'],
        ])
      ).methodResponses
    ).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('rejects mixed-state split reads', async () => {
    const client = await connected()
    for (const state of ['d1', 'd2'])
      fetchMock.mockResolvedValueOnce(
        json({
          methodResponses: [['CalendarEvent/get', { state, list: [] }, 'g']],
          sessionState: 's1',
        })
      )
    await expect(
      client.call([['CalendarEvent/get', { ids: ['1', '2', '3'] }, 'g']])
    ).rejects.toMatchObject({ status: 412, type: 'stateMismatch' })
  })

  it('refreshes session URLs and limits when sessionState changes', async () => {
    const client = await connected()
    fetchMock.mockResolvedValueOnce(
      json({ methodResponses: [['Core/echo', {}, 'e']], sessionState: 's2' })
    )
    fetchMock.mockResolvedValueOnce(
      json(session({ state: 's2', apiUrl: '/new-api' }), {}, 'https://calendar.test/jmap/session')
    )
    await client.call([['Core/echo', {}, 'e']])
    expect(fetchMock.mock.calls[2][0]).toBe('https://calendar.test/jmap/session')
    expect(client.apiUrl).toBe('https://calendar.test/new-api')
    expect(client.session.state).toBe('s2')
  })

  it.each([
    [401, 'auth'],
    [403, 'forbidden'],
    [429, 'rate-limited'],
    [500, 'server'],
    [507, 'quota'],
    [404, 'not-found'],
  ])('maps HTTP %s to %s', async (status, code) => {
    const client = await connected()
    fetchMock.mockResolvedValueOnce(
      json(
        { type: 'urn:ietf:params:jmap:error:notJSON' },
        { status: Number(status), headers: { 'Retry-After': '120' } }
      )
    )
    await expect(client.call([['Core/echo', {}, 'e']])).rejects.toMatchObject({
      code,
      status,
      retryAfter: 120,
      type: 'urn:ietf:params:jmap:error:notJSON',
    })
  })

  it.each([
    'unknownMethod',
    'accountNotFound',
    'invalidArguments',
    'serverFail',
    'requestTooLarge',
    'limit',
    'rateLimit',
    'forbidden',
  ])('throws typed method error %s', async (type) => {
    const client = await connected()
    fetchMock.mockResolvedValueOnce(
      json(
        { methodResponses: [['error', { type, description: 'Detail' }, 'e']], sessionState: 's1' },
        { headers: { 'Retry-After': '7' } }
      )
    )
    await expect(client.call([['Core/echo', {}, 'e']])).rejects.toMatchObject({
      type,
      callId: 'e',
      method: 'Core/echo',
      retryAfter: 7,
    })
  })

  it('maps fetch failures and aborts without status; queue retries network failures without counting', async () => {
    const client = await connected()
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const error = await client.call([['Core/echo', {}, 'e']]).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(JmapError)
    expect(error).toMatchObject({ code: 'network', status: undefined })
    expect(classifyPendingChangeError(error, 'update')).toEqual({ kind: 'retry' })
    fetchMock.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'))
    await expect(client.call([['Core/echo', {}, 'e']])).rejects.toMatchObject({ code: 'timeout' })
  })

  it('uses validated direct custom headers on every JSON request', async () => {
    fetchMock.mockResolvedValueOnce(json(session()))
    const client = new JmapClient({ ...options, customHeaders: { 'X-Gateway-Key': 'secret' } })
    await client.connect()
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('X-Gateway-Key')).toBe('secret')
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe('error')
    expect(() => new JmapClient({ ...options, customHeaders: { Authorization: 'bad' } })).toThrow(
      'reserved'
    )
    expect(
      () =>
        new JmapClient({
          ...options,
          customHeaders: { 'X-Key': 'value' },
          proxyUrl: 'https://proxy.test',
        })
    ).toThrow('direct DAV')
  })

  it('follows proxy-side redirects, resolves against upstream and prefixes exactly once', async () => {
    const proxyUrl = 'https://proxy.test'
    fetchMock.mockResolvedValueOnce(
      json(
        session({ apiUrl: 'api' }),
        { headers: { 'X-Target-URL': 'https://calendar.test/jmap/session' } },
        'https://proxy.test/https%3A%2F%2Fcalendar.test/.well-known/jmap'
      )
    )
    const client = new JmapClient({ ...options, proxyUrl })
    await client.connect()
    expect(client.apiUrl).toBe('https://proxy.test/https%3A%2F%2Fcalendar.test/jmap/api')
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('X-Follow-Redirects')).toBe('1')
    fetchMock.mockResolvedValueOnce(
      json({ methodResponses: [['Core/echo', {}, 'e']], sessionState: 's1' })
    )
    await client.call([['Core/echo', {}, 'e']])
    expect(fetchMock.mock.calls[1][0]).toBe(client.apiUrl)
    fetchMock.mockResolvedValueOnce(json({ blobId: 'blob', size: 1, type: 'text/plain' }))
    await client.upload(new Uint8Array([65]).buffer, 'text/plain')
    expect(fetchMock.mock.calls[2][0]).toBe(
      'https://proxy.test/https%3A%2F%2Fcalendar.test/upload/a'
    )
  })

  it('uploads binary and downloads with encoded template variables', async () => {
    const client = await connected()
    fetchMock.mockResolvedValueOnce(
      json({ blobId: 'b', size: 3, type: 'application/octet-stream' })
    )
    const blob = new Uint8Array([0, 128, 255]).buffer
    expect(await client.upload(blob, 'application/octet-stream')).toEqual({
      blobId: 'b',
      size: 3,
      type: 'application/octet-stream',
    })
    expect(fetchMock.mock.calls[1][1]?.body).toBe(blob)
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([0, 128, 255])))
    await client.download('b/id', 'résumé.ics', 'text/calendar')
    expect(fetchMock.mock.calls[2][0]).toBe(
      'https://calendar.test/download/a/b%2Fid/r%C3%A9sum%C3%A9.ics?type=text%2Fcalendar'
    )
  })

  it('honors the DAV Retry-After clamp and HTTP-date form', () => {
    expect(parseRetryAfter('99999')).toBe(3600)
    expect(parseRetryAfter('bad')).toBeUndefined()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:10 GMT')).toBe(10)
  })

  it('rejects unsafe implicit split sets without submitting them', async () => {
    const client = await connected()
    await expect(
      client.call([
        ['CalendarEvent/set', { destroy: ['1', '2', '3'], onSuccessDestroyOriginal: true }, 's'],
      ])
    ).rejects.toMatchObject({ type: 'limit', status: 413 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retains successful peers on method errors and leaves per-object set failures to the backend', async () => {
    const client = await connected()
    const methodResponses: JmapInvocation[] = [
      ['Core/echo', {}, 'ok'],
      ['error', { type: 'serverFail' }, 'bad'],
    ]
    fetchMock.mockResolvedValueOnce(json({ methodResponses, sessionState: 's1' }))
    await expect(
      client.call([
        ['Core/echo', {}, 'ok'],
        ['Core/echo', {}, 'bad'],
      ])
    ).rejects.toMatchObject({ methodResponses, status: 500 })
    fetchMock.mockResolvedValueOnce(
      json({
        methodResponses: [['CalendarEvent/set', { notUpdated: { e: { type: 'forbidden' } } }, 's']],
        sessionState: 's1',
      })
    )
    expect(
      (await client.call([['CalendarEvent/set', { update: { e: { title: 'New' } } }, 's']]))
        .methodResponses[0][1]
    ).toEqual({ notUpdated: { e: { type: 'forbidden' } } })
  })
})
