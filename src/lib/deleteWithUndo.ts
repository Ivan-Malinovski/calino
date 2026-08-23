import type { CalendarEvent } from '@/types'
import { showToast } from './toast'
import i18n from './i18n'

interface DeleteEventWithUndoOptions {
  event: CalendarEvent
  deleteEvent: (id: string) => void
  addEvent: (event: CalendarEvent) => void
  createCalDAVEvent?: (calendarId: string, event: CalendarEvent) => Promise<void>
  deleteCalDAVEvent?: (calendarId: string, eventId: string) => Promise<void>
  onAfterDelete?: () => void
}

export function deleteEventWithUndo({
  event,
  deleteEvent,
  addEvent,
  createCalDAVEvent,
  deleteCalDAVEvent,
  onAfterDelete,
}: DeleteEventWithUndoOptions): void {
  // Fire-and-forget CalDAV delete first so it can capture etag before local delete
  if (event.calendarId !== 'default') {
    deleteCalDAVEvent?.(event.calendarId, event.id).catch(() => {
      showToast(i18n.t('errors:sync.deletionSyncRetry'))
    })
  }

  // Optimistic local delete
  deleteEvent(event.id)
  onAfterDelete?.()

  // Show undo toast
  showToast(i18n.t('errors:undo.eventDeleted'), {
    duration: 8000,
    onUndo: () => {
      addEvent(event)
      if (event.calendarId !== 'default') {
        createCalDAVEvent?.(event.calendarId, event).catch(() => {
          showToast(i18n.t('errors:sync.eventRestoreFailed'))
        })
      }
    },
  })
}
