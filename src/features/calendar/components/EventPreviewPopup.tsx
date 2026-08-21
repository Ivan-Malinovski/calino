import { type JSX, useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { format, parseISO, isSameDay } from 'date-fns'
import { v4 as uuidv4 } from 'uuid'
import {
  formatTime,
  formatEventTime,
  toEventInstant,
  daysBetween,
  addDays,
  addMinutesToTimeStr,
  deviceTimezone,
} from '@/lib/datetime'
import { buildMasterTruncation } from '@/lib/recurrenceSplit'
import { materializeOccurrenceAt } from '@/lib/occurrenceExpansion'
import { showToast } from '@/lib/toast'
import { motion, AnimatePresence, animate } from 'framer-motion'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useSheetSwipeDismiss } from '@/hooks/useSheetSwipeDismiss'
import { useSettingsStore } from '@/store/settingsStore'
import { useCalendarStore } from '@/store/calendarStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { safeCalDAVUpdate } from '@/lib/caldavHelpers'
import { DeleteDialog } from './DeleteDialog'
import { RecurrenceDialog } from './RecurrenceDialog'
import { LocationLink } from './LocationLink'
import { RecurringIcon } from '@/components/common/icons'
import { EventBackground } from '@/components/common/EventBackground'
import { matchEventBackground } from '@/lib/eventBackground'
import { describeRecurrence } from '@/lib/recurrence'
import { hasDueTime, extractOriginalEventId } from '@/lib/events'
import type { CalendarEvent, RecurrenceEditMode } from '@/types'
import { deleteRecurringOccurrence } from '@/lib/recurrenceDelete'
import { buildMailtoUri } from '@/lib/mailtoInvite'
import { deleteEventWithUndo } from '@/lib/deleteWithUndo'
import { completeTaskAndSync } from '@/lib/taskCompletion'
import { getDirectSubtasks } from '@/lib/taskTree'
import { TimeField } from './TimeField'
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
  const defaultDuration = useSettingsStore((state) => state.defaultDuration)
  const openModal = useCalendarStore((state) => state.openModal)
  const closePreview = useCalendarStore((state) => state.closePreview)
  const events = useCalendarStore((state) => state.events)
  const calendars = useCalendarStore((state) => state.calendars)
  const completeTask = useCalendarStore((state) => state.completeTask)
  const completeTaskOccurrence = useCalendarStore((state) => state.completeTaskOccurrence)
  const [isClosing, setIsClosing] = useState(false)
  const prefersReducedMotion = useReducedMotion()
  const isMobile = useIsMobile()
  const scrollRef = useRef<HTMLDivElement>(null)
  // On mobile the popup is a bottom sheet: it slides up on open and can be
  // swiped back down, both driven by this one motion value bound to its `y`.
  const sheetY = useSheetSwipeDismiss({
    enabled: isMobile,
    open: !isClosing,
    sheetRef: popupRef,
    scrollRef,
    onDismiss: closePreview,
    reducedMotion: prefersReducedMotion,
  })
  const animateClose = useCallback(() => {
    if (isClosing) return
    setIsClosing(true)
    // The sheet leaves the way it arrived — sliding down — rather than fading
    // in place, which reads as the panel blinking out on a phone.
    if (isMobile && !prefersReducedMotion) {
      animate(sheetY, window.innerHeight, { duration: 0.18, ease: 'easeIn' })
      setTimeout(() => closePreview(), 180)
      return
    }
    setTimeout(() => closePreview(), prefersReducedMotion ? 0 : 150)
  }, [closePreview, isClosing, isMobile, prefersReducedMotion, sheetY])
  const deleteEvent = useCalendarStore((state) => state.deleteEvent)
  const addEvent = useCalendarStore((state) => state.addEvent)
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
          (toEventInstant(event.end, event.timezone).getTime() -
            toEventInstant(event.start, event.timezone).getTime())
      ).toISOString()
    : event.end

  const isMultiDay = !isSameDay(
    event.isAllDay
      ? parseISO(event.originalStart || event.start)
      : toEventInstant(event.originalStart || event.start, event.timezone),
    event.isAllDay
      ? parseISO(event.originalEnd || event.end)
      : toEventInstant(event.originalEnd || event.end, event.timezone)
  )
  const isTask = event.type === 'task'
  const currentTask = useMemo(() => {
    const storedTask = events.find((candidate) => candidate.id === event.id) ?? event
    if (!isTask || !occurrenceStartISO) return storedTask

    const occurrence = materializeOccurrenceAt(storedTask, occurrenceStartISO)
    const occurrenceOverride = events.find(
      (candidate) =>
        candidate.type === 'task' &&
        candidate.recurrenceId === occurrenceStartISO &&
        (candidate.uid === (storedTask.uid || storedTask.id) ||
          candidate.recurrenceMasterId === storedTask.id)
    )

    return occurrenceOverride
      ? {
          ...occurrence,
          completed: occurrenceOverride.completed,
          taskStatus: occurrenceOverride.taskStatus,
          percentComplete: occurrenceOverride.percentComplete,
          completedAt: occurrenceOverride.completedAt,
        }
      : occurrence
  }, [event, events, isTask, occurrenceStartISO])
  const directSubtasks = useMemo(
    () => (isTask ? getDirectSubtasks(events, event.id) : []),
    [event.id, events, isTask]
  )
  const parentTask = useMemo(
    () =>
      isTask && event.parentTaskId
        ? events.find((candidate) => candidate.id === event.parentTaskId)
        : undefined,
    [event.parentTaskId, events, isTask]
  )
  const isReadOnlyCalendar =
    calendars.find((calendar) => calendar.id === currentTask.calendarId)?.readOnly === true
  const [taskCompleted, setTaskCompleted] = useState(Boolean(currentTask.completed))

  useEffect(() => {
    setTaskCompleted(Boolean(currentTask.completed))
  }, [currentTask.completed, currentTask.id])

  const handleTaskCompletion = async (task: CalendarEvent): Promise<void> => {
    if (calendars.find((calendar) => calendar.id === task.calendarId)?.readOnly === true) return
    if (task.id === currentTask.id) setTaskCompleted(!task.completed)
    try {
      await completeTaskAndSync(task, !task.completed, {
        completeTask,
        completeTaskOccurrence,
        updateCalDAVEvent,
        saveRecurrenceOverride,
      })
    } catch {
      // The CalDAV hook queues failed writes and surfaces their status.
    }
  }
  // Phase 2 (C2) — TZID events store naive wall clocks in the event zone, so
  // the popup must read them as instants before displaying or seeding edit
  // fields (mirrors EventCard/EventModal). All-day dates stay floating — a
  // bare date through toEventInstant would shift a day west of UTC.
  const instantFor = (iso: string): Date =>
    event.isAllDay ? parseISO(iso) : toEventInstant(iso, event.timezone)
  // R1 — a timed TZID task's dueDate follows the same storage invariant as
  // start/end: a naive wall clock in the event zone. All-day dueDates are
  // floating dates and must not pass through the zone conversion.
  const dueInstantFor = (iso: string): Date =>
    isTask && !event.isAllDay && event.timezone
      ? toEventInstant(iso, event.timezone)
      : parseISO(iso)
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
      return format(dueInstantFor(event.dueDate), dateFormatPattern)
    }
    return format(instantFor(effectiveStart), dateFormatPattern)
  }

  const getEventTime = (): string => {
    if (isTask) {
      if (!event.dueDate) {
        return 'No due date'
      }
      // For tasks with an actual time (not midnight), show the time
      if (hasDueTime(event)) {
        return formatEventTime(event.dueDate, event.timezone, timeFormat)
      }
      // For all-day tasks or tasks with no specific time
      return format(parseISO(event.dueDate), dateFormatPattern)
    }
    if (event.isAllDay) {
      return 'All day'
    }
    if (editTime) {
      // The draft is device-frame 'HH:mm' already — never run it through the
      // event's timezone.
      const fmt = (t: string) => formatTime(`2000-01-01T${t}:00`, timeFormat)
      return `${fmt(editTime)} - ${fmt(editEndTime || editTime)}`
    }
    if (isMultiDay) {
      return `${formatEventTime(event.originalStart || event.start, event.timezone, timeFormat)} - ${formatEventTime(event.originalEnd || event.end, event.timezone, timeFormat)}`
    }
    return `${formatEventTime(effectiveStart, event.timezone, timeFormat)} - ${formatEventTime(effectiveEnd, event.timezone, timeFormat)}`
  }

  const startEditing = (field: string): void => {
    setEditingField(field)
    // Only initialise date/time if not already set (empty = not yet opened or cancelled).
    // title/location/description are pre-seeded from useState and kept across field switches.
    if (field === 'date' && !editDate) {
      if (isTask && event.dueDate) {
        // Date part of the DEVICE-frame instant — an event-zone dueDate near
        // midnight falls on a different device-local date.
        setEditDate(format(dueInstantFor(event.dueDate), 'yyyy-MM-dd'))
      } else {
        setEditDate(format(instantFor(effectiveStart), 'yyyy-MM-dd'))
      }
    } else if (field === 'endDate' && !editEndDate) {
      setEditEndDate(format(instantFor(effectiveEnd), 'yyyy-MM-dd'))
    } else if (field === 'time') {
      if (!editTime) {
        if (isTask && event.dueDate) {
          setEditTime(format(dueInstantFor(event.dueDate), 'HH:mm'))
        } else {
          setEditTime(format(instantFor(effectiveStart), 'HH:mm'))
        }
      }
      if (!editEndTime && !isTask) {
        setEditEndTime(format(instantFor(effectiveEnd), 'HH:mm'))
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
      // Keep the task's own time unless the user actually edited it. The time
      // used to be read from the edit field alone, which is empty until that
      // field is opened — so editing just the date dropped the time and forced
      // the task to all-day. On a repeating task that also left a timed UNTIL
      // on an otherwise all-day rule, which RFC 5545 §3.3.10 doesn't allow.
      // Clearing the time field is still how a task becomes all-day.
      const existingTime =
        hasDueTime(event) && event.dueDate ? format(dueInstantFor(event.dueDate), 'HH:mm') : ''
      const dueTime = editTime || existingTime
      //
      // `end` moves with `start`. It was left behind before, which put the
      // task's end before its start — the store diverts that into
      // `brokenEvents` and the task vanishes from the calendar. The old code
      // escaped that check only because forcing isAllDay exempted it. The
      // shapes match what EventModal writes for a task.
      if (dueTime) {
        // R1 — the edit fields are device-frame, but a timed TZID task's
        // dueDate/start/end are naive wall clocks in the event zone. Write a
        // device-frame Z instant and let the store re-frame all three via
        // toZoneWallClock, exactly like the non-task branch below.
        const dueInstant = new Date(`${editDate}T${dueTime}:00`).toISOString()
        updates.dueDate = dueInstant
        updates.start = dueInstant
        updates.end = dueInstant
        updates.isAllDay = false
      } else {
        updates.dueDate = editDate
        updates.start = `${editDate}T00:00:00`
        updates.end = `${editDate}T23:59:59`
        updates.isAllDay = true
      }
    } else if (!isTask && (editDate || editTime || editEndDate || editEndTime)) {
      // Only build start/end when the user actually edited a date or time field.
      // Otherwise a title/location-only edit would carry the clicked occurrence's
      // date into `updates.start` and, for an "All events" edit, move the whole
      // series anchor onto that date — silently dropping every earlier occurrence.
      // Phase 2 (C3) — the edit fields above are device-frame, but TZID
      // events store naive wall clocks in the event zone. Write a device-frame
      // Z instant and let the store re-frame it into the event zone via
      // toZoneWallClock (calendarStore.updateEvent), exactly like EventModal.
      // Timezone-less events store UTC instants, so toISOString is correct
      // there too. All-day writes stay floating date strings (no conversion).
      const originalDate = format(instantFor(effectiveStart), 'yyyy-MM-dd')
      const dateToUse = editDate || originalDate
      const startTime = editTime || format(instantFor(effectiveStart), 'HH:mm')
      const endTime = editEndTime || format(instantFor(effectiveEnd), 'HH:mm')
      updates.start = event.isAllDay
        ? `${dateToUse}T${startTime}:00`
        : new Date(`${dateToUse}T${startTime}:00`).toISOString()

      const originalEndDate = format(instantFor(effectiveEnd), 'yyyy-MM-dd')
      const endDateToUse = editEndDate || originalEndDate
      updates.end = event.isAllDay
        ? `${endDateToUse}T${endTime}:00`
        : new Date(`${endDateToUse}T${endTime}:00`).toISOString()

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
      const masterEvent = useCalendarStore
        .getState()
        .events.find((candidate) => candidate.id === originalEventId)
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
        // Spread the master rather than listing fields: a literal silently
        // dropped `type`, so a recurring *task* occurrence came back as an
        // event (issue #96 — same fix as EventModal's exceptionEvent).
        const base = masterEvent ?? event
        const exceptionEvent: CalendarEvent = {
          ...base,
          id: clickedEventId,
          uid: masterEvent?.uid || masterEvent?.id || event.uid || event.id,
          title: pendingUpdates.title ?? event.title,
          description: pendingUpdates.description ?? event.description,
          location: pendingUpdates.location ?? event.location,
          start: pendingUpdates.start ?? effectiveStart,
          end: pendingUpdates.end ?? effectiveEnd,
          isAllDay: event.isAllDay,
          calendarId: event.calendarId,
          // A detached override carries no rule of its own, and none of the
          // master's EXDATEs.
          recurrence: undefined,
          rruleString: undefined,
          excludedDates: undefined,
          recurrenceId: occurrenceStartISO,
          recurrenceMasterId: originalEventId || eventIdToUse,
          // The master's DUE is the series anchor, not this occurrence's date.
          dueDate:
            base.type === 'task' ? (pendingUpdates.dueDate ?? occurrenceStartISO) : undefined,
          sequence: 0,
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

      // Same reason as the 'this' branch above: spread so the split series
      // keeps the master's type (task vs event) and task fields.
      const newSeriesEvent: CalendarEvent = {
        ...masterEvent,
        id: uuidv4(),
        // A new series is a new VTODO/VEVENT — reusing the master's UID would
        // collide with it on the server.
        uid: undefined,
        calendarId: masterEvent.calendarId,
        title: pendingUpdates.title ?? masterEvent.title,
        description: pendingUpdates.description ?? masterEvent.description,
        location: pendingUpdates.location ?? masterEvent.location,
        start: pendingUpdates.start ?? effectiveStart,
        end: pendingUpdates.end ?? effectiveEnd,
        isAllDay: masterEvent.isAllDay,
        recurrence: newSeriesRecurrence,
        rruleString: newSeriesRrule,
        // The truncation EXDATEs belong to the old master only.
        excludedDates: undefined,
        recurrenceId: undefined,
        recurrenceMasterId: undefined,
        dueDate:
          masterEvent.type === 'task' ? (pendingUpdates.dueDate ?? occurrenceStartISO) : undefined,
        reminders: masterEvent.reminders,
        transparency: masterEvent.transparency,
        sequence: 0,
        // #112 — a split series is a new VTODO/VEVENT, so it must not inherit
        // the master's CREATED. `addEvent` stamps the real time below.
        created: undefined,
        lastModified: undefined,
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
        // A task's DUE is its anchor the same way `start` is, and `start` was
        // just pinned to the master's date above — leaving the clicked
        // occurrence's date here would make the two disagree and render the
        // series on a day it doesn't start on.
        if (allUpdates.dueDate) {
          const masterDueDate =
            masterEvent.dueDate?.split('T')[0] ?? format(parseISO(masterEvent.start), 'yyyy-MM-dd')
          const dueTimePart = allUpdates.dueDate.split('T')[1]
          allUpdates.dueDate = dueTimePart ? `${masterDueDate}T${dueTimePart}` : masterDueDate
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
        const oldStartDate = editDate || format(instantFor(effectiveStart), 'yyyy-MM-dd')
        const oldEndDate = editEndDate || format(instantFor(effectiveEnd), 'yyyy-MM-dd')
        const dayDelta = daysBetween(oldStartDate, value)
        setEditEndDate(addDays(oldEndDate, dayDelta))
      }
      setEditDate(value)
    } else if (field === 'endDate') {
      setEditEndDate(value)
    } else if (field === 'time') {
      // Issue #60: preserve the existing event duration. Compute the
      // (endTime - startTime) delta in minutes and apply it to the new start.
      // Falls back to defaultDuration from settings when the existing duration
      // is non-positive (e.g. a corrupt / freshly-loaded event with no end yet).
      // Tasks use dueTime only; we guard on `!isTask` so we never auto-shift
      // task due-times (a task has a single time, not a range).
      if (value !== editTime && !isTask) {
        const [sH, sM] = (editTime || '00:00').split(':').map(Number)
        const [eH, eM] = (editEndTime || editTime || '00:00').split(':').map(Number)
        const oldDuration = eH * 60 + eM - (sH * 60 + sM)
        const minutes = oldDuration > 0 ? oldDuration : defaultDuration
        setEditEndTime(addMinutesToTimeStr(value, minutes))
      }
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

  const handleOpenSubtask = (taskId: string): void => {
    closePreview()
    openModal(undefined, undefined, taskId, 'task')
  }

  const isRecurring =
    !event.recurrenceId && (!!event.recurrence || !!event.rruleString || !!originalEventId)

  // Purely a compose shortcut — sending mail records no state on the event.
  // Anything else would imply a scheduling lifecycle Calino doesn't have.
  const mailto = useMemo(
    () =>
      buildMailtoUri(event, event.attendees ?? [], event.organizer, {
        use24Hour: timeFormat !== '12h',
        selfEmail: event.organizer?.email,
      }),
    [event, timeFormat]
  )

  const handleEmailAttendees = (): void => {
    if (mailto) window.location.href = mailto.uri
  }

  const handleDelete = async (): Promise<void> => {
    if (event.recurrenceId) {
      await performDelete('this')
      return
    }
    if (isRecurring) {
      setShowDeleteDialog(true)
      return
    }
    // Undo, same as the other delete entry points (EventCard, EventModal) —
    // this path used to delete outright with no way back.
    const idToDelete = originalEventId || event.id
    const eventToDelete =
      useCalendarStore.getState().events.find((e) => e.id === idToDelete) ?? event
    deleteEventWithUndo({
      event: eventToDelete,
      deleteEvent,
      addEvent,
      createCalDAVEvent,
      deleteCalDAVEvent,
    })
    closePreview()
  }

  const performDelete = async (mode: RecurrenceEditMode): Promise<void> => {
    const ok = await deleteRecurringOccurrence({
      mode,
      clickedEventId,
      originalEventId,
      events: useCalendarStore.getState().events,
      saveRecurrenceOverride,
      deleteEvent,
      addEvent,
      createCalDAVEvent,
      deleteCalDAVEvent,
    })
    if (!ok) return
    closePreview()
    setShowDeleteDialog(false)
  }

  // On mobile the popup is a full-width bottom sheet, so the click point is
  // irrelevant — CSS pins it and these coordinates are left unset.
  const adjustedPosition = (() => {
    if (isMobile) return null
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

    return { x: Math.max(padding, x), y: Math.max(padding, y) }
  })()

  // A right-click elsewhere on the calendar opens a context menu, so the
  // preview steps aside. Events raised from *inside* the popup are not that:
  // on Android a long-press (and the double-tap selection callout) fires
  // `contextmenu`, so selecting a word in the sheet was dismissing it.
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent): void => {
      if (popupRef.current?.contains(e.target as Node)) return
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
          <span
            onClick={(e) => {
              e.stopPropagation()
              startEditing('date')
            }}
          >
            {format(instantFor(event.originalStart || event.start), dateFormatPattern)}
          </span>
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
      const startDisplay = format(instantFor(event.originalStart || event.start), dateFormatPattern)
      const endDisplay = format(instantFor(event.originalEnd || event.end), dateFormatPattern)
      return (
        <>
          <span
            onClick={(e) => {
              e.stopPropagation()
              startEditing('date')
            }}
          >
            {startDisplay}
          </span>
          <span> - </span>
          <span
            onClick={(e) => {
              e.stopPropagation()
              startEditing('endDate')
            }}
          >
            {endDisplay}
          </span>
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
          onKeyDown={(e) => {
            // TimeInput blurs itself on Enter (committing the draft), which
            // doesn't reach the backdrop's save-on-outside-click path — save
            // explicitly here so Enter behaves the same as it does for every
            // other field in this popup.
            if (e.key === 'Enter') {
              saveChanges()
            }
          }}
        >
          <TimeField
            value={editTime}
            timeFormat={timeFormat}
            onChange={(value) => handleFieldChange('time', value)}
            className={styles.inlineInput}
            dataComponent="event-preview-start-time"
            ariaLabel="Start time"
            autoFocus
          />
          {!isTask && (
            <>
              <span>-</span>
              <TimeField
                value={editEndTime}
                timeFormat={timeFormat}
                onChange={(value) => handleFieldChange('endTime', value)}
                className={styles.inlineInput}
                dataComponent="event-preview-end-time"
                ariaLabel="End time"
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
              data-sheet={isMobile ? '' : undefined}
              onClick={() => {
                // A blur (e.g. from clicking away from a time <input>) may have
                // already cleared editingField by the time this click fires, so
                // check hasChanges too — otherwise an edited-but-unsaved field
                // gets silently discarded instead of saved (issue: time-only
                // edits not persisting).
                if (hasChanges) {
                  saveChanges()
                } else if (editingField) {
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
                data-sheet={isMobile ? '' : undefined}
                style={
                  adjustedPosition
                    ? { left: adjustedPosition.x, top: adjustedPosition.y }
                    : { y: sheetY }
                }
                initial={
                  prefersReducedMotion || isMobile ? false : { opacity: 0, scale: 0.95, y: -10 }
                }
                animate={isMobile ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
                exit={
                  prefersReducedMotion || isMobile
                    ? { opacity: 0 }
                    : { opacity: 0, scale: 0.95, y: -10 }
                }
                transition={{ duration: prefersReducedMotion ? 0 : 0.15 }}
              >
                <div
                  className={styles.header}
                  data-has-background={backgroundId ? '' : undefined}
                  style={{ ['--event-color' as string]: event.color || '#4285F4' }}
                >
                  {/* Inside the header, not above it, so the header's tint runs all the
              way to the sheet's top edge instead of leaving an untinted strip. */}
                  {isMobile && <div className={styles.dragHandle} aria-hidden="true" />}
                  {backgroundId && (
                    <EventBackground id={backgroundId} className={styles.keywordBackground} />
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

                <div className={styles.content} ref={scrollRef}>
                  {isTask && (
                    <label
                      className={styles.taskCompletion}
                      data-component="task-preview-completion"
                    >
                      <input
                        type="checkbox"
                        checked={taskCompleted}
                        disabled={isReadOnlyCalendar}
                        onChange={() => void handleTaskCompletion(currentTask)}
                        aria-label={
                          taskCompleted
                            ? `Mark "${currentTask.title}" as incomplete`
                            : `Mark "${currentTask.title}" as complete`
                        }
                      />
                      <span>{taskCompleted ? 'Completed' : 'Mark complete'}</span>
                    </label>
                  )}
                  {isTask && parentTask && (
                    <div className={styles.taskRelationship} data-component="task-preview-parent">
                      <span aria-hidden="true">↳</span>
                      <span>Subtask of {parentTask.title}</span>
                    </div>
                  )}
                  {isTask && directSubtasks.length > 0 && (
                    <div className={styles.previewSubtasks} data-component="task-preview-subtasks">
                      <div className={styles.previewSubtasksLabel}>Subtasks</div>
                      {directSubtasks.map((subtask) => (
                        <div className={styles.previewSubtaskRow} key={subtask.id}>
                          <input
                            type="checkbox"
                            data-component="task-preview-subtask-checkbox"
                            checked={Boolean(subtask.completed)}
                            disabled={
                              calendars.find((calendar) => calendar.id === subtask.calendarId)
                                ?.readOnly === true
                            }
                            onChange={() => void handleTaskCompletion(subtask)}
                            aria-label={
                              subtask.completed
                                ? `Mark "${subtask.title}" as incomplete`
                                : `Mark "${subtask.title}" as complete`
                            }
                          />
                          <button
                            type="button"
                            className={styles.previewSubtaskTitle}
                            onClick={() => handleOpenSubtask(subtask.id)}
                          >
                            {subtask.title}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className={styles.field}>
                    <svg
                      aria-hidden="true"
                      className={styles.icon}
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="none"
                    >
                      <rect
                        x="2"
                        y="3.5"
                        width="10"
                        height="9"
                        rx="1"
                        stroke="currentColor"
                        strokeWidth="1.2"
                      />
                      <path d="M2 6.5H12" stroke="currentColor" strokeWidth="1.2" />
                      <path
                        d="M5 1.5V3.5M9 1.5V3.5"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                      />
                    </svg>
                    {renderDate()}
                    {(event.recurrence || event.rruleString) && (
                      <span className={styles.recurringIcon} data-tooltip={recurrenceDescription}>
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
                    <svg
                      aria-hidden="true"
                      className={styles.icon}
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="none"
                    >
                      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
                      <path
                        d="M7 4V7L9 9"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                      />
                    </svg>
                    {renderTime()}
                    {/* Times above are shown in the device zone. An event
                        anchored elsewhere says so, matching the badge
                        EventCard already renders in the grid. */}
                    {event.timezone && event.timezone !== deviceTimezone() && (
                      <span className={styles.tzBadge}>{event.timezone}</span>
                    )}
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
                      <svg
                        aria-hidden="true"
                        className={styles.icon}
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                      >
                        {/* The pin is drawn 13 units tall from y=0, so its stroke
                            painted above the viewBox and the browser clipped the
                            dome flat. Scaled about the centre and nudged down to
                            sit inside; strokeWidth is pre-divided by the scale so
                            the line still renders at 1.2. */}
                        <g transform="matrix(0.86 0 0 0.86 0.98 1.33)">
                          <path
                            d="M7 6.5C8.10457 6.5 9 5.60457 9 4.5C9 3.39543 8.10457 2.5 7 2.5C5.89543 2.5 5 3.39543 5 4.5C5 5.60457 5.89543 6.5 7 6.5Z"
                            stroke="currentColor"
                            strokeWidth="1.4"
                          />
                          <path
                            d="M7 13C7 13 12 8.5 12 4.5C12 2.019 10.104 0 7 0C3.896 0 2 2.019 2 4.5C2 8.5 7 13 7 13Z"
                            stroke="currentColor"
                            strokeWidth="1.4"
                          />
                        </g>
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
                      <svg
                        aria-hidden="true"
                        className={styles.icon}
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                      >
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
                      <svg
                        aria-hidden="true"
                        className={styles.icon}
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                      >
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
                      <svg
                        aria-hidden="true"
                        className={styles.icon}
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                      >
                        <path
                          d="M7 2.5V8"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                        <path
                          d="M7 11H7.01"
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
                      <svg
                        aria-hidden="true"
                        className={styles.icon}
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                      >
                        <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
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
                    <button
                      className={styles.saveBtn}
                      onClick={saveChanges}
                      aria-label="Save changes"
                    >
                      <svg
                        aria-hidden="true"
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                      >
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
                  {mailto && (
                    <button
                      className={styles.exportBtn}
                      onClick={handleEmailAttendees}
                      aria-label={`Email ${mailto.recipients.length} attendee${mailto.recipients.length === 1 ? '' : 's'}`}
                      title="Email attendees"
                      data-component="email-attendees-btn"
                      data-mailto={mailto.uri}
                    >
                      <svg
                        aria-hidden="true"
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                      >
                        <rect
                          x="1.5"
                          y="3"
                          width="11"
                          height="8"
                          rx="1"
                          stroke="currentColor"
                          strokeWidth="1.2"
                        />
                        <path
                          d="M1.5 4L7 8L12.5 4"
                          stroke="currentColor"
                          strokeWidth="1.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  )}
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
        </>,
        document.body
      )}
      {createPortal(
        <DeleteDialog
          key="delete-dialog"
          isOpen={showDeleteDialog}
          isTask={isTask}
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
          isTask={isTask}
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
