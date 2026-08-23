/**
 * One classifier for DAV/sync failures, shared by every surface that shows one.
 *
 * `formatSyncError` (GeneralSettings) and `formatSyncErrorForToast`
 * (useSettingsSync) each grew their own substring ladder over the same
 * categories, and had already drifted — the inline one grew a `NetworkError`
 * branch the toast never got, and that branch was dead anyway (it tested a
 * mixed-case needle against an already-lowercased haystack). Classification
 * lives here; the surfaces only decide how to render a code.
 */

import i18n from '@/lib/i18n'

export type SyncErrorCode =
  | 'cors'
  | 'network'
  | 'timeout'
  | 'auth'
  | 'forbidden'
  | 'quota'
  | 'rate-limited'
  | 'not-found'
  | 'conflict'
  | 'server'
  | 'unknown'

/**
 * Bucket a raw error message into a code.
 *
 * Order matters: the checks run most-specific first, because the raw strings
 * overlap heavily. A CORS failure surfaces in browsers as a bare
 * "Failed to fetch"/"NetworkError", so `cors` is only chosen on an explicit
 * signal and generic fetch failures fall through to `network`, whose copy
 * covers both possibilities.
 */
export function classifySyncError(message: string): SyncErrorCode {
  const lower = message.toLowerCase()

  if (lower.includes('cors') || lower.includes('cross-origin') || lower.includes('preflight')) {
    return 'cors'
  }

  // AbortError is what fetchWithTimeout produces when NETWORK_TIMEOUT_MS
  // elapses; it previously fell through to the raw-string default.
  if (
    lower.includes('aborterror') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('the operation was aborted')
  ) {
    return 'timeout'
  }

  // 403 is distinct from 401: the credentials were accepted but the server
  // refused the operation (typically no write access). Must be checked before
  // the auth bucket so "403 Forbidden" no longer lands on 'auth'.
  if (lower.includes('403') || lower.includes('forbidden')) {
    return 'forbidden'
  }

  if (lower.includes('401') || lower.includes('unauthorized')) {
    return 'auth'
  }

  // 507 Insufficient Storage is a 5xx, but means something specific, so it
  // must be checked before the generic 5xx regex below or it falls into
  // 'server'.
  if (lower.includes('507') || lower.includes('insufficient storage') || lower.includes('quota')) {
    return 'quota'
  }

  if (
    lower.includes('429') ||
    lower.includes('too many requests') ||
    lower.includes('rate limit')
  ) {
    return 'rate-limited'
  }

  if (lower.includes('404') || lower.includes('not found')) {
    return 'not-found'
  }

  // 412 comes from the If-Match optimistic-lock check on update/delete: the
  // resource changed on the server since we last read it.
  if (
    lower.includes('412') ||
    lower.includes('precondition failed') ||
    lower.includes('if-match') ||
    lower.includes('conflict')
  ) {
    return 'conflict'
  }

  if (/\b5\d\d\b/.test(lower) || lower.includes('internal server error')) {
    return 'server'
  }

  if (
    lower.includes('networkerror') ||
    lower.includes('network') ||
    lower.includes('failed to fetch') ||
    lower.includes('fetch')
  ) {
    return 'network'
  }

  return 'unknown'
}

/**
 * Short single-line text for toasts.
 *
 * `subject` names what failed ("Sync", "Settings sync"), since the same
 * categories are reported by several callers. `raw` is only used by `unknown`,
 * where we have nothing better to say than the original message.
 */
export function shortSyncErrorMessage(
  code: SyncErrorCode,
  raw: string,
  subject = i18n.t('errors:sync.subjectDefault')
): string {
  return i18n.t('errors:sync.shortFailure', { subject, reason: syncErrorReason(code, raw) })
}

/**
 * The reason clause on its own, for callers that supply their own sentence —
 * "Renamed locally, but …". Kept separate so nobody has to rewrite the output
 * of `shortSyncErrorMessage` with a regex to drop its subject.
 */
export function syncErrorReason(code: SyncErrorCode, raw: string): string {
  switch (code) {
    case 'cors':
      return i18n.t('errors:syncReason.cors')
    case 'network':
      return i18n.t('errors:syncReason.network')
    case 'timeout':
      return i18n.t('errors:syncReason.timeout')
    case 'auth':
      return i18n.t('errors:syncReason.auth')
    case 'forbidden':
      return i18n.t('errors:syncReason.forbidden')
    case 'quota':
      return i18n.t('errors:syncReason.quota')
    case 'rate-limited':
      return i18n.t('errors:syncReason.rateLimited')
    case 'not-found':
      return i18n.t('errors:syncReason.notFound')
    case 'conflict':
      return i18n.t('errors:syncReason.conflict')
    case 'server':
      return i18n.t('errors:syncReason.server')
    case 'unknown':
      // Raw server/exception text — not translatable.
      return raw
  }
}

/**
 * Text for a failed *connection attempt*, as opposed to a failed sync.
 *
 * `probeConnection` returns a raw string built around the underlying exception
 * — "Connection failed: Failed to fetch. This may be a CORS issue" — which
 * leaks a `TypeError` into the first screen a new user sees, and asserts CORS
 * even when the real cause is a typo in the hostname or a server that isn't
 * running. Both are indistinguishable to a browser, so name both instead of
 * guessing, and leave the specifics to the diagnostics panel.
 */
export function connectionErrorMessage(raw: string, code?: SyncErrorCode): string {
  switch (code ?? classifySyncError(raw)) {
    case 'cors':
    case 'network':
      return i18n.t('errors:connection.corsOrNetwork')
    case 'timeout':
      return i18n.t('errors:connection.timeout')
    // Deliberately short: `suggestAuthHint` renders directly below this and
    // supplies the app-specific-password guidance for providers that need it.
    case 'auth':
      return i18n.t('errors:connection.auth')
    case 'forbidden':
      return i18n.t('errors:connection.forbidden')
    case 'quota':
      return i18n.t('errors:connection.quota')
    case 'rate-limited':
      return i18n.t('errors:connection.rateLimited')
    case 'not-found':
      return i18n.t('errors:connection.notFound')
    case 'server':
      return i18n.t('errors:connection.server')
    case 'conflict':
    case 'unknown':
      // Raw server/exception text — not translatable.
      return raw
  }
}

/** The header block a misconfigured DAV server needs, shown in the CORS copy. */
export const CORS_HEADER_SNIPPET = `Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, OPTIONS, MKCOL, MKCALENDAR, COPY, MOVE
Access-Control-Allow-Headers: Authorization, Content-Type, Depth, Prefer, If-Match, If-None-Match
Access-Control-Expose-Headers: ETag, DAV, Allow`
