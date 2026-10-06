import type { CalDAVCredentials, CalendarProtocol } from '@/features/caldav/types'
import type { ContactsBackend } from './ContactsBackend'
import { createCardDAVClient } from './CardDAVClient'

/**
 * Connect the contacts backend for an account's protocol. Accounts stored
 * before JMAP support carry no protocol and are CardDAV. The JMAP backend is
 * imported lazily so CardDAV-only users do not pay for it.
 */
export async function createContactsBackend(
  serverUrl: string,
  credentials: CalDAVCredentials,
  proxyUrl: string | null = null,
  protocol: CalendarProtocol = 'caldav'
): Promise<ContactsBackend> {
  if (protocol === 'jmap') {
    const { createJmapContactsBackend } =
      await import('@/features/jmap/contacts/JmapContactsBackend')
    return createJmapContactsBackend(serverUrl, credentials, proxyUrl)
  }
  return createCardDAVClient(serverUrl, credentials, proxyUrl)
}
