import type { CalendarEvent } from '@/types'

/**
 * Push a saved journal entry to the server, routing by where it came from and
 * where it is going. Shared by JournalView and JournalDayModal — keep the two
 * in lockstep, this file is the single source of truth.
 *
 * - real calendar → real calendar: `updateCalDAVEvent`, which detects a move
 *   from the preserved `resourceHref` and relocates the VJOURNAL (the #86
 *   machinery, type-agnostic). Same-calendar edits are plain updates.
 * - Offline (`default`) → real calendar: no server resource exists yet, so
 *   create it. `updateCalDAVEvent` would try to PUT at a href that doesn't
 *   exist.
 * - real calendar → Offline: the entry stays local; delete the server copy so
 *   the next sync can't re-import it. Must be `deleteEventByHref` — its
 *   success path never touches the store, whereas `deleteCalDAVEvent` also
 *   deletes the local record, losing the entry everywhere.
 * - Offline → Offline: nothing to sync.
 */
export function syncJournalEntryToServer(opts: {
  existing: CalendarEvent
  targetCalendarId: string
  syncedEntry: CalendarEvent
  updateCalDAVEvent: (calendarId: string, event: CalendarEvent) => Promise<void>
  createCalDAVEvent: (calendarId: string, event: CalendarEvent) => Promise<void>
  deleteCalDAVEventByHref: (calendarId: string, href: string) => Promise<void>
  showToast: (message: string) => void
}): void {
  const {
    existing,
    targetCalendarId,
    syncedEntry,
    updateCalDAVEvent,
    createCalDAVEvent,
    deleteCalDAVEventByHref,
    showToast,
  } = opts

  if (existing.calendarId !== 'default' && targetCalendarId !== 'default') {
    updateCalDAVEvent(targetCalendarId, syncedEntry).catch(() => {
      showToast('Failed to sync update. It will be retried.')
    })
  } else if (existing.calendarId === 'default' && targetCalendarId !== 'default') {
    createCalDAVEvent(targetCalendarId, syncedEntry).catch(() => {
      showToast('Failed to sync update. It will be retried.')
    })
  } else if (existing.calendarId !== 'default' && targetCalendarId === 'default') {
    if (existing.resourceHref) {
      deleteCalDAVEventByHref(existing.calendarId, existing.resourceHref).catch(() => {
        showToast('Failed to sync update. It will be retried.')
      })
    }
  }
}
