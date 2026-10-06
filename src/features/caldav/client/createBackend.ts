import type { CalDAVCredentials, CalendarProtocol } from '../types'
import type { CalendarBackend } from './CalendarBackend'
import { createCalDAVClient } from './CalDAVClient'

/**
 * Connect the backend that matches an account's protocol. Accounts stored
 * before JMAP support carry no protocol and are CalDAV. The JMAP backend is
 * imported lazily so CalDAV-only users do not pay for it.
 */
export async function createCalendarBackend(
  serverUrl: string,
  credentials: CalDAVCredentials,
  proxyUrl: string | null = null,
  protocol: CalendarProtocol = 'caldav'
): Promise<CalendarBackend> {
  if (protocol === 'jmap') {
    const { createJmapCalendarBackend } =
      await import('@/features/jmap/backend/JmapCalendarBackend')
    return createJmapCalendarBackend(serverUrl, credentials, proxyUrl)
  }
  return createCalDAVClient(serverUrl, credentials, proxyUrl)
}
