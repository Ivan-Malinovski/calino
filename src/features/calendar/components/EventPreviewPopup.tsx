import { type JSX, useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { format, parseISO, isSameDay } from 'date-fns'
import { v4 as uuidv4 } from 'uuid'
import { formatTime, daysBetween, addDays } from '@/lib/datetime'
import { buildMasterTruncation, getFutureOverrideIds, isFirstOccurrence } from '@/lib/recurrenceSplit'
import { showToast } from '@/lib/toast'
import { motion, AnimatePresence } from 'framer-motion'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { useSettingsStore } from '@/store/settingsStore'
import { useCalendarStore } from '@/store/calendarStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { safeCalDAVUpdate, safeCalDAVDelete } from '@/lib/caldavHelpers'
import { DeleteDialog } from './DeleteDialog'
import { RecurrenceDialog } from './RecurrenceDialog'
import { LocationLink } from './LocationLink'
import { RecurringIcon } from '@/components/common/icons'
import { EventBackground } from '@/components/common/EventBackground'
import { matchEventBackground } from '@/lib/eventBackground'
import { describeRecurrence } from '@/lib/recurrence'
import { hasDueTime, extractOriginalEventId } from '@/lib/events'
import type { CalendarEvent } from '@/types'
import styles from './EventPreviewPopup.module.css'

interface EventPreviewPopupProps {
  event: CalendarEvent
  position: { x: number; y: number }
  clickedEventId: string
}

const REMINDER_LABELS: Record<number, string> = {
  0: 'At time of event',
  5: '5 minutes before',
  10: '10 minutes before',
  15: '15 minutes before',
  30: '30 minutes before',
  60: '1 hour before',
  120: '2 hours before',
  1440: '1 day before',
}

export function EventPreviewPopup({
  event,
  position,
  clickedEventId,
}: EventPreviewPopupProps): JSX.Element {
  const popupRef = useRef<HTMLDivElement>(null)
  const timeFormat = useSettingsStore((state) => state.timeFormat)
  const dateFormat = useSettingsStore((state) => state.dateFormat)
  const showEventIcons = useSettingsStore((state) => state.showEventIcons)
  const openModal = useCalendarStore((state) => state.openModal)
  const closePreview = useCalendarStore((state) => state.closePreview)
  const [isClosing, setIsClosing] = useState(false)
  const prefersReducedMotion = useReducedMotion()
  const animateClose = useCallback(() => {
    if (isClosing) return
    setIsClosing(true)
    setTimeout(() => closePreview(), prefersReducedMotion ? 0 : 150)
  }, [closePreview, isClosing, prefersReducedMotion])
  const deleteEvent = useCalendarStore((state) => state.deleteEvent)
  const updateEvent = useCalendarStore((state) => state.updateEvent)
  const {
    createEvent: createCalDAVEvent,
    updateEvent: updateCalDAVEvent,
    saveRecurrenceOverride,
    deleteEvent: deleteCalDAVEvent,
  } = useCalDAV()
  const originalEventId = extractOriginalEventId(clickedEventId)
  const eventIdToUse = originalEventId || event.id

  const recurrenceDescription = useMemo(() => describeRecurrence(event), [event])
  // For recurring event occurrences, the event prop is the parent series.
  // The actual occurrence start is encoded in clickedEventId after the parent id.
  const occurrenceStartISO = originalEventId
    ? clickedEventId.slice(originalEventId.length + 1)
    : null
  const effectiveStart = occurrenceStartISO ?? event.start
  const effectiveEnd = occurrenceStartISO
    ? new Date(
        parseISO(occurrenceStartISO).getTime() +
          (parseISO(event.end).getTime() - parseISO(event.start).getTime())
      ).toISOString()
    : event.end

  const isMultiDay = !isSameDay(parseISO(event.originalStart || event.start), parseISO(event.originalEnd || event.end))
  const isTask = event.type === 'task'
  const dateFormatPattern =
    dateFormat === 'MM/dd/yyyy'
      ? 'MMM d, yyyy'
      : dateFormat === 'dd/MM/yyyy'
        ? 'd MMM yyyy'
        : 'yyyy-MM-dd'

  const [editingField, setEditingField] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState(event.title)
  const [editDate, setEditDate] = useState('')
  const [editEndDate, setEditEndDate] = useState('')
  const [editTime, setEditTime] = useState('')
  const [editEndTime, setEditEndTime] = useState('')
  const [editLocation, setEditLocation] = useState(event.location || '')
  const [editDescription, setEditDescription] = useState(event.description || '')
  const [hasChanges, setHasChanges] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showRecurrenceDialog, setShowRecurrenceDialog] = useState(false)
  const [pendingUpdates, setPendingUpdates] = useState<Partial<CalendarEvent> | null>(null)

  const getEventDate = (): string => {
    if (editDate) return format(parseISO(editDate), dateFormatPattern)
    if (isTask && event.dueDate) {
      return format(parseISO(event.dueDate), dateFormatPattern)
    }
    return format(parseISO(effectiveStart), dateFormatPattern)
  }

  const getEventTime = (): string => {
    if (isTask) {
      if (!event.dueDate) {
        return 'No due date'
      }
      // For tasks with an actual time (not midnight), show the time
      if (hasDueTime(event)) {
        return formatTime(event.dueDate, timeFormat)
      }
      // For all-day tasks or tasks with no specific time
      return format(parseISO(event.dueDate), dateFormatPattern)
    }
    if (event.isAllDay) {
      return 'All day'
    }
    if (editTime) {
      const fmt = (t: string) => formatTime(`2000-01-01T${t}:00`, timeFormat)
      return `${fmt(editTime)} - ${fmt(editEndTime || editTime)}`
    }
    if (isMultiDay) {
      return `${formatTime(event.originalStart || event.start, timeFormat)} - ${formatTime(event.originalEnd || event.end, timeFormat)}`
    }
    return `${formatTime(effectiveStart, timeFormat)} - ${formatTime(effectiveEnd, timeFormat)}`
  }

  const startEditing = (field: string): void => {
    setEditingField(field)
    // Only initialise date/time if not already set (empty = not yet opened or cancelled).
    // title/location/description are pre-seeded from useState and kept across field switches.
    if (field === 'date' && !editDate) {
      if (isTask && event.dueDate) {
        setEditDate(event.dueDate)
      } else {
        setEditDate(format(parseISO(effectiveStart), 'yyyy-MM-dd'))
      }
    } else if (field === 'endDate' && !editEndDate) {
      setEditEndDate(format(parseISO(effectiveEnd), 'yyyy-MM-dd'))
    } else if (field === 'time') {
      if (!editTime) {
        if (isTask && event.dueDate) {
          setEditTime(format(parseISO(event.dueDate), 'HH:mm'))
        } else {
          setEditTime(format(parseISO(effectiveStart), 'HH:mm'))
        }
      }
      if (!editEndTime && !isTask) {
        setEditEndTime(format(parseISO(effectiveEnd), 'HH:mm'))
      }
    }
  }

  const saveChanges = async (): Promise<void> => {
    const updates: Partial<CalendarEvent> = {
      title: editTitle,
      location: editLocation || undefined,
      description: editDescription || undefined,
    }

    if (isTask && editDate) {
      updates.dueDate = editDate
      if (editTime) {
        updates.start = `${editDate}T${editTime}:00`
      } else {
        updates.start = `${editDate}T00:00:00`
        updates.isAllDay = true
      }
    } else if (!isTask && (editDate || editTime || editEndDate || editEndTime)) {
      // Only build start/end when the user actually edited a date or time field.
      // Otherwise a title/location-only edit would carry the clicked occurrence's
      // date into `updates.start` and, for an "All events" edit, move the whole
      // series anchor onto that date — silently dropping every earlier occurrence.
      const originalDate = format(parseISO(effectiveStart), 'yyyy-MM-dd')
      const dateToUse = editDate || originalDate
      const startTime = editTime || format(parseISO(effectiveStart), 'HH:mm')
      const endTime = editEndTime || format(parseISO(effectiveEnd), 'HH:mm')
      updates.start = `${dateToUse}T${startTime}:00`

      const originalEndDate = format(parseISO(effectiveEnd), 'yyyy-MM-dd')
      const endDateToUse = editEndDate || originalEndDate
      updates.end = `${endDateToUse}T${endTime}:00`

      // Safety net: the end-date field (editingField === 'endDate') has no
      // shifting logic of its own, so it can still be set to a date before
      // the start independently. Refuse to persist an inverted range rather
      // than silently saving start > end (issue #44).
      if (new Date(updates.end).getTime() <= new Date(updates.start).getTime()) {
        showToast('End must be after start')
        return
      }
    }

    if (event.recurrenceId && originalEventId) {
      const masterEvent = useCalendarStore.getState().events.find((candidate) => candidate.id === originalEventId)
      if (!masterEvent) {
        showToast('Master event not found. Cannot edit this occurrence.')
        return
      }
      try {
        await saveRecurrenceOverride(event.calendarId, masterEvent, { ...event, ...updates })
      } catch {
        showToast('Failed to update this occurrence. The original event was kept.')
        return
      }
      setHasChanges(false)
      setEditingField(null)
      return
    }

    const recurring = !!event.recurrence || !!event.rruleString || !!originalEventId
    if (recurring) {
      setPendingUpdates(updates)
      setShowRecurrenceDialog(true)
      return
    }

    updateEvent(eventIdToUse, updates)
    setHasChanges(false)
    setEditingField(null)

    try {
      await updateCalDAVEvent(event.calendarId, { ...event, ...updates })
    } catch {
      // error handled by useCalDAV
    }
  }

  const handleRecurrenceDialogConfirm = async (mode: 'all' | 'future' | 'this'): Promise<void> => {
    if (!pendingUpdates) return

    const store = useCalendarStore.getState()
    const masterEvent = store.events.find((e) => e.id === eventIdToUse)
    const occurrenceStartISO = originalEventId
      ? clickedEventId.slice(originalEventId.length + 1)
      : event.start
    const occurrenceDateStr = occurrenceStartISO.split('T')[0]

    if (mode === 'this') {
      // Edit only this occurrence: create/patch a standalone exception at the
      // clicked occurrence's date and exclude that date from the master so it
      // isn't rendered twice.
      const existingException = store.events.find(
        (e) => e.id === clickedEventId && !e.rruleString && !e.recurrence
      )

      if (existingException) {
        if (!masterEvent) {
          showToast('Master event not found. Cannot edit single occurrence.')
          return
        }
        const masterWithoutLegacyExdate = {
          ...masterEvent,
          excludedDates: masterEvent.excludedDates?.filter(
            (date) => date.split('T')[0] !== occurrenceDateStr
          ),
        }
        try {
          await saveRecurrenceOverride(event.calendarId, masterWithoutLegacyExdate, {
            ...existingException,
            ...pendingUpdates,
          })
        } catch {
          showToast('Failed to update this occurrence. The original event was kept.')
          return
        }
      } else {
        const exceptionEvent: CalendarEvent = {
          id: clickedEventId,
          uid: masterEvent?.uid || masterEvent?.id || event.uid || event.id,
          title: pendingUpdates.title ?? event.title,
          description: pendingUpdates.description ?? event.description,
          location: pendingUpdates.location ?? event.location,
          start: pendingUpdates.start ?? effectiveStart,
          end: pendingUpdates.end ?? effectiveEnd,
          isAllDay: event.isAllDay,
          calendarId: event.calendarId,
          recurrence: undefined,
          rruleString: undefined,
          recurrenceId: occurrenceStartISO,
          recurrenceMasterId: originalEventId || eventIdToUse,
        }
        if (masterEvent) {
          const masterWithoutLegacyExdate = {
            ...masterEvent,
            excludedDates: masterEvent.excludedDates?.filter(
              (date) => date.split('T')[0] !== occurrenceDateStr
            ),
          }
          try {
            await saveRecurrenceOverride(
              event.calendarId,
              masterWithoutLegacyExdate,
              exceptionEvent
            )
          } catch {
            showToast('Failed to update this occurrence. The original event was kept.')
            return
          }
        }
      }
    } else if (mode === 'future' && masterEvent && originalEventId) {
      // Split the series at this occurrence: truncate the master to before it and
      // start a new series here carrying the edited fields. The new series keeps
      // the master's original recurrence rule (captured before truncation).
      const newSeriesRecurrence = masterEvent.recurrence
      const newSeriesRrule = masterEvent.rruleString
      const { excludedDates, recurrence, rruleString } = buildMasterTruncation(
        masterEvent,
        occurrenceStartISO
      )
      updateEvent(masterEvent.id, { excludedDates, recurrence, rruleString })
      safeCalDAVUpdate(
        updateCalDAVEvent,
        masterEvent.calendarId,
        { ...masterEvent, excludedDates, recurrence, rruleString },
        { excludedDates, recurrence, rruleString }
      )

      const newSeriesEvent: CalendarEvent = {
        id: uuidv4(),
        calendarId: masterEvent.calendarId,
        title: pendingUpdates.title ?? masterEvent.title,
        description: pendingUpdates.description ?? masterEvent.description,
        location: pendingUpdates.location ?? masterEvent.location,
        start: pendingUpdates.start ?? effectiveStart,
        end: pendingUpdates.end ?? effectiveEnd,
        isAllDay: masterEvent.isAllDay,
        recurrence: newSeriesRecurrence,
        rruleString: newSeriesRrule,
        reminders: masterEvent.reminders,
        transparency: masterEvent.transparency,
      }
      store.addEvent(newSeriesEvent)
      try {
        await createCalDAVEvent(masterEvent.calendarId, newSeriesEvent)
      } catch {
        // error handled by useCalDAV
      }
    } else {
      // 'all' — apply the edits to the whole series WITHOUT moving its anchor.
      // pendingUpdates.start/end were derived from the clicked occurrence's date;
      // re-anchor any time-of-day change onto the master's own dates so earlier
      // occurrences aren't dropped.
      const allUpdates: Partial<CalendarEvent> = { ...pendingUpdates }
      if (masterEvent) {
        if (allUpdates.start) {
          const masterDate = format(parseISO(masterEvent.start), 'yyyy-MM-dd')
          allUpdates.start = `${masterDate}T${allUpdates.start.split('T')[1]}`
        }
        if (allUpdates.end) {
          const masterEndDate = format(parseISO(masterEvent.end), 'yyyy-MM-dd')
          allUpdates.end = `${masterEndDate}T${allUpdates.end.split('T')[1]}`
        }
      }
      updateEvent(eventIdToUse, allUpdates)
      try {
        const eventToSync = masterEvent || event
        await updateCalDAVEvent(eventToSync.calendarId, { ...eventToSync, ...allUpdates })
      } catch {
        // error handled by useCalDAV
      }
    }

    setPendingUpdates(null)
    setShowRecurrenceDialog(false)
    setHasChanges(false)
    setEditingField(null)
    closePreview()
  }

  const cancelEditing = useCallback(() => {
    setEditTitle(event.title)
    setEditDate('')
    setEditEndDate('')
    setEditTime('')
    setEditEndTime('')
    setEditLocation(event.location || '')
    setEditDescription(event.description || '')
    setEditingField(null)
    setHasChanges(false)
  }, [event.title, event.location, event.description])

  const cancelEditingRef = useRef(cancelEditing)
  useEffect(() => {
    cancelEditingRef.current = cancelEditing
  }, [cancelEditing])

  // Escape cancels an in-progress field edit, otherwise dismisses the popup.
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (editingField) {
        cancelEditingRef.current()
      } else {
        animateClose()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [editingField, animateClose])

  const handleFieldChange = (field: string, value: string): void => {
    setHasChanges(true)
    if (field === 'title') {
      setEditTitle(value)
    } else if (field === 'date') {
      if (!isTask) {
        // Shift the end date by the same number of days the start date moved,
        // preserving the event's span so a multi-day/overnight event doesn't
        // end up with start > end (issue #44).
        const oldStartDate = editDate || format(parseISO(effectiveStart), 'yyyy-MM-dd')
        const oldEndDate = editEndDate || format(parseISO(effectiveEnd), 'yyyy-MM-dd')
        const dayDelta = daysBetween(oldStartDate, value)
        setEditEndDate(addDays(oldEndDate, dayDelta))
      }
      setEditDate(value)
    } else if (field === 'endDate') {
      setEditEndDate(value)
    } else if (field === 'time') {
      setEditTime(value)
    } else if (field === 'endTime') {
      setEditEndTime(value)
    } else if (field === 'location') {
      setEditLocation(value)
    } else if (field === 'description') {
      setEditDescription(value)
    }
  }

  const handleOpen = (): void => {
    closePreview()
    // Pass the clicked occurrence id (for recurring instances this is
    // `masterId-<ISO>`, otherwise the plain event id) so the editor can tell
    // which occurrence is being edited. Passing the master id here would make
    // "This event only" / "This and following events" silently edit the whole
    // series.
    openModal(undefined, undefined, clickedEventId)
  }

  const isRecurring = !event.recurrenceId && (!!event.recurrence || !!event.rruleString || !!originalEventId)

  const handleDelete = async (): Promise<void> => {
    if (event.recurrenceId) {
      await performDelete('this')
      return
    }
    if (isRecurring) {
      setShowDeleteDialog(true)
      return
    }
    const idToDelete = originalEventId || event.id
    await safeCalDAVDelete(deleteCalDAVEvent, event.calendarId, idToDelete)
    deleteEvent(idToDelete)
    closePreview()
  }

  const performDelete = async (mode: 'all' | 'this' | 'future'): Promise<void> => {
    const recurringMasterId = originalEventId || event.id
    if (mode === 'this') {
      // For 'this' occurrence: exclude the date from the master event
      const storedEvents = useCalendarStore.getState().events
      const selectedException = storedEvents.find((candidate) => candidate.id === clickedEventId)
      const occurrenceStartISO =
        selectedException?.recurrenceId ||
        (originalEventId ? clickedEventId.slice(originalEventId.length + 1) : event.start)
      const occurrenceDate = occurrenceStartISO.split('T')[0]
      const masterEvent = storedEvents.find((e) => e.id === recurringMasterId)
      if (masterEvent) {
        const exclusionValue = masterEvent.isAllDay ? occurrenceDate : occurrenceStartISO
        const excludedDates = masterEvent.excludedDates || []
        const updatedExcludedDates = excludedDates.includes(exclusionValue)
          ? excludedDates
          : [...excludedDates, exclusionValue]
        try {
          await saveRecurrenceOverride(
            masterEvent.calendarId,
            { ...masterEvent, excludedDates: updatedExcludedDates },
            null,
            selectedException?.recurrenceId ? [selectedException.id] : []
          )
        } catch {
          showToast('Failed to delete this occurrence. The event was kept.')
          return
        }
      }
    } else if (mode === 'future') {
      const storedEvents = useCalendarStore.getState().events
      const masterEvent = storedEvents.find((candidate) => candidate.id === recurringMasterId)
      const selectedException = storedEvents.find((candidate) => candidate.id === clickedEventId)
      const occurrenceStart =
        selectedException?.recurrenceId ||
        (originalEventId ? clickedEventId.slice(originalEventId.length + 1) : event.start)
      const occurrenceDate = occurrenceStart.split('T')[0]
      if (masterEvent && occurrenceDate) {
        if (isFirstOccurrence(masterEvent, occurrenceStart)) {
          if (masterEvent.calendarId !== 'default') {
            await safeCalDAVDelete(deleteCalDAVEvent, masterEvent.calendarId, masterEvent.id)
          }
          deleteEvent(masterEvent.id)
          closePreview()
          setShowDeleteDialog(false)
          return
        }
        const truncation = buildMasterTruncation(masterEvent, occurrenceStart)
        const removedOverrideIds = getFutureOverrideIds(storedEvents, masterEvent, occurrenceStart)
        try {
          await saveRecurrenceOverride(
            masterEvent.calendarId,
            { ...masterEvent, ...truncation },
            null,
            removedOverrideIds
          )
        } catch {
          showToast('Failed to delete this and following events. The series was kept.')
          return
        }
      }
    } else {
      // Delete entire series
      const idToDelete = originalEventId || event.id
      if (event.calendarId && event.calendarId !== 'default') {
        await safeCalDAVDelete(deleteCalDAVEvent, event.calendarId, idToDelete)
      }
      deleteEvent(idToDelete)
    }
    closePreview()
    setShowDeleteDialog(false)
  }

  const adjustedPosition = (() => {
    const popupWidth = 320
    const popupHeight = 420
    const padding = 10
    let { x, y } = position

    if (x + popupWidth + padding > window.innerWidth) {
      x = window.innerWidth - popupWidth - padding
    }
    if (y + popupHeight + padding > window.innerHeight) {
      y = window.innerHeight - popupHeight - padding
    }

    return { x, y }
  })()

  useEffect(() => {
    const handleContextMenu = (): void => {
      closePreview()
    }
    document.addEventListener('contextmenu', handleContextMenu)
    return () => document.removeEventListener('contextmenu', handleContextMenu)
  }, [closePreview])

  const renderTitle = (): JSX.Element => {
    if (editingField === 'title') {
      return (
        <input
          type="text"
          value={editTitle}
          onChange={(e) => handleFieldChange('title', e.target.value)}
          onBlur={() => setEditingField(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              saveChanges()
            }
          }}
          className={styles.titleInput}
          autoFocus
        />
      )
    }
    return (
      <span className={styles.title} onClick={() => startEditing('title')}>
        {editTitle}
      </span>
    )
  }

  const renderDate = (): JSX.Element => {
    if (editingField === 'date') {
      return (
        <input
          type="date"
          value={editDate}
          onChange={(e) => handleFieldChange('date', e.target.value)}
          onBlur={() => setEditingField(null)}
          className={styles.inlineInput}
          autoFocus
        />
      )
    }
    if (editingField === 'endDate') {
      return (
        <>
          <span onClick={(e) => { e.stopPropagation(); startEditing('date') }}>{format(parseISO(event.originalStart || event.start), dateFormatPattern)}</span>
          <span> - </span>
          <input
            type="date"
            value={editEndDate}
            onChange={(e) => handleFieldChange('endDate', e.target.value)}
            onBlur={() => setEditingField(null)}
            className={styles.inlineInput}
            autoFocus
          />
        </>
      )
    }
    if (isMultiDay) {
      const startDisplay = format(parseISO(event.originalStart || event.start), dateFormatPattern)
      const endDisplay = format(parseISO(event.originalEnd || event.end), dateFormatPattern)
      return (
        <>
          <span onClick={(e) => { e.stopPropagation(); startEditing('date') }}>{startDisplay}</span>
          <span> - </span>
          <span onClick={(e) => { e.stopPropagation(); startEditing('endDate') }}>{endDisplay}</span>
        </>
      )
    }
    return <span onClick={() => startEditing('date')}>{getEventDate()}</span>
  }

  const renderTime = (): JSX.Element => {
    if (editingField === 'time') {
      return (
        <div
          className={styles.inlineTimeInputs}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) {
              setEditingField(null)
            }
          }}
        >
          <input
            type="time"
            value={editTime}
            onChange={(e) => handleFieldChange('time', e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                saveChanges()
              }
            }}
            className={styles.inlineInput}
            autoFocus
          />
          {!isTask && (
            <>
              <span>-</span>
              <input
                type="time"
                value={editEndTime}
                onChange={(e) => handleFieldChange('endTime', e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    saveChanges()
                  }
                }}
                className={styles.inlineInput}
              />
            </>
          )}
        </div>
      )
    }
    return <span onClick={() => startEditing('time')}>{getEventTime()}</span>
  }

  const renderLocation = (): JSX.Element | null => {
    if (editingField === 'location') {
      return (
        <input
          type="text"
          value={editLocation}
          onChange={(e) => handleFieldChange('location', e.target.value)}
          onBlur={() => setEditingField(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              saveChanges()
            }
          }}
          className={styles.inlineInput}
          autoFocus
        />
      )
    }
    if (editLocation) {
      return (
        <span className={styles.location} onClick={() => startEditing('location')}>
          {editLocation}
        </span>
      )
    }
    return null
  }

  const renderDescription = (): JSX.Element | null => {
    if (editingField === 'description') {
      return (
        <textarea
          value={editDescription}
          onChange={(e) => handleFieldChange('description', e.target.value)}
          onBlur={() => setEditingField(null)}
          className={styles.descriptionInput}
          rows={3}
          autoFocus
        />
      )
    }
    if (editDescription) {
      return (
        <div className={styles.descriptionText} onClick={() => startEditing('description')}>
          {editDescription}
        </div>
      )
    }
    return (
      <div className={styles.addDescription} onClick={() => startEditing('description')}>
        + Add description
      </div>
    )
  }

  const getReminderLabel = (): string | null => {
    if (!event.reminders || event.reminders.length === 0) return null
    const minutes = event.reminders[0]?.minutesBefore
    if (minutes === undefined) return null
    return REMINDER_LABELS[minutes] || `${minutes} minutes before`
  }

  const reminderLabel = getReminderLabel()

  // Decorative keyword icon for the popup header (uses live-edited title).
  const backgroundId = showEventIcons ? matchEventBackground(editTitle || event.location) : null

  return (
    <>
      {createPortal(
        <>
          {/* Backdrop — closes popup, blocks clicks behind */}
          {!showDeleteDialog && !showRecurrenceDialog && (
            <div
              className={styles.backdrop}
              onClick={() => {
                if (editingField) {
                  cancelEditingRef.current()
                } else {
                  animateClose()
                }
              }}
            />
          )}
          <AnimatePresence>
            {!isClosing && (
              <motion.div
                key="preview-popup"
                ref={popupRef}
                className={styles.popup}
                data-component="event-preview"
                style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
                initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.95, y: -10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: -10 }}
                transition={{ duration: prefersReducedMotion ? 0 : 0.15 }}
              >
        <div
          className={styles.header}
          data-has-background={backgroundId ? '' : undefined}
          style={{ ['--event-color' as string]: event.color || '#4285F4' }}
        >
          {backgroundId && (
            <EventBackground
              id={backgroundId}
              className={styles.keywordBackground}
            />
          )}
          <div className={styles.titleRow}>
            <div
              className={styles.colorDot}
              style={{ backgroundColor: event.color || '#4285F4' }}
            />
            {renderTitle()}
          </div>
          <button className={styles.closeBtn} onClick={animateClose} aria-label="Close">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M12 4L4 12M4 4L12 12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.field}>
            <svg aria-hidden="true" className={styles.icon} width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect
                x="2"
                y="3"
                width="10"
                height="9"
                rx="1"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <path d="M2 6H12" stroke="currentColor" strokeWidth="1.2" />
              <path
                d="M5 1V3M9 1V3"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
            {renderDate()}
            {(event.recurrence || event.rruleString) && (
              <span
                className={styles.recurringIcon}
                data-tooltip={recurrenceDescription}
              >
                <RecurringIcon />
              </span>
            )}
          </div>

          

          <div
            className={styles.field}
            onClick={() => startEditing('time')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                startEditing('time')
              }
            }}
            aria-label="Edit time"
          >
            <svg aria-hidden="true" className={styles.icon} width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" />
              <path d="M7 4V7L9 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            {renderTime()}
          </div>

          {(editLocation || event.location) && (
            <div
              className={styles.field}
              onClick={() => startEditing('location')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  startEditing('location')
                }
              }}
              aria-label="Edit location"
            >
              <svg aria-hidden="true" className={styles.icon} width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M7 6.5C8.10457 6.5 9 5.60457 9 4.5C9 3.39543 8.10457 2.5 7 2.5C5.89543 2.5 5 3.39543 5 4.5C5 5.60457 5.89543 6.5 7 6.5Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
                <path
                  d="M7 13C7 13 12 8.5 12 4.5C12 2.019 10.104 0 7 0C3.896 0 2 2.019 2 4.5C2 8.5 7 13 7 13Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
              </svg>
              {renderLocation()}
              <LocationLink
                location={editLocation || event.location || ''}
                className={styles.locationMapLink}
                iconOnly
                ariaLabel={`Open ${editLocation || event.location} in Maps (new tab)`}
              />
            </div>
          )}

          {event.travelDuration !== undefined && event.travelDuration > 0 && (
            <div className={styles.field}>
              <svg aria-hidden="true" className={styles.icon} width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M1 10L4 7L6 9L13 2"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M10 2H13V5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>{Math.round(event.travelDuration)} min travel</span>
            </div>
          )}

          {reminderLabel && (
            <div className={styles.field}>
              <svg aria-hidden="true" className={styles.icon} width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M7 1.5C4.51472 1.5 2.5 3.51472 2.5 6C2.5 8.48528 4.51472 10.5 7 10.5C9.48528 10.5 11.5 8.48528 11.5 6C11.5 3.51472 9.48528 1.5 7 1.5Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
                <path
                  d="M7 3V6L9 8"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>{reminderLabel}</span>
            </div>
          )}

          {isTask && event.priority !== undefined && event.priority > 0 && (
            <div className={styles.field}>
              <svg aria-hidden="true" className={styles.icon} width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M7 1V7M7 7V13"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M7 10.5H7.01"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              <span>Priority: {event.priority}</span>
            </div>
          )}

          {isTask && event.completed && (
            <div className={styles.field}>
              <svg aria-hidden="true" className={styles.icon} width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" />
                <path
                  d="M4 7L6 9L10 5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>Completed</span>
            </div>
          )}

          <div className={styles.description}>
            <div className={styles.descriptionLabel}>Description</div>
            {renderDescription()}
          </div>
        </div>

        <div className={styles.footer}>
          {hasChanges && (
            <button className={styles.saveBtn} onClick={saveChanges} aria-label="Save changes">
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M2 7L5.5 10.5L12 4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
          <button className={styles.openBtn} onClick={handleOpen}>
            {isTask ? 'Open task' : 'Open event'}
          </button>
          <button className={styles.deleteBtn} onClick={handleDelete} aria-label="Delete">
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M2 4H12M5 4V2H9V4M4 4V12H10V4"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

            </motion.div>
          )}
        </AnimatePresence>
        </>
    ,
    document.body
    )}
    {createPortal(
      <DeleteDialog
        key="delete-dialog"
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={(mode) => {
          performDelete(mode)
        }}
      />,
      document.body
    )}
    {createPortal(
      <RecurrenceDialog
        key="recurrence-dialog"
        isOpen={showRecurrenceDialog}
        onClose={() => {
          setShowRecurrenceDialog(false)
          setPendingUpdates(null)
        }}
        onConfirm={handleRecurrenceDialogConfirm}
      />,
      document.body
    )}
    </>
  )
}
