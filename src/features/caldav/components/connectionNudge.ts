import type { SyncErrorCode } from '@/features/caldav/client/errorMessages'

/** Which part of the card a failed connect points the user at. */
export type ConnectionNudge = 'proxy' | 'headers'

/**
 * Where a failed connect should point the user, if anywhere. A proxy only
 * helps when the browser couldn't talk to the server at all (CORS/network);
 * a 403 with no headers set is usually an auth gateway in front of it. Other
 * failures (not found, timeouts, 5xx) aren't fixed by connection settings.
 */
export function connectionNudgeFor(
  code: SyncErrorCode | null,
  hasProxy: boolean,
  hasHeaders: boolean
): { target: ConnectionNudge; action: string; label: string } | null {
  if (code === 'cors' || code === 'network') {
    return hasProxy
      ? { target: 'proxy', action: 'Check the proxy URL ↓', label: 'Check the proxy URL' }
      : { target: 'proxy', action: 'Set up a proxy ↓', label: 'A proxy may fix this' }
  }
  if (code === 'forbidden' && !hasHeaders) {
    return {
      target: 'headers',
      action: 'Is this server behind a gateway? Add a header ↓',
      label: 'A custom header may fix this',
    }
  }
  return null
}
