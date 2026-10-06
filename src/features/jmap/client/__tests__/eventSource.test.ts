import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { basicAuthHeader } from '@/features/caldav/client/basicAuth'
import { JmapClient } from '../JmapClient'
import { json, options, session } from './fixtures'

describe('authenticated event source', () => {
  const fetchMock = vi.fn<typeof fetch>()
  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function connected() {
    fetchMock.mockResolvedValueOnce(json(session()))
    const client = new JmapClient(options)
    await client.connect()
    return client
  }

  it('streams StateChange, sends auth and resumes with Last-Event-ID', async () => {
    const client = await connected()
    let source: ReadableStreamDefaultController<Uint8Array> | undefined
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        source = controller
      },
    })
    fetchMock.mockResolvedValueOnce(
      new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
    )
    const onStateChange = vi.fn()
    const close = client.openEventSource(['Calendar', 'CalendarEvent'], onStateChange)
    await vi.advanceTimersByTimeAsync(0)
    const state = { '@type': 'StateChange', changed: { a: { CalendarEvent: 'new' } } }
    const encoder = new TextEncoder()
    source!.enqueue(encoder.encode(`id: 7\nevent: state\ndata: ${JSON.stringify(state)}\n\n`))
    source!.enqueue(encoder.encode('event: ping\ndata: {"interval":30}\n\n'))
    source!.enqueue(encoder.encode('event: state\ndata: bad JSON\n\n'))
    await vi.advanceTimersByTimeAsync(0)
    expect(onStateChange).toHaveBeenCalledExactlyOnceWith(state)
    const [, init] = fetchMock.mock.calls[1]
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      basicAuthHeader(options.username, options.password)
    )
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://calendar.test/events?types=Calendar%2CCalendarEvent&closeafter=no&ping=30'
    )
    source!.close()
    fetchMock.mockImplementationOnce(
      (_, request) =>
        new Promise((_, reject) => {
          request?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          )
        })
    )
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(new Headers(fetchMock.mock.calls[2][1]?.headers).get('Last-Event-ID')).toBe('7')
    close()
    expect(fetchMock.mock.calls[2][1]?.signal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(120000)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('reconnects with exponential backoff and stops pending reconnect on close', async () => {
    const client = await connected()
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const close = client.openEventSource([], vi.fn())
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1999)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    close()
    await vi.advanceTimersByTimeAsync(120000)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('honors rate-limit Retry-After and stops on auth failures', async () => {
    const client = await connected()
    fetchMock.mockResolvedValueOnce(json({}, { status: 429, headers: { 'Retry-After': '5' } }))
    fetchMock.mockResolvedValueOnce(json({}, { status: 401 }))
    const close = client.openEventSource([], vi.fn())
    await vi.advanceTimersByTimeAsync(4999)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(120000)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    close()
  })

  it('aborts a silent stream after missing pings and cancels the reader', async () => {
    const client = await connected()
    const cancel = vi.fn()
    fetchMock.mockImplementationOnce((_, init) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener('abort', () =>
            controller.error(new DOMException('aborted', 'AbortError'))
          )
        },
        cancel,
      })
      return Promise.resolve(
        new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
      )
    })
    const close = client.openEventSource([], vi.fn())
    await vi.advanceTimersByTimeAsync(70000)
    expect(fetchMock.mock.calls[1][1]?.signal?.aborted).toBe(true)
    close()
  })
})
