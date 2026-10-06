import type { CalDAVCredentials } from '@/features/caldav/types'
import type { CalendarBackend } from '@/features/caldav/client/CalendarBackend'

// Skeleton: the real implementation lands once the transport client and the
// JSCalendar converters are in (see docs/JMAP.md, phase 3).
export async function createJmapCalendarBackend(
  _serverUrl: string,
  _credentials: CalDAVCredentials,
  _proxyUrl: string | null
): Promise<CalendarBackend> {
  throw new Error('JMAP calendar backend is not implemented yet')
}
