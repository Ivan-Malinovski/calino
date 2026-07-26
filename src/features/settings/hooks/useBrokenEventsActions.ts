import { useCallback } from 'react'
import type { CalendarEvent, BrokenEvent } from '@/types'
import { useCalendarStore } from '@/store/calendarStore'
import * as accountStorage from '@/features/caldav/sync/accountStorage'

export type BrokenEventSyncStrategy = 'pendingChange' | 'caldav'

type CalDAVOperations = {
  updateEvent: (calendarId: string, event: CalendarEvent) => Promise<void>
  deleteEvent: (calendarId: string, eventId: string) => Promise<void>
}

/**
 * Shared actions for fixing and deleting broken events.
 *
 * Two strategies are supported:
 * - `'pendingChange'` — queues changes locally via `accountStorage.addPendingChange()`.
 *   Used on the Data Issues tab when no CalDAV account is connected.
 * - `'caldav'` — syncs changes to CalDAV immediately (with silent failure).
 *   Used in the Data Management section when a CalDAV account is available.
 */
export function useBrokenEventsActions(
  strategy: BrokenEventSyncStrategy,
  caldav?: CalDAVOperations
): {
  handleFix: (broken: BrokenEvent) => Promise<void> | void
  handleDelete: (broken: BrokenEvent) => Promise<void> | void
  handleFixAll: (brokenEvents: BrokenEvent[]) => Promise<void> | void
  handleDeleteAll: (brokenEvents: BrokenEvent[]) => Promise<void> | void
} {
  const removeBrokenEvent = useCalendarStore((state) => state.removeBrokenEvent)
  const addEvent = useCalendarStore((state) => state.addEvent)

  const handleFix = useCallback(
    (broken: BrokenEvent): Promise<void> | void => {
      const { event } = broken
      const fixedEvent = { ...event, start: event.end, end: event.start }
      removeBrokenEvent(event.id)
      addEvent(fixedEvent)

      if (strategy === 'pendingChange') {
        accountStorage.addPendingChange({
          type: 'update',
          eventId: event.id,
          calendarId: event.calendarId,
          data: JSON.stringify(fixedEvent),
        })
      } else if (strategy === 'caldav' && caldav) {
        return caldav.updateEvent(fixedEvent.calendarId, fixedEvent).catch((err) => {
          console.warn('[useBrokenEventsActions] Fix sync failed:', err)
        })
      }
    },
    [strategy, caldav, removeBrokenEvent, addEvent]
  )

  const handleDelete = useCallback(
    (broken: BrokenEvent): Promise<void> | void => {
      const { event } = broken

      if (strategy === 'pendingChange') {
        accountStorage.addPendingChange({
          type: 'delete',
          eventId: event.id,
          calendarId: event.calendarId,
          data: JSON.stringify(event),
        })
        removeBrokenEvent(event.id)
      } else if (strategy === 'caldav' && caldav) {
        return caldav
          .deleteEvent(event.calendarId, event.id)
          .then(() => removeBrokenEvent(event.id))
          .catch((err) => {
            console.warn('[useBrokenEventsActions] Delete sync failed:', err)
          })
      }
    },
    [strategy, caldav, removeBrokenEvent]
  )

  const handleFixAll = useCallback(
    (brokenEvents: BrokenEvent[]): Promise<void> | void => {
      for (const broken of [...brokenEvents]) {
        handleFix(broken)
      }
    },
    [handleFix]
  )

  const handleDeleteAll = useCallback(
    (brokenEvents: BrokenEvent[]): Promise<void> | void => {
      for (const broken of [...brokenEvents]) {
        handleDelete(broken)
      }
    },
    [handleDelete]
  )

  return { handleFix, handleDelete, handleFixAll, handleDeleteAll }
}
