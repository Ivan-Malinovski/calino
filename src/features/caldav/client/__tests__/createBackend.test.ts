import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createCalDAVClient = vi.fn()
vi.mock('../CalDAVClient', () => ({
  createCalDAVClient: (...args: unknown[]) => createCalDAVClient(...args),
}))

import { createCalendarBackend, resetBackendPool } from '../createBackend'

const credentials = {
  id: 'c1',
  serverUrl: 'https://dav.test/',
  username: 'user',
  password: 'pw',
}
const connect = (overrides: Partial<typeof credentials> = {}, url = 'https://dav.test/') =>
  createCalendarBackend(url, { ...credentials, ...overrides }, null, 'caldav')

describe('createCalendarBackend pooling (#257)', () => {
  beforeEach(() => {
    resetBackendPool()
    createCalDAVClient.mockReset()
    createCalDAVClient.mockImplementation(async () => ({ protocol: 'caldav', id: Math.random() }))
  })
  afterEach(() => vi.useRealTimers())

  it('connects once and hands the same client to every later caller', async () => {
    const first = await connect()
    const second = await connect()
    expect(second).toBe(first)
    expect(createCalDAVClient).toHaveBeenCalledTimes(1)
  })

  it('shares one connect between callers that arrive while it is in flight', async () => {
    const [a, b] = await Promise.all([connect(), connect()])
    expect(a).toBe(b)
    expect(createCalDAVClient).toHaveBeenCalledTimes(1)
  })

  it('does not reuse a client across different credentials, servers or proxies', async () => {
    const base = await connect()
    expect(await connect({ password: 'other' })).not.toBe(base)
    expect(await connect({}, 'https://other.test/')).not.toBe(base)
    expect(
      await createCalendarBackend('https://dav.test/', credentials, 'https://proxy.test/', 'caldav')
    ).not.toBe(base)
    expect(createCalDAVClient).toHaveBeenCalledTimes(4)
  })

  it('connects a new client when asked for a fresh one, and leaves the pool alone', async () => {
    const pooled = await connect()
    const fresh = await createCalendarBackend('https://dav.test/', credentials, null, 'caldav', {
      fresh: true,
    })
    expect(fresh).not.toBe(pooled)
    expect(await connect()).toBe(pooled)
  })

  it('does not keep a connect that failed', async () => {
    createCalDAVClient.mockRejectedValueOnce(new Error('offline'))
    await expect(connect()).rejects.toThrow('offline')
    await expect(connect()).resolves.toMatchObject({ protocol: 'caldav' })
    expect(createCalDAVClient).toHaveBeenCalledTimes(2)
  })

  it('reconnects once the client is older than its lifetime', async () => {
    vi.useFakeTimers()
    const first = await connect()
    vi.advanceTimersByTime(4 * 60_000)
    expect(await connect()).toBe(first)
    vi.advanceTimersByTime(2 * 60_000)
    expect(await connect()).not.toBe(first)
  })
})
