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
export function shortSyncErrorMessage(code: SyncErrorCode, raw: string, subject = 'Sync'): string {
  return `${subject} failed: ${syncErrorReason(code, raw)}`
}

/**
 * The reason clause on its own, for callers that supply their own sentence —
 * "Renamed locally, but …". Kept separate so nobody has to rewrite the output
 * of `shortSyncErrorMessage` with a regex to drop its subject.
 */
export function syncErrorReason(code: SyncErrorCode, raw: string): string {
  switch (code) {
    case 'cors':
      return 'your server is blocking the connection (CORS).'
    case 'network':
      return "couldn't reach your server. It may be offline, or blocking CORS."
    case 'timeout':
      return 'the server took too long to respond.'
    case 'auth':
      return 'authentication error. Check your username and password.'
    case 'forbidden':
      return 'the server refused the change. You may not have write access to this calendar, or the server rejected the data.'
    case 'quota':
      return 'the server storage is full. Free up space on the server and try again.'
    case 'rate-limited':
      return 'the server is rate-limiting requests. Try again in a moment.'
    case 'not-found':
      return "the resource wasn't found on the server."
    case 'conflict':
      return 'this item changed on the server. Sync again to pick up the newer copy.'
    case 'server':
      return 'the server returned an error. Check its logs.'
    case 'unknown':
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
      return "Couldn't reach the server. Check the address, or it may be offline or blocking cross-origin requests."
    case 'timeout':
      return 'The server took too long to respond.'
    // Deliberately short: `suggestAuthHint` renders directly below this and
    // supplies the app-specific-password guidance for providers that need it.
    case 'auth':
      return 'The server rejected these credentials.'
    case 'forbidden':
      return 'The server refused the request. Check that you have write access to this calendar.'
    case 'quota':
      return 'The server storage is full. Free up space on the server and try again.'
    case 'rate-limited':
      return 'The server is rate-limiting requests. Try again in a moment.'
    case 'not-found':
      return "The server answered, but there's nothing at that address. Check the URL path."
    case 'server':
      return 'The server returned an error. Check its logs.'
    case 'conflict':
    case 'unknown':
      return raw
  }
}

/** The header block a misconfigured DAV server needs, shown in the CORS copy. */
export const CORS_HEADER_SNIPPET = `Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, OPTIONS, MKCOL, MKCALENDAR, COPY, MOVE
Access-Control-Allow-Headers: Authorization, Content-Type, Depth, Prefer, If-Match, If-None-Match
Access-Control-Expose-Headers: ETag, DAV, Allow`
