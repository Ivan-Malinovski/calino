import type { PendingChange } from '../types'

/**
 * How the pending-change queue should treat a failed write.
 *
 * - 'retry': transient network/offline failure — do NOT count toward
 *   MAX_RETRIES and do not drop the change (the device simply can't reach
 *   the server right now).
 * - 'retry-counted': server-side transient (5xx, 429, 401, unknown) —
 *   bump retryCount; MAX_RETRIES still bounds how many times we try.
 * - 'drop': permanent failure — remove the change immediately and toast
 *   the attached 'message'.
 * - 'stale-etag': 412 on an update/delete — the If-Match etag is stale;
 *   the caller re-GETs the etag and re-applies the change once.
 */
export type PendingChangeDispositionKind = 'retry' | 'retry-counted' | 'drop' | 'stale-etag'

export interface PendingChangeDisposition {
  kind: PendingChangeDispositionKind
  /** Present when kind === 'drop': the user-facing reason sentence (no subject prefix). */
  message?: string
}

/**
 * Message fragments identifying a network-level failure. These errors carry
 * NO 'status' (a fetch 'TypeError: Failed to fetch', the client's offline
 * throw, or a 'NetworkError') and must not consume a retry.
 */
const NETWORK_ERROR_RE = /no network connection|failed to fetch|networkerror|offline/

/** Message fragments identifying a rate-limit response. */
const RATE_LIMIT_RE = /429|too many requests|rate limit/

const BACKOFF_BASE_MS = 30_000
const BACKOFF_CAP_MS = 30 * 60_000 // 30 minutes

/**
 * Classify a failed pending-change write.
 *
 * The CalDAV client attaches 'status: number' and 'body?: string' to errors
 * thrown from a non-2xx response (see 'assertResponseOk' in CalDAVClient.ts);
 * network failures and the offline throw carry neither. Checks run in the
 * order below — statuses are mutually exclusive, but the no-status and
 * message-based branches must run first.
 */
export function classifyPendingChangeError(
  err: unknown,
  changeType: PendingChange['type']
): PendingChangeDisposition {
  const status = readStatus(err)
  const message = readMessage(err).toLowerCase()

  // No numeric status: network-level failure. Offline/'Failed to fetch' are
  // transient and UNCOUNTED; anything else (programming/parse errors) keeps
  // today's behaviour of a counted retry.
  if (status === undefined) {
    return NETWORK_ERROR_RE.test(message) ? { kind: 'retry' } : { kind: 'retry-counted' }
  }

  // 412 Precondition Failed: the If-Match etag we sent is stale.
  if (status === 412) {
    if (changeType === 'update' || changeType === 'delete') {
      return { kind: 'stale-etag' }
    }
    if (changeType === 'create') {
      return {
        kind: 'drop',
        message: pendingChangeDropMessage(
          'create',
          undefined,
          'already exists on the server — check for a duplicate.'
        ),
      }
    }
    // move / delete-href: the precondition is on a resource we don't hold an
    // etag for — keep retrying (counted).
    return { kind: 'retry-counted' }
  }

  // 403 Forbidden: tell a CalDAV precondition (duplicate UID, invalid data)
  // apart from a plain permission denial. iCloud/Google express
  // <C:no-uid-conflict/> through a 403, so the response body is the signal.
  if (status === 403) {
    const body = readBody(err).toLowerCase()
    if (body.includes('no-uid-conflict')) {
      return {
        kind: 'drop',
        message: pendingChangeDropMessage(
          changeType,
          undefined,
          'a duplicate of this event already exists on the server.'
        ),
      }
    }
    if (body.includes('valid-calendar')) {
      return {
        kind: 'drop',
        message: pendingChangeDropMessage(
          changeType,
          undefined,
          'the server rejected the event data as invalid for this calendar.'
        ),
      }
    }
    return {
      kind: 'drop',
      message: pendingChangeDropMessage(
        changeType,
        undefined,
        'the server refused the change (403). You may not have write access to this calendar.'
      ),
    }
  }

  // 507 Insufficient Storage: permanent until the user frees server space.
  if (status === 507) {
    return {
      kind: 'drop',
      message: pendingChangeDropMessage(changeType, undefined, 'the server storage is full (507).'),
    }
  }

  // 404/410 on create/update: the target resource is gone. DELETE 404/410 is
  // tolerated by the client and never reaches this classifier; a delete that
  // did arrive falls through to the counted-retry default below.
  if ((status === 404 || status === 410) && (changeType === 'create' || changeType === 'update')) {
    return {
      kind: 'drop',
      message: pendingChangeDropMessage(
        changeType,
        undefined,
        'the calendar or event no longer exists on the server.'
      ),
    }
  }

  // 401 Unauthorized: credentials may be fixable — retry, bounded by MAX_RETRIES.
  if (status === 401) {
    return { kind: 'retry-counted' }
  }

  // 429 / rate-limit wording: transient, counted.
  if (status === 429 || RATE_LIMIT_RE.test(message)) {
    return { kind: 'retry-counted' }
  }

  // 5xx server errors: transient, counted.
  if (/^5\d\d$/.test(String(status))) {
    return { kind: 'retry-counted' }
  }

  // Anything else: counted retry, preserving today's behaviour.
  return { kind: 'retry-counted' }
}

