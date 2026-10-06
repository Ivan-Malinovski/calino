import { JMAP_CORE, JMAP_CALENDARS, type JsonObject } from '../types'
import {
  assertJmapResponse,
  JmapError,
  methodError,
  parseRetryAfter,
  transportError,
} from './errors'
import {
  calendarAccountId,
  createJmapTransport,
  expandTemplate,
  fetchSession,
  isObject,
  resolveTemplate,
  sessionCandidates,
  type JmapClientOptions,
  type JmapInvocation,
  type JmapResponse,
  type JmapSession,
  type JmapTransport,
} from './session'
import { mergeResponses, positiveLimit, resolveReferences, splitArguments } from './batching'
import { SseParser } from './sse'

export { resultReference } from './batching'
export type { JmapResultReference } from './batching'
export type { JmapClientOptions, JmapInvocation, JmapResponse, JmapSession } from './session'

export interface JmapUpload {
  blobId: string
  size: number
  type: string
}
export interface JmapStateChange {
  '@type': 'StateChange'
  changed: Record<string, Record<string, string>>
}

function browserFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const transport = (globalThis as { CapacitorWebFetch?: typeof fetch }).CapacitorWebFetch ?? fetch
  return transport(input, init)
}

export class JmapClient {
  private transport: JmapTransport
  private options: JmapClientOptions
  private currentSession: JmapSession | null = null
  private sessionUrl: string | null = null
  private refresh: Promise<void> | null = null

  constructor(opts: JmapClientOptions) {
    this.options = { ...opts, customHeaders: { ...opts.customHeaders } }
    this.transport = createJmapTransport(this.options)
  }

  get session(): JmapSession {
    if (!this.currentSession) throw new JmapError('Client not connected. Call connect() first.')
    return this.currentSession
  }

  get accountId(): string {
    const id = calendarAccountId(this.session)
    if (!id)
      throw new JmapError('JMAP session has no primary calendar account', {
        type: 'accountNotFound',
        status: 404,
      })
    return id
  }

  get username(): string {
    return this.session.username
  }
  get capabilities() {
    return this.session.capabilities
  }
  get accountCapabilities() {
    return this.session.accounts[this.accountId].accountCapabilities
  }
  get apiUrl(): string {
    return this.session.apiUrl
  }
  get uploadUrl(): string {
    return this.session.uploadUrl
  }
  get downloadUrl(): string {
    return this.session.downloadUrl
  }
  get eventSourceUrl(): string {
    return this.session.eventSourceUrl
  }

  async connect(): Promise<void> {
    let lastError: unknown
    for (const url of this.sessionUrl
      ? [this.sessionUrl]
      : sessionCandidates(this.options.serverUrl)) {
      try {
        const loaded = await fetchSession(this.transport, url)
        const session = { ...loaded.session }
        for (const key of ['apiUrl', 'uploadUrl', 'downloadUrl', 'eventSourceUrl'] as const) {
          session[key] = this.transport.targetUrl(resolveTemplate(session[key], loaded.sessionUrl))
        }
        this.currentSession = session
        this.sessionUrl = loaded.sessionUrl
        return
      } catch (error) {
        if (error instanceof JmapError && ['auth', 'forbidden'].includes(error.code ?? ''))
          throw error
        lastError = error
      }
    }
    if (lastError instanceof JmapError) throw lastError
    throw new JmapError('Invalid JMAP session document', { type: 'invalidSession' })
  }

  private async refreshSession(state: string): Promise<void> {
    if (state === this.session.state) return
    this.refresh ??= this.connect().finally(() => {
      this.refresh = null
    })
    await this.refresh
  }

