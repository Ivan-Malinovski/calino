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
  'cors' | 'network' | 'timeout' | 'auth' | 'not-found' | 'conflict' | 'server' | 'unknown'

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

  if (
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden')
  ) {
    return 'auth'
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
  switch (code) {
    case 'cors':
      return `${subject} failed: your server is blocking the connection (CORS).`
    case 'network':
      return `${subject} failed: couldn't reach your server. It may be offline, or blocking CORS.`
    case 'timeout':
      return `${subject} failed: the server took too long to respond.`
    case 'auth':
      return `${subject} failed: authentication error. Check your username and password.`
    case 'not-found':
      return `${subject} failed: the resource wasn't found on the server.`
    case 'conflict':
      return `${subject} failed: this item changed on the server. Sync again to pick up the newer copy.`
    case 'server':
      return `${subject} failed: the server returned an error. Check its logs.`
    case 'unknown':
      return `${subject} failed: ${raw}`
  }
}

/** The header block a misconfigured DAV server needs, shown in the CORS copy. */
export const CORS_HEADER_SNIPPET = `Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, OPTIONS, MKCOL, MKCALENDAR, COPY, MOVE
Access-Control-Allow-Headers: Authorization, Content-Type, Depth, Prefer, If-Match, If-None-Match
Access-Control-Expose-Headers: ETag, DAV, Allow`
