import type { CalendarBackend } from './CalendarBackend'

/**
 * Connected CalDAV clients, kept so a write can reuse the client the last sync
 * connected instead of repeating discovery (#257). Lives in its own module,
 * with no imports beyond a type, so the test setup can reset it before every
 * test without loading the DAV stack ahead of a test file's mocks.
 */

/**
 * How long a connected client is reused. Bounded so a server that moves its
 * calendar home, or a collection created elsewhere, is picked up again.
 */
export const POOL_TTL_MS = 5 * 60_000

export interface PooledBackend {
  backend: Promise<CalendarBackend>
  connectedAt: number
}

export const backendPool = new Map<string, PooledBackend>()

/** Drop every pooled client. Used by tests; a sign-out could call it too. */
export function resetBackendPool(): void {
  backendPool.clear()
}