  /** Returns logical responses with original call ids, even when reads/writes are split. */
  async call(
    methodCalls: readonly JmapInvocation[],
    using: readonly string[] = [JMAP_CORE, JMAP_CALENDARS]
  ): Promise<JmapResponse> {
    const responses: JmapInvocation[] = []
    const createdIds: Record<string, string> = {}
    let sessionState = this.session.state
    const send = async (calls: JmapInvocation[]): Promise<JmapInvocation[]> => {
      const response = await this.transport.request(this.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          using: [...new Set([JMAP_CORE, ...using])],
          methodCalls: calls,
          createdIds,
        }),
      })
      await assertJmapResponse(response)
      const body: unknown = await response.json().catch(() => null)
      if (
        !isObject(body) ||
        !Array.isArray(body.methodResponses) ||
        typeof body.sessionState !== 'string' ||
        !body.methodResponses.every(
          (item) =>
            Array.isArray(item) &&
            item.length === 3 &&
            typeof item[0] === 'string' &&
            isObject(item[1]) &&
            typeof item[2] === 'string'
        )
      ) {
        if (isObject(body) && typeof body.type === 'string')
          throw methodError(
            body,
            'request',
            '',
            parseRetryAfter(response.headers.get('Retry-After'))
          )
        throw new JmapError('Invalid JMAP API response', { type: 'invalidResponse' })
      }
      const result = body as unknown as JmapResponse
      for (const call of calls) {
        if (!result.methodResponses.some(([, , id]) => id === call[2]))
          throw new JmapError('JMAP response omitted a call', { type: 'invalidResponse' })
      }
      sessionState = result.sessionState
      if (isObject(result.createdIds)) {
        for (const [id, value] of Object.entries(result.createdIds))
          if (typeof value === 'string') createdIds[id] = value
      }
      for (const [, args] of result.methodResponses) {
        if (isObject(args.created))
          for (const [id, value] of Object.entries(args.created)) {
            if (isObject(value) && typeof value.id === 'string') createdIds[id] = value.id
          }
      }
      await this.refreshSession(sessionState)
      const failure = result.methodResponses.find(([name]) => name === 'error')
      if (failure) {
        const call = calls.find(([, , id]) => id === failure[2])
        throw methodError(
          failure[1],
          call?.[0] ?? 'unknown',
          failure[2],
          parseRetryAfter(response.headers.get('Retry-After')),
          [...responses, ...result.methodResponses]
        )
      }
      return result.methodResponses
    }

    const ids = new Set(methodCalls.map((call) => call[2]))
    if (ids.size !== methodCalls.length)
      throw new JmapError('Duplicate JMAP call ids', { type: 'invalidArguments' })
    let pending: JmapInvocation[] = []
    const flush = async () => {
      if (!pending.length) return
      responses.push(...(await send(pending)))
      pending = []
    }
    for (const [name, original, id] of methodCalls) {
      let args = resolveReferences(original, responses)
      // A reference may yield ids that exceed the get limit: resolve its producer first.
      if (
        (name.endsWith('/get') || name.endsWith('/set')) &&
        Object.keys(args).some((key) => key.startsWith('#'))
      ) {
        await flush()
        args = resolveReferences(original, responses)
      }
      const core = this.capabilities[JMAP_CORE]
      const parts = splitArguments(
        name,
        args,
        positiveLimit(core.maxObjectsInGet),
        positiveLimit(core.maxObjectsInSet)
      )
      if (parts.length > 1) {
        await flush()
        const results: JsonObject[] = []
        let ifInState = args.ifInState
        for (const part of parts) {
          if (typeof ifInState === 'string') part.ifInState = ifInState
          const result = await send([[name, part, id]])
          const primary = result.find(
            ([resultName, , callId]) => resultName === name && callId === id
          )
          if (!primary)
            throw new JmapError('JMAP response omitted split method result', {
              type: 'invalidResponse',
            })
          results.push(primary[1])
          if (typeof args.ifInState === 'string') {
            if (typeof primary[1].newState !== 'string')
              throw new JmapError('JMAP /set response omitted newState', {
                type: 'invalidResponse',
              })
            ifInState = primary[1].newState
          }
        }
        responses.push([name, mergeResponses(name, args, results), id])
      } else {
        pending.push([name, args, id])
        if (pending.length >= positiveLimit(core.maxCallsInRequest)) await flush()
      }
    }
    await flush()
    return { methodResponses: responses, sessionState, createdIds }
  }

  private async binaryRequest(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30000)
    try {
      const response = await this.transport.rawRequest(
        url,
        { ...init, signal: controller.signal },
        browserFetch
      )
      await assertJmapResponse(response)
      return response
    } finally {
      clearTimeout(timer)
    }
  }

  async upload(blob: Blob | ArrayBuffer, type: string): Promise<JmapUpload> {
    const url = expandTemplate(this.uploadUrl, { accountId: this.accountId })
    const response = await this.binaryRequest(url, {
      method: 'POST',
      headers: { 'Content-Type': type },
      body: blob,
    })
    const result: unknown = await response.json().catch(() => null)
    if (
      !isObject(result) ||
      typeof result.blobId !== 'string' ||
      typeof result.size !== 'number' ||
      typeof result.type !== 'string'
    ) {
      throw new JmapError('Invalid JMAP upload response', { type: 'invalidResponse' })
    }
    return { blobId: result.blobId, size: result.size, type: result.type }
  }

  async download(blobId: string, name: string, type: string): Promise<Blob> {
    const url = expandTemplate(this.downloadUrl, { accountId: this.accountId, blobId, name, type })
    return (await this.binaryRequest(url, { method: 'GET' })).blob()
  }

  openEventSource(
    types: readonly string[],
    onStateChange: (state: JmapStateChange) => void
  ): () => void {
    // Check connection synchronously; the URL is reevaluated after each reconnect/session refresh.
    void this.session
    let stopped = false
    let active: AbortController | undefined
    let reconnect: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    let retryMs = 1000
    let lastId: string | undefined
    const run = async () => {
      active = new AbortController()
      const controller = active
      let interval = 30
      let watchdog: ReturnType<typeof setTimeout> | undefined
      const touch = () => {
        clearTimeout(watchdog)
        watchdog = setTimeout(() => controller.abort(), (interval * 2 + 10) * 1000)
      }
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
      let retryAfter = 0
      try {
        touch()
        const url = expandTemplate(this.eventSourceUrl, {
          types: types.length ? types.join(',') : '*',
          closeafter: 'no',
          ping: '30',
        })
        const headers: Record<string, string> = { Accept: 'text/event-stream' }
        if (lastId) headers['Last-Event-ID'] = lastId
        const response = await this.transport.rawRequest(
          url,
          { method: 'GET', headers, signal: controller.signal },
          browserFetch
        )
        await assertJmapResponse(response)
        if (!response.body || !response.headers.get('Content-Type')?.includes('text/event-stream'))
          throw new JmapError('JMAP server did not return an event stream')
        const parser = new SseParser(
          (event) => {
            if (stopped) return
            lastId = event.id
            attempts = 0
            if (event.event === 'ping') {
              try {
                const data: unknown = JSON.parse(event.data)
                if (
                  isObject(data) &&
                  typeof data.interval === 'number' &&
                  data.interval > 0 &&
                  Number.isFinite(data.interval)
                )
                  interval = data.interval
              } catch {
                /* Ignore malformed pings. */
              }
              touch()
            } else if (event.event === 'state' || event.event === 'message') {
              let state: unknown
              try {
                state = JSON.parse(event.data)
              } catch {
                return
              }
              if (
                isObject(state) &&
                state['@type'] === 'StateChange' &&
                isObject(state.changed) &&
                Object.values(state.changed).every(
                  (value) =>
                    isObject(value) &&
                    Object.values(value).every((item) => typeof item === 'string')
                )
              ) {
                onStateChange(state as unknown as JmapStateChange)
              }
            }
          },
          (value) => {
            retryMs = Math.max(1000, value)
          }
        )
        reader = response.body.getReader()
        const decoder = new TextDecoder()
        while (!stopped) {
          const chunk = await reader.read()
          if (chunk.done) break
          touch()
          parser.feed(decoder.decode(chunk.value, { stream: true }))
        }
      } catch (error) {
        const mapped = transportError(error)
        retryAfter = (mapped.retryAfter ?? 0) * 1000
        if (mapped.status === 401 || mapped.status === 403) stopped = true
      } finally {
        clearTimeout(watchdog)
        await reader?.cancel().catch(() => {})
        reader?.releaseLock()
      }
      if (!stopped) {
        const delay = Math.max(retryAfter, Math.min(retryMs * 2 ** Math.min(attempts++, 6), 60000))
        reconnect = setTimeout(() => {
          void run()
        }, delay)
      }
    }
    void run()
    return () => {
      stopped = true
      clearTimeout(reconnect)
      active?.abort()
    }
  }
}
