import type { CalendarEvent, RecurrenceEditMode } from '@/types'
import { buildMasterTruncation, getFutureOverrideIds, isFirstOccurrence } from './recurrenceSplit'
import { deleteEventWithUndo } from './deleteWithUndo'
import { showToast } from './toast'

/**
 * Resolves the ISO start of the occurrence the user acted on.
 *
 * Three call sites used to derive this three different ways. The order matters:
 *
 * 1. An exception ("override") event carries the occurrence it replaces in
 *    `recurrenceId` — that is authoritative.
 * 2. Expanded occurrences get a synthetic id of `${masterId}-${occurrenceKey}`
 *    (see the rrule expansion in calendarStore), so the suffix after the master
 *    id is the occurrence start.
 * 3. Otherwise the event is the master itself and its own `start` is the
 *    occurrence.
 */
export function getOccurrenceStart(
  event: Pick<CalendarEvent, 'id' | 'start' | 'recurrenceId'> | undefined,
  clickedEventId: string,
  originalEventId?: string | null
): string | undefined {
  if (event?.recurrenceId) return event.recurrenceId
  if (originalEventId && clickedEventId.startsWith(`${originalEventId}-`)) {
    return clickedEventId.slice(originalEventId.length + 1)
  }
  return event?.start
}

export interface DeleteRecurringOccurrenceOptions {
  mode: RecurrenceEditMode
  /** Id of the row/card the user acted on — may be a synthetic occurrence id. */
  clickedEventId: string
  /** Id of the recurring master, when the clicked event is an expansion of one. */
  originalEventId?: string | null
  /** Current store events. Pass a fresh snapshot, not a render-time capture. */
  events: CalendarEvent[]
  saveRecurrenceOverride: (
    calendarId: string,
    master: CalendarEvent,
    override: CalendarEvent | null,
    removedOverrideIds: string[]
  ) => Promise<void>
  deleteEvent: (id: string) => void
  addEvent: (event: CalendarEvent) => void
  createCalDAVEvent?: (calendarId: string, event: CalendarEvent) => Promise<void>
  deleteCalDAVEvent?: (calendarId: string, eventId: string) => Promise<void>
}

/**
 * The shared "delete this / this-and-following / all" branch for recurring
 * events, previously copy-pasted into EventModal, EventPreviewPopup and
 * EventCard — where it had already drifted (the preview popup skipped undo
 * entirely, and each site derived the occurrence start differently).
 *
 * Returns `true` when the delete went through and the caller should close its
 * dialog/modal, `false` when it failed and the event was kept (a toast has
 * already been shown).
 */
export async function deleteRecurringOccurrence({
  mode,
  clickedEventId,
  originalEventId,
  events,
  saveRecurrenceOverride,
  deleteEvent,
  addEvent,
  createCalDAVEvent,
  deleteCalDAVEvent,
}: DeleteRecurringOccurrenceOptions): Promise<boolean> {
  const recurringMasterId = originalEventId || clickedEventId
  const clickedEvent = events.find((e) => e.id === clickedEventId)
  const masterEvent = events.find((e) => e.id === recurringMasterId)

  if (mode === 'this') {
    // Exclude this occurrence's date on the master; the series itself stays.
    const occurrenceStart = getOccurrenceStart(clickedEvent, clickedEventId, originalEventId)
    if (!occurrenceStart || !masterEvent) return false

    const occurrenceDate = occurrenceStart.split('T')[0]
    const exclusionValue = masterEvent.isAllDay ? occurrenceDate : occurrenceStart
    const excludedDates = masterEvent.excludedDates || []
    const updatedExcludedDates = excludedDates.includes(exclusionValue)
      ? excludedDates
      : [...excludedDates, exclusionValue]

    try {
      await saveRecurrenceOverride(
        masterEvent.calendarId,
        { ...masterEvent, excludedDates: updatedExcludedDates },
        null,
        clickedEvent?.recurrenceId ? [clickedEvent.id] : []
      )
    } catch {
      showToast('Failed to delete this occurrence. The event was kept.')
      return false
    }
    return true
  }

  if (mode === 'future') {
    const occurrenceStart = getOccurrenceStart(clickedEvent, clickedEventId, originalEventId)
    if (!occurrenceStart || !masterEvent) return false

    // Truncating at the first occurrence would leave an empty series, so the
    // whole master goes instead.
    if (isFirstOccurrence(masterEvent, occurrenceStart)) {
      deleteEventWithUndo({
        event: masterEvent,
        deleteEvent,
        addEvent,
        createCalDAVEvent,
        deleteCalDAVEvent,
      })
      return true
    }

    const truncation = buildMasterTruncation(masterEvent, occurrenceStart)
    const removedOverrideIds = getFutureOverrideIds(events, masterEvent, occurrenceStart)
    try {
      await saveRecurrenceOverride(
        masterEvent.calendarId,
        { ...masterEvent, ...truncation },
        null,
        removedOverrideIds
      )
    } catch {
      showToast('Failed to delete this and following events. The series was kept.')
      return false
    }
    return true
  }

  // mode === 'all' — drop the whole series.
  const eventToDelete = masterEvent ?? clickedEvent
  if (!eventToDelete) return false
  deleteEventWithUndo({
    event: eventToDelete,
    deleteEvent,
    addEvent,
    createCalDAVEvent,
    deleteCalDAVEvent,
  })
  return true
}
