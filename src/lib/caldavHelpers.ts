import type { CalendarEvent } from '@/types'
import { showToast } from './toast'
import i18n from './i18n'

type CalDAVUpdateFn = (calendarId: string, event: CalendarEvent) => Promise<void>

type CalDAVDeleteFn = (calendarId: string, eventId: string) => Promise<void>

export async function safeCalDAVUpdate(
  caldavUpdateEvent: CalDAVUpdateFn,
  calendarId: string,
  event: CalendarEvent,
  // Partial<CalendarEvent>, not Record<string, unknown>: the loose type let a
  // misspelled field name through the compiler and straight onto the server.
  updates: Partial<CalendarEvent>,
  errorMessage = i18n.t('errors:sync.genericSyncRetry')
): Promise<boolean> {
  try {
    await caldavUpdateEvent(calendarId, { ...event, ...updates })
    return true
  } catch {
    showToast(errorMessage)
    return false
  }
}

export async function safeCalDAVDelete(
  caldavDeleteEvent: CalDAVDeleteFn,
  calendarId: string,
  eventId: string,
  errorMessage = i18n.t('errors:sync.deletionSyncRetryGeneric')
): Promise<boolean> {
  try {
    await caldavDeleteEvent(calendarId, eventId)
    return true
  } catch {
    showToast(errorMessage)
    return false
  }
}
