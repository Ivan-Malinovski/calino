import { useCalendarStore } from '@/store/calendarStore'
import { findEventById } from './events'

/** Opens the edit modal for an existing event, given the id/date pair carried
 * by a notification (native `extra` payload or the web `?date=&event=` URL) —
 * the same call shape used everywhere an existing event is opened for edit
 * (e.g. EventCard, DayView, EventPreviewPopup). No-ops on a stale/deleted id
 * instead of opening a blank modal. */
export function openEventDeepLink(eventId: string, eventDate: string): void {
  const state = useCalendarStore.getState()
  if (!findEventById(state.events, eventId)) return
  state.setCurrentDate(eventDate.split('T')[0])
  state.openModal(undefined, undefined, eventId)
}
