import type { CalDAVCredentials, CalendarProtocol } from '../types'
import type { CalendarBackend } from './CalendarBackend'
import { createCalDAVClient } from './CalDAVClient'
import {
  POOL_TTL_MS,
  backendPool as pool,
  resetBackendPool,
  type PooledBackend,
} from './backendPool'

export { resetBackendPool }

function poolKey(
  serverUrl: string,
  credentials: CalDAVCredentials,
  proxyUrl: string | null
): string {
  // Everything that shapes the connection is part of the key, so editing an
  // account (new password, new header, new proxy) never reuses the old client.
  // The key lives only in this module's memory.
  return JSON.stringify([serverUrl, proxyUrl, credentials])
}

export interface CreateBackendOptions {
  /**
   * Connect a new client even if a pooled one exists. For flows whose point is
   * to prove the server is reachable right now ("Test connection").
   */
  fresh?: boolean
}

/**
 * Connect the backend that matches an account's protocol. Accounts stored
 * before JMAP support carry no protocol and are CalDAV. The JMAP backend is
 * imported lazily so CalDAV-only users do not pay for it.
 *
 * CalDAV clients are shared between callers with the same server and
 * credentials: a write reuses the client the last sync (or write) connected
 * instead of repeating discovery. A connect that fails is never kept.
 */
export async function createCalendarBackend(
  serverUrl: string,
  credentials: CalDAVCredentials,
  proxyUrl: string | null = null,
  protocol: CalendarProtocol = 'caldav',
  options: CreateBackendOptions = {}
): Promise<CalendarBackend> {
  if (protocol === 'jmap') {
    const { createJmapCalendarBackend } =
      await import('@/features/jmap/backend/JmapCalendarBackend')
    return createJmapCalendarBackend(serverUrl, credentials, proxyUrl)
  }
  if (options.fresh) return createCalDAVClient(serverUrl, credentials, proxyUrl)

  const key = poolKey(serverUrl, credentials, proxyUrl)
  const now = Date.now()
  const pooled = pool.get(key)
  if (pooled && now - pooled.connectedAt < POOL_TTL_MS) return pooled.backend

  const backend: Promise<CalendarBackend> = createCalDAVClient(serverUrl, credentials, proxyUrl)
  const entry: PooledBackend = { backend, connectedAt: now }
  pool.set(key, entry)
  // Only a client that connected stays; a rejection must not poison the next
  // caller. The identity check keeps a late failure from evicting a newer entry.
  backend.catch(() => {
    if (pool.get(key) === entry) pool.delete(key)
  })
  return backend
}
