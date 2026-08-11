import type { CalendarEvent } from '@/types'
import { useCalendarStore } from '@/store/calendarStore'
import { showToast } from './toast'

interface DuplicateEventWithSyncOptions {
  /** Id of the event to copy. */
  eventId: string
  /** Appends " (copy)" to the title — off for ctrl+drag, which places a copy. */
  addCopySuffix?: boolean
  /** Applied to the copy before it is pushed (the drop position, typically). */
  updates?: Partial<CalendarEvent>
  createCalDAVEvent?: (calendarId: string, event: CalendarEvent) => Promise<void>
}

/**
 * Duplicate an event and push the copy to CalDAV.
 *
 * `duplicateEvent` only writes to the local store. Every duplicate path used
 * to stop there, so the copy looked fine until the next sync pass, which
 * removed it again — the server had never heard of it. Any UI that duplicates
 * must go through here.
 */
export function duplicateEventWithSync({
  eventId,
  addCopySuffix = true,
  updates,
  createCalDAVEvent,
}: DuplicateEventWithSyncOptions): string | null {
  const store = useCalendarStore.getState()
  const newId = store.duplicateEvent(eventId, addCopySuffix)
  if (!newId) return null

  if (updates) {
    store.updateEvent(newId, updates)
  }

  // Read back rather than reusing the pre-update copy: `addEvent`/`updateEvent`
  // apply auto-categories and the #112 creation stamp, and the server should
  // get what the store actually holds.
  const copy = useCalendarStore.getState().events.find((e) => e.id === newId)
  if (copy && copy.calendarId !== 'default') {
    createCalDAVEvent?.(copy.calendarId, copy).catch(() => {
      showToast('Failed to sync the duplicated event. It will be retried.')
    })
  }

  return newId
}
