import { CalDAVConnectionError } from '@/features/caldav/client/errors'
import { classifySyncError, type SyncErrorCode } from '@/features/caldav/client/errorMessages'
import type { JsonObject } from '../types'

const METHOD_STATUS: Record<string, number> = {
  forbidden: 403,
  accountNotFound: 404,
  notFound: 404,
  accountReadOnly: 403,
  stateMismatch: 412,
  overQuota: 507,
  rateLimit: 429,
  serverFail: 500,
  serverUnavailable: 503,
  unknownMethod: 400,
  invalidArguments: 400,
  invalidResultReference: 400,
  requestTooLarge: 413,
  tooManyCalls: 413,
  tooManyObjects: 413,
  limit: 413,
}

/** Compatible with connection UI and pending-change status/backoff readers. */
export class JmapError extends CalDAVConnectionError {
  readonly status?: number
  readonly retryAfter?: number
  readonly body?: string
  readonly type?: string
  readonly method?: string
  readonly callId?: string
  readonly details?: JsonObject
  readonly methodResponses?: import('./session').JmapInvocation[]

  constructor(
    message: string,
    options: {
      code?: SyncErrorCode
      status?: number
      retryAfter?: number
      body?: string
      type?: string
      method?: string
      callId?: string
      details?: JsonObject
      methodResponses?: import('./session').JmapInvocation[]
    } = {}
  ) {
    super(message, undefined, options.code ?? classifySyncError(message))
    this.name = 'JmapError'
    this.status = options.status
    this.retryAfter = options.retryAfter
    this.body = options.body
    this.type = options.type
    this.method = options.method
    this.callId = options.callId
    this.details = options.details
    this.methodResponses = options.methodResponses
  }
}

export function parseRetryAfter(raw: string | null): number | undefined {
  if (!raw?.trim()) return undefined
  const value = raw.trim()
  const seconds = /^\d+$/.test(value)
    ? Number(value)
    : Math.max(0, Math.ceil((Date.parse(value) - Date.now()) / 1000))
  return Number.isFinite(seconds) ? Math.min(seconds, 3600) : undefined
}

export function methodError(
  details: JsonObject,
  method: string,
  callId: string,
  retryAfter?: number,
  methodResponses?: import('./session').JmapInvocation[]
): JmapError {
  const type = typeof details.type === 'string' ? details.type : 'unknown'
  const shortType = type.split(':').at(-1) ?? type
  const status = METHOD_STATUS[shortType]
  const description = typeof details.description === 'string' ? details.description : ''
  return new JmapError(
    `JMAP ${method}: ${type}${status ? ` (HTTP ${status})` : ''}${description ? `: ${description}` : ''}`,
    {
      type,
      status,
      method,
      callId,
      details,
      retryAfter,
      methodResponses,
      body: JSON.stringify(details),
    }
  )
}

export function transportError(error: unknown): JmapError {
  if (error instanceof JmapError) return error
  const message = error instanceof Error ? error.message : String(error)
  if (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  ) {
    return new JmapError('JMAP request timed out', { code: 'timeout' })
  }
  // Keep fetch wording for the pending-change queue's uncounted network retry.
  return new JmapError(`JMAP: Failed to fetch: ${message}`, {
    code: classifySyncError(message) === 'cors' ? 'cors' : 'network',
  })
}

export async function assertJmapResponse(response: Response): Promise<void> {
  if (response.ok) return
  const body = await response.text().catch(() => '')
  let details: JsonObject | undefined
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      details = parsed as JsonObject
    }
  } catch {
    /* HTTP errors may have HTML or empty bodies. */
  }
  throw new JmapError(
    `JMAP request failed: HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
    {
      status: response.status,
      body,
      details,
      type: typeof details?.type === 'string' ? details.type : undefined,
      retryAfter: parseRetryAfter(response.headers.get('Retry-After')),
    }
  )
}