/**
 * Exponential backoff before the NEXT attempt after a failure with the given
 * retryCount: 30s doubled per attempt, capped at 30 minutes. retryCount 0 →
 * 30s, 1 → 60s, 2 → 120s, ..., 6+ → 30min. Negative or non-finite input
 * falls back to the base delay.
 *
 * When retryAfterSeconds is a positive finite number (a server-issued
 * Retry-After, e.g. from a 429), it acts as a LOWER BOUND: the caller never
 * retries sooner than the server asked, even when the exponential schedule
 * would. Invalid values (absent, 0, negative, non-finite) are ignored and
 * the pure exponential schedule applies.
 */
export function backoffDelayMs(retryCount: number, retryAfterSeconds?: number): number {
  if (typeof retryCount !== 'number' || !Number.isFinite(retryCount) || retryCount < 0) {
    return BACKOFF_BASE_MS
  }
  const exponential = Math.min(BACKOFF_BASE_MS * 2 ** retryCount, BACKOFF_CAP_MS)
  if (
    typeof retryAfterSeconds === 'number' &&
    Number.isFinite(retryAfterSeconds) &&
    retryAfterSeconds > 0
  ) {
    return Math.max(exponential, retryAfterSeconds * 1000)
  }
  return exponential
}

/** Default trailing reason per change type when no specific reason is given. */
const DEFAULT_DROP_REASONS: Record<PendingChange['type'], string> = {
  create: 'your change is saved locally.',
  update: 'your change is saved locally.',
  delete: 'the event stays on the server.',
  move: 'the event may still be in its old calendar.',
  'delete-href': 'the event may still be in its old calendar.',
}

/** Per-type verb fragment that follows "Couldn't ". */
const DROP_VERBS: Record<PendingChange['type'], string> = {
  create: 'create',
  update: 'save',
  delete: 'delete',
  move: 'move',
  'delete-href': 'remove the old copy of',
}

/**
 * Build the drop message for a change that exhausted retries or failed
 * permanently. The result is a sentence WITHOUT a leading subject — the
 * caller composes the toast, e.g. pendingChangeDropMessage('create') →
 * Couldn't create "this event" — your change is saved locally.
 *
 * When 'reason' is omitted a per-type fallback is used; when provided it is
 * appended verbatim after " — ".
 */
export function pendingChangeDropMessage(
  changeType: PendingChange['type'],
  title?: string,
  reason?: string
): string {
  const label = title || 'this event'
  const base = "Couldn't " + DROP_VERBS[changeType] + ' "' + label + '"'
  const tail = reason ?? DEFAULT_DROP_REASONS[changeType]
  return base + ' — ' + tail
}

/** Read a numeric HTTP status from an unknown error, if one is attached. */
function readStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined
  const raw = (err as { status?: unknown }).status
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
}

/** Read the error message string, if present ('' when absent). */
function readMessage(err: unknown): string {
  if (typeof err !== 'object' || err === null) return ''
  const raw = (err as { message?: unknown }).message
  return typeof raw === 'string' ? raw : ''
}

/** Read the response body string, if present ('' when absent). */
function readBody(err: unknown): string {
  if (typeof err !== 'object' || err === null) return ''
  const raw = (err as { body?: unknown }).body
  return typeof raw === 'string' ? raw : ''
}
