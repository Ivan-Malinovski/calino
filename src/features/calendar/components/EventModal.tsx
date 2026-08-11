import type { JSX } from 'react'
import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { format, parseISO } from 'date-fns'
import { pad2 } from '@/lib/datetime'
import { v4 as uuidv4 } from 'uuid'
import { useCalendarStore } from '@/store/calendarStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { showToast } from '@/lib/toast'
import { safeCalDAVUpdate } from '@/lib/caldavHelpers'
import { buildRRuleString } from '@/lib/recurrence'
import { hasRecurrenceChanged } from '@/lib/recurrenceComparison'
import { findEventById } from '@/lib/events'
import { buildMasterTruncation } from '@/lib/recurrenceSplit'
import { deleteRecurringOccurrence, getOccurrenceStart } from '@/lib/recurrenceDelete'
import type {
  CalendarEvent,
  CalendarAttachment,
  RecurrenceRule,
  TaskPriority,
  Reminder,
  RecurrenceEditMode,
} from '@/types'
import { putAttachments, getAttachments, deleteAttachments } from '@/lib/attachmentStore'
import { TaskFormFields } from './TaskFormFields'
import { EventFormFields } from './EventFormFields'
import { RecurrenceDialog } from './RecurrenceDialog'
import { DeleteDialog } from './DeleteDialog'
import { getInitialFormState, addMinutesToTimeStr } from './eventModalState'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useSheetSwipeDismiss } from '@/hooks/useSheetSwipeDismiss'
import { parseNaturalLanguage } from '@/features/nlp'
import type { NLPParseResult } from '@/features/nlp'
import { useSmartDefaultsStore } from '@/store/smartDefaultsStore'
import { useSettingsStore } from '@/store/settingsStore'

import styles from './EventModal.module.css'

export function EventModal(): JSX.Element | null {
  const isModalOpen = useCalendarStore((state) => state.isModalOpen)
  const selectedEventId = useCalendarStore((state) => state.selectedEventId)
  const selectedDate = useCalendarStore((state) => state.selectedDate)
  const selectedEndDate = useCalendarStore((state) => state.selectedEndDate)
  const initialTitle = useCalendarStore((state) => state.initialTitle)
  const initialCalendarId = useCalendarStore((state) => state.initialCalendarId)
  const subtaskParentId = useCalendarStore((state) => state.subtaskParentId)
  const pendingEventPrefill = useCalendarStore((state) => state.pendingEventPrefill)
  const selectedEventType = useCalendarStore((state) => state.selectedEventType)
  const events = useCalendarStore((state) => state.events)
  const calendars = useCalendarStore((state) => state.calendars)
  const categories = useCalendarStore((state) => state.categories)
  const defaultDuration = useSettingsStore((state) => state.defaultDuration)
  const addEvent = useCalendarStore((state) => state.addEvent)
  const deleteEvent = useCalendarStore((state) => state.deleteEvent)
  const updateEvent = useCalendarStore((state) => state.updateEvent)
  const completeTask = useCalendarStore((state) => state.completeTask)
  const closeModal = useCalendarStore((state) => state.closeModal)
  const openModal = useCalendarStore((state) => state.openModal)
  const [isClosing, setIsClosing] = useState(false)
  // Re-entrancy guard for the async save path. The ref is the synchronous
  // trip-wire (state updates don't commit until the next render); the state
  // is just the visual disable on the Save button so the user gets feedback
  // that the click was received while the CalDAV sync is still in flight.
  const [isSaving, setIsSaving] = useState(false)
  const isSavingRef = useRef(false)
  const prefersReducedMotion = useReducedMotion()
  const animateClose = useCallback(() => {
    setIsClosing(true)
    setTimeout(
      () => {
        setIsClosing(false)
        closeModal()
      },
      prefersReducedMotion ? 0 : 200
    )
  }, [closeModal, prefersReducedMotion])

  // Swipe-down-to-dismiss plus the matching slide-up entrance, both on one
  // motion value bound to the card's `y`. See the hook for why this owns the
  // raw touch stream instead of using framer's `drag`.
  const isMobile = useIsMobile()
  const dialogRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sheetY = useSheetSwipeDismiss({
    enabled: isMobile,
    open: isModalOpen,
    sheetRef: dialogRef,
    scrollRef,
    onDismiss: closeModal,
    reducedMotion: prefersReducedMotion,
  })

  const {
    createEvent: createCalDAVEvent,
    updateEvent: updateCalDAVEvent,
    saveRecurrenceOverride,
    deleteEvent: deleteCalDAVEvent,
  } = useCalDAV()

  // R2.7 — findEventById, not an exact match: an expanded occurrence's id is
  // the synthetic `${masterId}-${occurrenceKey}`, which matches nothing in the
  // store. An exact lookup made every recurring *task* occurrence look like an
  // untyped event, so the calendar picker offered VEVENT-only calendars.
  const existingEvent = findEventById(events, selectedEventId)
  const requiredCalendarComponent =
    selectedEventType === 'task' || existingEvent?.type === 'task' ? 'VTODO' : 'VEVENT'
  const compatibleCalendars = useMemo(
    () =>
      calendars.filter(
        (calendar) =>
          (!calendar.supportedComponents ||
            calendar.supportedComponents.includes(requiredCalendarComponent)) &&
          !calendar.readOnly
      ),
    [calendars, requiredCalendarComponent]
  )

  const initialState = useMemo(
    () =>
      getInitialFormState(
        isModalOpen,
        selectedEventId,
        selectedDate,
        selectedEndDate,
        events,
        compatibleCalendars,
        categories,
        defaultDuration
      ),
    [
      isModalOpen,
      selectedEventId,
      selectedDate,
      selectedEndDate,
      events,
      compatibleCalendars,
      categories,
      defaultDuration,
    ]
  )

  const [title, setTitle] = useState(initialState.title)
  const [description, setDescription] = useState(initialState.description)
  const [location, setLocation] = useState(initialState.location)
  const [startDate, setStartDate] = useState(initialState.startDate)
  const [startTime, setStartTime] = useState(initialState.startTime)
  const [endDate, setEndDate] = useState(initialState.endDate)
  const [endTime, setEndTime] = useState(initialState.endTime)
  const [isAllDay, setIsAllDay] = useState(initialState.isAllDay)
  const [calendarId, setCalendarId] = useState(initialState.calendarId)
  const [recurring, setRecurring] = useState<boolean>(initialState.recurring)
  const [recurrence, setRecurrence] = useState<RecurrenceRule['frequency']>(initialState.recurrence)
  const [interval, setInterval] = useState<number>(initialState.interval)
  const [byWeekday, setByWeekday] = useState<number[]>(initialState.byWeekday)
  const [byMonthDay, setByMonthDay] = useState<number[]>(initialState.byMonthDay)
  const [byMonth, setByMonth] = useState<number[]>(initialState.byMonth)
  const [byDayOrdinals, setByDayOrdinals] = useState<number[]>(initialState.byDayOrdinals)
  const [endCondition, setEndCondition] = useState<'never' | 'on' | 'after'>(
    initialState.endCondition
  )
  const [endOnDate, setEndOnDate] = useState<string>(initialState.endOnDate)
  const [endAfterCount, setEndAfterCount] = useState<number>(initialState.endAfterCount)
  const [travelDuration, setTravelDuration] = useState<number | undefined>(
    initialState.travelDuration
  )
  const [transparency, setTransparency] = useState<'opaque' | 'transparent'>(
    initialState.transparency
  )
  const [reminders, setReminders] = useState<Reminder[]>(initialState.reminders)
  const [showRecurrenceDialog, setShowRecurrenceDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showDescription, setShowDescription] = useState(!!initialState.description)
  const [attachments, setAttachments] = useState<CalendarAttachment[]>([])
  const [relatedTo, setRelatedTo] = useState<string[]>([])
  const [parentTaskId, setParentTaskId] = useState<string | undefined>(undefined)

  // Smart defaults: track whether the user has manually overridden the
  // calendar or the event length, so learned suggestions only fill fields the
  // user hasn't touched yet.
  const calendarTouchedRef = useRef(false)
  const durationTouchedRef = useRef(false)
  // R2.7 — The due date the form was *seeded* with. For a recurring task the
  // modal is seeded with the clicked occurrence's date, not the series anchor,
  // so an "apply to all" edit that never touched the due field must not write
  // that occurrence date back over the master's DUE (which would drag the whole
  // series forward to whichever occurrence happened to be edited).
  const seededDueDateRef = useRef('')

  const handleEndTimeChange = useCallback((val: string): void => {
    durationTouchedRef.current = true
    setEndTime(val)
  }, [])

  const handleCalendarChange = useCallback((val: string): void => {
    calendarTouchedRef.current = true
    setCalendarId(val)
  }, [])

  // Load attachments from IndexedDB when modal opens with existing event.
  //
  // `fallback` is read into a local before the await so the async paths don't
  // close over a stale `initialState`, and `cancelled` stops a slow IndexedDB
  // read for event A from landing after the user has already switched to
  // event B — which used to paint A's attachments onto B.
  useEffect(() => {
    const fallback = initialState.attachments
    if (!isModalOpen || !fallback || fallback.length === 0) {
      setAttachments([])
      return
    }
    if (!selectedEventId) {
      setAttachments(fallback)
      return
    }

    let cancelled = false
    getAttachments(selectedEventId)
      .then((loaded) => {
        if (cancelled) return
        // No IndexedDB data yet (migrated from localStorage), use zustand metadata
        setAttachments(loaded.length > 0 ? loaded : fallback)
      })
      .catch(() => {
        if (cancelled) return
        setAttachments(fallback)
      })

    return () => {
      cancelled = true
    }
  }, [isModalOpen, selectedEventId, initialState.attachments])

  // Declared before the Escape handler below so the compiler sees the ref
  // created and synced ahead of the effect that reads it.
  const closeModalRef = useRef(closeModal)
  useEffect(() => {
    closeModalRef.current = closeModal
  })

  // Close on Escape
  useEffect(() => {
    if (!isModalOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeModalRef.current()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isModalOpen])
  const [dueDate, setDueDate] = useState<string>('')
  const [dueTime, setDueTime] = useState<string>('09:00')
  const [dueAllDay, setDueAllDay] = useState(true)
  const [completed, setCompleted] = useState(false)
  const [priority, setPriority] = useState<TaskPriority | undefined>(undefined)
  const [selectedCategories, setSelectedCategories] = useState<string[]>(initialState.categories)

  const lastSelectedEventId = useRef<string | null>(null)
  const lastSelectedDate = useRef<string | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)

  useFocusTrap(dialogRef, isModalOpen && !isClosing)

  // Title autocomplete
  const [titleSuggestions, setTitleSuggestions] = useState<CalendarEvent[]>([])
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  // Inline natural-language parse of the title, e.g. "lunch tomorrow 1pm".
  const [nlpSuggestion, setNlpSuggestion] = useState<NLPParseResult | null>(null)

  const handleTitleChange = (val: string): void => {
    setTitle(val)
    setHighlightedIndex(-1)

    // Inline NLP: only when creating a new event, and only surface a chip when
    // the parser actually extracted date/time words (i.e. stripped the title).
    if (!isEditing && val.trim().length >= 3) {
      try {
        const parsed = parseNaturalLanguage(val, {
          defaultDate: startDate ? parseISO(`${startDate}T00:00:00`) : new Date(),
        })
        const strippedSomething =
          parsed.title.trim().length > 0 && parsed.title.trim() !== val.trim()
        setNlpSuggestion(strippedSomething && parsed.confidence >= 0.5 ? parsed : null)
      } catch {
        setNlpSuggestion(null)
      }
    } else {
      setNlpSuggestion(null)
    }

    // Smart defaults: for a new event, quietly pre-fill the calendar and
    // event length the user usually picks for this kind of title — but only
    // for fields they haven't manually overridden this session.
    if (!isEditing && val.trim().length >= 3) {
      const suggestion = useSmartDefaultsStore.getState().suggest(val)
      if (
        suggestion.calendarId &&
        !calendarTouchedRef.current &&
        calendars.some((c) => c.id === suggestion.calendarId)
      ) {
        setCalendarId(suggestion.calendarId)
      }
      if (suggestion.durationMinutes && !durationTouchedRef.current && !isAllDay) {
        const [h, m] = startTime.split(':').map(Number)
        if (Number.isFinite(h) && Number.isFinite(m)) {
          const endMins = h * 60 + m + suggestion.durationMinutes
          const endH = Math.floor(endMins / 60) % 24
          const endM = endMins % 60
          setEndTime(`${pad2(endH)}:${pad2(endM)}`)
        }
      }
    }

    if (val.length < 2) {
      setTitleSuggestions([])
      return
    }
    const q = val.toLowerCase()
    const matches = events
      .filter((e) => e.title.toLowerCase().includes(q))
      .sort((a, b) => {
        // Prefer titles that start with the query
        const aStart = a.title.toLowerCase().startsWith(q) ? 0 : 1
        const bStart = b.title.toLowerCase().startsWith(q) ? 0 : 1
        return aStart - bStart || new Date(b.start).getTime() - new Date(a.start).getTime()
      })
      .slice(0, 5)
    setTitleSuggestions(matches)
  }

  const applySuggestion = (ev: CalendarEvent): void => {
    setTitle(ev.title)
    setDescription(ev.description || '')
    setLocation(ev.location || '')
    setSelectedCategories(ev.categories || [])
    setRelatedTo(ev.relatedTo || [])
    // Fill time only if still on the untouched default (09:00 + default duration)
    if (startTime === '09:00' && endTime === addMinutesToTimeStr('09:00', defaultDuration)) {
      const evStart = parseISO(ev.start)
      setStartTime(format(evStart, 'HH:mm'))
      const evEnd = parseISO(ev.end)
      setEndTime(format(evEnd, 'HH:mm'))
    }
    setTitleSuggestions([])
    setHighlightedIndex(-1)
    setNlpSuggestion(null)
    titleInputRef.current?.focus()
  }

  const applyNlpSuggestion = (parsed: NLPParseResult): void => {
    setTitle(parsed.title)
    setStartDate(format(parsed.startDate, 'yyyy-MM-dd'))
    setIsAllDay(parsed.isAllDay)
    if (!parsed.isAllDay) {
      setStartTime(format(parsed.startDate, 'HH:mm'))
      const end = parsed.endDate
        ? parsed.startDate < parsed.endDate
          ? parsed.endDate
          : new Date(parsed.startDate.getTime() + (parsed.duration ?? 60) * 60000)
        : new Date(parsed.startDate.getTime() + (parsed.duration ?? 60) * 60000)
      setEndDate(format(end, 'yyyy-MM-dd'))
      setEndTime(format(end, 'HH:mm'))
    } else {
      setEndDate(format(parsed.endDate ?? parsed.startDate, 'yyyy-MM-dd'))
    }
    if (parsed.location) setLocation(parsed.location)
    if (parsed.recurrence) {
      setRecurring(true)
      setRecurrence(parsed.recurrence.frequency)
      if (parsed.recurrence.interval) setInterval(parsed.recurrence.interval)
    }
    setNlpSuggestion(null)
    setTitleSuggestions([])
    titleInputRef.current?.focus()
  }

  const handleTitleKeyDown = (e: React.KeyboardEvent): void => {
    // Accept an inline NLP parse with Tab (when no history suggestion is active).
    if (
      nlpSuggestion &&
      !showSuggestions &&
      (e.key === 'Tab' || (e.key === 'Enter' && e.shiftKey))
    ) {
      e.preventDefault()
      applyNlpSuggestion(nlpSuggestion)
      return
    }
    if (!showSuggestions) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      setHighlightedIndex((i) => Math.min(i + 1, titleSuggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      setHighlightedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault()
      applySuggestion(titleSuggestions[highlightedIndex])
    } else if (e.key === 'Escape') {
      setTitleSuggestions([])
    } else if (e.key === 'Tab') {
      setTitleSuggestions([])
    }
  }

  useEffect(() => {
    if (
      selectedEventId !== lastSelectedEventId.current ||
      selectedDate !== lastSelectedDate.current
    ) {
      lastSelectedEventId.current = selectedEventId
      lastSelectedDate.current = selectedDate

      // Read fresh state via getState() so the form only resets when
      // selectedEventId or selectedDate actually change - not when
      // events/calendars change in the background (e.g. during CalDAV sync).
      const state = useCalendarStore.getState()
      const currentEvents = state.events
      const currentSelectedEventType = state.selectedEventType
      const currentEvent = findEventById(currentEvents, selectedEventId)
      const requiredComponent =
        currentSelectedEventType === 'task' || currentEvent?.type === 'task' ? 'VTODO' : 'VEVENT'
      const currentCalendars = state.calendars.filter(
        (calendar) =>
          !calendar.supportedComponents || calendar.supportedComponents.includes(requiredComponent)
      )
      const currentCategories = state.categories

      const formDefaults = getInitialFormState(
        isModalOpen,
        selectedEventId,
        selectedDate,
        selectedEndDate,
        currentEvents,
        currentCalendars,
        currentCategories,
        useSettingsStore.getState().defaultDuration
      )

      calendarTouchedRef.current = false
      durationTouchedRef.current = false

      const requestedParent = subtaskParentId
        ? currentEvents.find((event) => event.id === subtaskParentId && event.type === 'task')
        : undefined
      // Seed from formDefaults; if the caller passed an initialTitle (e.g. the
      // TodoView composer), override with that. This means the user's typed
      // text isn't lost when they press Enter in the inline composer.
      // pendingEventPrefill (from the AI photo-import flow) takes the next
      // precedence slot below initialTitle — start/end are already seeded via
      // selectedDate/selectedEndDate (the drawer passes extracted.start/end
      // straight into openModal()'s existing date/endDate params).
      const prefillTitle = pendingEventPrefill?.title
      const prefillDescription = pendingEventPrefill?.description
      const prefillLocation = pendingEventPrefill?.location
      setTitle(initialTitle ?? prefillTitle ?? formDefaults.title)
      setDescription(prefillDescription ?? formDefaults.description)
      setLocation(prefillLocation ?? formDefaults.location)
      setStartDate(formDefaults.startDate)
      setStartTime(formDefaults.startTime)
      setEndDate(formDefaults.endDate)
      setEndTime(formDefaults.endTime)
      setIsAllDay(
        pendingEventPrefill?.allDay !== undefined
          ? pendingEventPrefill.allDay
          : formDefaults.isAllDay
      )
      setCalendarId(requestedParent?.calendarId ?? initialCalendarId ?? formDefaults.calendarId)
      setRecurring(formDefaults.recurring)
      setRecurrence(formDefaults.recurrence)
      setInterval(formDefaults.interval)
      setByWeekday(formDefaults.byWeekday)
      setByMonthDay(formDefaults.byMonthDay)
      setByMonth(formDefaults.byMonth)
      setByDayOrdinals(formDefaults.byDayOrdinals)
      setEndCondition(formDefaults.endCondition)
      setEndOnDate(formDefaults.endOnDate)
      setEndAfterCount(formDefaults.endAfterCount)
      setTravelDuration(formDefaults.travelDuration)
      setTransparency(formDefaults.transparency)
      setReminders(formDefaults.reminders)
      setShowDescription(!!(prefillDescription ?? formDefaults.description))
      setSelectedCategories(formDefaults.categories)
      setRelatedTo(formDefaults.relatedTo)
      setParentTaskId(currentEvent?.parentTaskId ?? requestedParent?.id)

      if (pendingEventPrefill) {
        useCalendarStore.getState().setPendingEventPrefill(null)
      }

      // R2.7 — `findEventById`, not an exact match: an expanded occurrence's id
      // is the synthetic `${masterId}-${occurrenceKey}` and matches nothing in
      // the store, so an exact lookup found no task at all and fell through to
      // the "new task" branch below — which dated the form TODAY. That hit
      // every recurring task opened from a calendar view.
      const existingEvent = currentEvent
      if (existingEvent?.type === 'task') {
        // For an expanded occurrence the id carries the date it stands for.
        // The master's own dueDate is the series anchor, which is a different
        // date and not the one the user clicked.
        const masterId = formDefaults.originalEventId
        const occurrenceKey =
          masterId && selectedEventId?.startsWith(`${masterId}-`)
            ? selectedEventId.slice(masterId.length + 1)
            : undefined
        const taskDueDate =
          occurrenceKey?.split('T')[0] ||
          existingEvent.dueDate?.split('T')[0] ||
          format(parseISO(existingEvent.start), 'yyyy-MM-dd')
        setDueDate(taskDueDate)
        seededDueDateRef.current = taskDueDate
        const taskTime = format(parseISO(existingEvent.start), 'HH:mm')
        setDueTime(taskTime !== '00:00' ? taskTime : '09:00')
        setDueAllDay(existingEvent.isAllDay ?? true)
        setCompleted(existingEvent.completed || false)
        setPriority(existingEvent.priority)
      } else if (currentSelectedEventType === 'task') {
        const newTaskDueDate =
          requestedParent?.dueDate?.split('T')[0] ||
          selectedDate ||
          format(new Date(), 'yyyy-MM-dd')
        setDueDate(newTaskDueDate)
        seededDueDateRef.current = newTaskDueDate
        setDueTime('09:00')
        setDueAllDay(true)
        setCompleted(false)
        setPriority(undefined)
      } else {
        setDueDate('')
        seededDueDateRef.current = ''
        setDueTime('09:00')
        setDueAllDay(true)
        setCompleted(false)
        setPriority(undefined)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only reset on user-initiated event/date/endDate changes
  }, [selectedEventId, selectedDate, selectedEndDate, subtaskParentId, initialCalendarId])

  // Auto-focus title input when creating a new event. On mobile this waits
  // for the entrance to finish: focusing mid-flight opens the soft keyboard,
  // which resizes the `100dvh` sheet while it's still travelling and shows up
  // as a stutter halfway through the slide.
  useEffect(() => {
    if (isModalOpen && !selectedEventId) {
      const delay = isMobile && !prefersReducedMotion ? 340 : 50
      const timer = setTimeout(() => titleInputRef.current?.focus(), delay)
      return () => clearTimeout(timer)
    }
  }, [isModalOpen, selectedEventId, isMobile, prefersReducedMotion])

  const isEditing = selectedEventId !== null
  // A webcal subscription's calendar — mutation is blocked, matching
  // isCalendarReadOnly() in calendarStore.ts (store actions themselves stay
  // unguarded since sync writes to these calendars legitimately).
  const isCurrentCalendarReadOnly = calendars.find((c) => c.id === calendarId)?.readOnly === true
  const isRecurringEvent = initialState.recurring
  const showSuggestions = !isEditing && titleSuggestions.length > 0
  const originalEventId = initialState.originalEventId
  // R2.7 — Must resolve occurrence ids back to their master. An exact match
  // left `eventType` undefined for every expanded occurrence of a recurring
  // task, so `isTaskMode` was false and saving wrote `type: 'event'` — editing
  // any occurrence silently converted the whole series into events, and the
  // due-date/all-day fields were dropped on the way out.
  const existingEventForMode = findEventById(events, selectedEventId)
  const eventType = existingEventForMode?.type
  const isTaskMode = selectedEventType === 'task' || eventType === 'task'
  const parentTaskOptions = useMemo(() => {
    if (!isTaskMode) return []
    const excludedIds = new Set<string>([selectedEventId ?? ''])
    let changed = true
    while (changed) {
      changed = false
      for (const task of events) {
        if (task.parentTaskId && excludedIds.has(task.parentTaskId) && !excludedIds.has(task.id)) {
          excludedIds.add(task.id)
          changed = true
        }
      }
    }
    return events.filter(
      (task) => task.type === 'task' && task.calendarId === calendarId && !excludedIds.has(task.id)
    )
  }, [calendarId, events, isTaskMode, selectedEventId])
  const subtasks = useMemo(
    () => events.filter((task) => task.type === 'task' && task.parentTaskId === selectedEventId),
    [events, selectedEventId]
  )

  // R2.7 — When a task may not recur, and why.
  //
  // A due date is required because it is what Calino writes as DTSTART, and
  // RFC 5545 §3.6.2 has nothing to anchor a recurrence set to without one.
  // The RELATED-TO cases are a product decision rather than a spec limit: the
  // parent/child link has no per-occurrence form, so a recurring parent would
  // have to either share one set of subtasks across every occurrence or
  // silently fan them out — neither is representable in a way other clients
  // would read back correctly.
  const taskRecurrenceDisabledReason = !isTaskMode
    ? undefined
    : !dueDate
      ? 'needs a due date'
      : parentTaskId
        ? 'subtasks cannot repeat'
        : subtasks.length > 0
          ? 'tasks with subtasks cannot repeat'
          : undefined
  const recurrenceAllowed = !isTaskMode || !taskRecurrenceDisabledReason

  const hasChanges = useMemo(() => {
    if (!existingEventForMode) return true

    const existingAttachments = existingEventForMode.attachments || []
    const attachmentsChanged = JSON.stringify(attachments) !== JSON.stringify(existingAttachments)

    // R2.7 — Recurrence participates in BOTH branches now that tasks can
    // recur. Leaving it out of the task branch made a recurrence-only edit
    // look like "no changes", and saveEvent closes the modal without writing
    // when nothing changed — so the old rule survived even a hard refresh.
    const recurrenceChanged = hasRecurrenceChanged(
      {
        recurring,
        frequency: recurrence,
        interval,
        byWeekday,
        byMonthDay,
        byMonth,
        byDayOrdinals,
        endCondition,
        endOnDate,
        endAfterCount,
      },
      existingEventForMode
    )

    if (isTaskMode) {
      const taskTime = dueAllDay ? '00:00:00' : `${dueTime}:00`
      const taskDueDate = dueDate ? (dueAllDay ? dueDate : `${dueDate}T${taskTime}`) : undefined
      const currentStart = dueDate ? `${dueDate}T${taskTime}` : existingEventForMode.start
      return (
        title !== existingEventForMode.title ||
        description !== (existingEventForMode.description || '') ||
        location !== (existingEventForMode.location || '') ||
        currentStart !== existingEventForMode.start ||
        taskDueDate !== existingEventForMode.dueDate ||
        (dueDate ? dueAllDay : (existingEventForMode.isAllDay ?? true)) !==
          (existingEventForMode.isAllDay ?? true) ||
        completed !== (existingEventForMode.completed || false) ||
        priority !== existingEventForMode.priority ||
        recurrenceChanged ||
        parentTaskId !== existingEventForMode.parentTaskId ||
        calendarId !== existingEventForMode.calendarId ||
        JSON.stringify(selectedCategories) !==
          JSON.stringify(existingEventForMode.categories || []) ||
        JSON.stringify(relatedTo) !== JSON.stringify(existingEventForMode.relatedTo || []) ||
        attachmentsChanged
      )
    }

    const localStart = isAllDay ? `${startDate}T00:00:00` : `${startDate}T${startTime}:00`
    const localEnd = isAllDay ? `${endDate}T23:59:59` : `${endDate}T${endTime}:00`
    const existingStart = format(parseISO(existingEventForMode.start), "yyyy-MM-dd'T'HH:mm:ss")
    const existingEnd = format(parseISO(existingEventForMode.end), "yyyy-MM-dd'T'HH:mm:ss")

    return (
      title !== existingEventForMode.title ||
      description !== (existingEventForMode.description || '') ||
      location !== (existingEventForMode.location || '') ||
      localStart !== existingStart ||
      localEnd !== existingEnd ||
      isAllDay !== existingEventForMode.isAllDay ||
      recurrenceChanged ||
      travelDuration !== existingEventForMode.travelDuration ||
      calendarId !== existingEventForMode.calendarId ||
      JSON.stringify(selectedCategories) !==
        JSON.stringify(existingEventForMode.categories || []) ||
      JSON.stringify(relatedTo) !== JSON.stringify(existingEventForMode.relatedTo || []) ||
      attachmentsChanged
    )
  }, [
    existingEventForMode,
    isTaskMode,
    title,
    description,
    location,
    startDate,
    startTime,
    endDate,
    endTime,
    isAllDay,
    dueDate,
    dueTime,
    dueAllDay,
    completed,
    priority,
    parentTaskId,
    recurring,
    recurrence,
    interval,
    byWeekday,
    byMonthDay,
    byMonth,
    byDayOrdinals,
    endCondition,
    endOnDate,
    endAfterCount,
    travelDuration,
    calendarId,
    selectedCategories,
    relatedTo,
    attachments,
  ])

  const candidateEvents = useMemo(() => {
    return events.filter((e) => {
      if (e.id === selectedEventId) return false
      if (e.type === 'journal') return false
      if (!e.start.startsWith(startDate)) return false
      return true
    })
  }, [events, selectedEventId, startDate])

  // R3.4 — single source of truth for end-before-start. Used by:
  //   - the form's Save button (disabled prop)
  //   - the submit handler (toast + early return)
  //   - saveEvent (called from the recurrence-dialog confirm path)
  //   Each of those three sites used to inline-compute this; consolidating
  // here keeps them in lockstep. Declared ahead of all three consumers so the
  // compiler can keep the memoization.
  const isTimeRangeInvalid = useMemo(() => {
    // Tasks don't have a real start/end range — start and end are saved as
    // the same timestamp (mirroring the due date/time), which would always
    // trip the endMs <= startMs check below and permanently disable Save.
    if (isTaskMode) return false
    if (!isAllDay) {
      const startMs = new Date(`${startDate}T${startTime}:00`).getTime()
      const endMs = new Date(`${endDate}T${endTime}:00`).getTime()
      return endMs <= startMs
    }
    return endDate < startDate
  }, [isTaskMode, isAllDay, startDate, startTime, endDate, endTime])

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()

    // Synchronous re-entrancy guard. While a save is in flight (the ref is
    // flipped true by `saveEvent` itself), drop further submit attempts so
    // duplicate events can't be queued while the CalDAV await is pending.
    if (isSavingRef.current) return

    if (!title.trim()) {
      showToast('Title is required')
      return
    }

    if (isTimeRangeInvalid) {
      // R3.4 — end-before-start. Toast text mirrors what saveEvent shows
      // when the same condition is hit via the recurrence-dialog path.
      showToast(
        isAllDay ? 'End date must be on or after start date' : 'End time must be after start time'
      )
      return
    }

    // Stored exceptions are already detached, so save them back as the same occurrence.
    if (
      isEditing &&
      initialState.isRecurringInstance &&
      existingEventForMode?.recurrenceId &&
      hasChanges
    ) {
      saveEvent('this')
      return
    }

    if (isEditing && isRecurringEvent && hasChanges) {
      setShowRecurrenceDialog(true)
      return
    }

    saveEvent('all')
  }

  const saveEvent = async (mode: RecurrenceEditMode): Promise<void> => {
    // Defensive guard: also called from `handleRecurrenceDialogConfirm`, which
    // a user can rapid-click just like the form's Save button.
    if (isSavingRef.current) return
    isSavingRef.current = true
    setIsSaving(true)
    try {
      if (isEditing && !hasChanges) {
        closeModal()
        return
      }

      if (!title.trim()) {
        showToast('Title is required')
        return
      }

      // R3.4 follow-up: also check the time range here. The handleSubmit guard
      // catches the form-submit path, but saveEvent is also called directly
      // from handleRecurrenceDialogConfirm (when editing a recurring event
      // opens the "edit one / edit following / edit all" dialog) — that path
      // bypasses handleSubmit's check, so a recurring event edit with
      // end<start would slip through. Reuses the isTaskMode-aware
      // isTimeRangeInvalid memo instead of recomputing (was drifting out of
      // sync with it — the previous inline copy didn't skip tasks).
      if (isTimeRangeInvalid) {
        showToast(
          isAllDay ? 'End date must be on or after start date' : 'End time must be after start time'
        )
        return
      }

      const localStart = isAllDay ? `${startDate}T00:00:00` : `${startDate}T${startTime}:00`
      const localEnd = isAllDay ? `${endDate}T23:59:59` : `${endDate}T${endTime}:00`
      const startDateTime = isAllDay ? `${startDate}T00:00:00` : new Date(localStart).toISOString()
      const endDateTime = isAllDay ? `${endDate}T00:00:00` : new Date(localEnd).toISOString()

      const recurrenceRule: RecurrenceRule | undefined = recurring
        ? {
            frequency: recurrence,
            interval: interval > 1 ? interval : 1,
            byWeekday: byWeekday.length > 0 ? byWeekday : undefined,
            byMonthDay: byMonthDay.length > 0 ? byMonthDay : undefined,
            byMonth: byMonth.length > 0 ? byMonth : undefined,
            byDayOrdinals: byDayOrdinals.length > 0 ? byDayOrdinals : undefined,
            endDate: endCondition === 'on' && endOnDate ? `${endOnDate}T23:59:59` : undefined,
            count: endCondition === 'after' ? endAfterCount : undefined,
          }
        : undefined

      // R2.7 — Tasks now carry recurrence like events do. What stays forced off
      // for a task is the rest of the "More" panel (reminders, travel time,
      // transparency), which has no VTODO meaning in the current scope.
      const effectiveRecurrence = recurrenceAllowed ? recurrenceRule : undefined

      const taskTime = dueAllDay ? '00:00:00' : `${dueTime}:00`
      const taskEndTime = dueAllDay ? '23:59:59' : `${dueTime}:00`

      if (isEditing && selectedEventId) {
        // For recurring-instance edits ("this occurrence" / "this and following"),
        // the clicked occurrence's date is encoded in the instance id as
        // `masterId-<ISO>` and differs from the form's start date (which reflects
        // the master's first occurrence). Anchor those edits to the clicked
        // occurrence's date, preserving the event's time-of-day and duration
        // (including any edits the user made in the form). Falls back to the form
        // date for non-instance ids (plain master edits).
        const selectedStoredEvent = events.find((event) => event.id === selectedEventId)
        // R2.7 — Same resolution the delete path uses: a detached override's
        // RECURRENCE-ID when there is one, otherwise the id's occurrence
        // suffix. That suffix is a bare `YYYY-MM-DD` for all-day items — which
        // every all-day recurring task is — and the old ISO-timestamp-only
        // regex here rejected it outright ("Invalid event data").
        const occurrenceKey = originalEventId
          ? getOccurrenceStart(selectedStoredEvent, selectedEventId, originalEventId)
          : undefined
        const occDateStr = occurrenceKey?.split('T')[0] || startDate
        const durationMs = new Date(endDateTime).getTime() - new Date(startDateTime).getTime()
        const occStartDateTime = isTaskMode
          ? `${occDateStr}T${taskTime}`
          : isAllDay
            ? `${occDateStr}T00:00:00`
            : new Date(`${occDateStr}T${startTime}:00`).toISOString()
        let occEndDateTime: string
        if (isTaskMode) {
          occEndDateTime = `${occDateStr}T${taskEndTime}`
        } else if (isAllDay) {
          const spanDays = Math.round(
            (new Date(`${endDate}T00:00:00Z`).getTime() -
              new Date(`${startDate}T00:00:00Z`).getTime()) /
              86400000
          )
          const endD = new Date(`${occDateStr}T00:00:00Z`)
          endD.setUTCDate(endD.getUTCDate() + spanDays)
          occEndDateTime = `${endD.toISOString().split('T')[0]}T00:00:00`
        } else {
          occEndDateTime = new Date(new Date(occStartDateTime).getTime() + durationMs).toISOString()
        }

        if (mode === 'this' && originalEventId) {
          const masterEvent = events.find((e) => e.id === originalEventId)
          if (!masterEvent) {
            showToast('Master event not found. Cannot edit single occurrence.')
            return
          }

          const originalOccurrenceDate = occurrenceKey
          if (!originalOccurrenceDate) {
            showToast('Invalid event data. Cannot edit single occurrence.')
            return
          }

          const exceptionEvent: CalendarEvent = {
            ...(selectedStoredEvent?.recurrenceId ? selectedStoredEvent : masterEvent),
            id: `${originalEventId}-${originalOccurrenceDate}`,
            uid: masterEvent.uid || masterEvent.id,
            calendarId: masterEvent.calendarId,
            title,
            description: description || undefined,
            location: location || undefined,
            start: occStartDateTime,
            end: occEndDateTime,
            isAllDay: isTaskMode ? dueAllDay : isAllDay,
            recurrence: undefined,
            rruleString: undefined,
            recurrenceId: originalOccurrenceDate,
            recurrenceMasterId: originalEventId,
            categories: selectedCategories,
            // A VTODO override keeps its task identity and its own DUE; the
            // event-only fields below have no VTODO meaning (see R2.7).
            type: isTaskMode ? 'task' : 'event',
            dueDate: isTaskMode
              ? dueAllDay
                ? occDateStr
                : `${occDateStr}T${taskTime}`
              : undefined,
            completed: isTaskMode ? completed : undefined,
            priority: isTaskMode ? priority : undefined,
            parentTaskId: isTaskMode ? parentTaskId : undefined,
            travelDuration: isTaskMode ? undefined : travelDuration,
            reminders: isTaskMode ? undefined : reminders,
            transparency: isTaskMode ? undefined : transparency,
            sequence: 0,
            relatedTo: relatedTo.length > 0 ? relatedTo : undefined,
            attachments: attachments.length > 0 ? attachments : undefined,
          }

          const occurrenceDate = originalOccurrenceDate.split('T')[0]
          const masterWithoutLegacyExdate = {
            ...masterEvent,
            excludedDates: masterEvent.excludedDates?.filter(
              (date) => date.split('T')[0] !== occurrenceDate
            ),
          }
          try {
            await saveRecurrenceOverride(
              masterEvent.calendarId,
              masterWithoutLegacyExdate,
              exceptionEvent
            )
          } catch {
            showToast('Failed to update this occurrence. The original event was kept.')
            return
          }
          if (attachments.length > 0) {
            putAttachments(exceptionEvent.id, attachments).catch(() => {})
          }
        } else if (mode === 'future' && originalEventId) {
          // "This and following events": split the series at the current
          // occurrence.  The master event keeps all past occurrences (ending
          // the day before), and a new master event is created for this
          // occurrence onward with the updated properties.
          const masterEvent = events.find((e) => e.id === originalEventId)
          if (!masterEvent) {
            showToast('Master event not found. Cannot split series.')
            return
          }

          const originalOccurrenceDate = occurrenceKey
          if (!originalOccurrenceDate) {
            showToast('Invalid event data. Cannot split series.')
            return
          }

          // Update master so it ends immediately before the split occurrence.
          const {
            excludedDates: updatedExcludedDates,
            recurrence: masterRecurrence,
            rruleString: masterRruleString,
          } = buildMasterTruncation(masterEvent, originalOccurrenceDate)

          updateEvent(originalEventId, {
            excludedDates: updatedExcludedDates,
            recurrence: masterRecurrence,
            rruleString: masterRruleString,
          })
          await safeCalDAVUpdate(
            updateCalDAVEvent,
            masterEvent.calendarId,
            {
              ...masterEvent,
              excludedDates: updatedExcludedDates,
              recurrence: masterRecurrence,
              rruleString: masterRruleString,
            },
            {
              excludedDates: updatedExcludedDates,
              recurrence: masterRecurrence,
              rruleString: masterRruleString,
            }
          ).catch(() => {})

          // Create the new series starting from the current occurrence
          const newSeriesEvent: CalendarEvent = {
            id: uuidv4(),
            calendarId: masterEvent.calendarId,
            title,
            description: description || undefined,
            location: location || undefined,
            start: occStartDateTime,
            end: occEndDateTime,
            isAllDay: isTaskMode ? dueAllDay : isAllDay,
            recurrence: effectiveRecurrence,
            rruleString: effectiveRecurrence ? buildRRuleString(effectiveRecurrence) : undefined,
            type: isTaskMode ? 'task' : 'event',
            dueDate: isTaskMode
              ? dueAllDay
                ? occDateStr
                : `${occDateStr}T${taskTime}`
              : undefined,
            completed: isTaskMode ? completed : undefined,
            priority: isTaskMode ? priority : undefined,
            parentTaskId: isTaskMode ? parentTaskId : undefined,
            travelDuration: isTaskMode ? undefined : travelDuration,
            reminders: isTaskMode ? undefined : reminders,
            transparency: isTaskMode ? undefined : transparency,
            sequence: 0,
            relatedTo: relatedTo.length > 0 ? relatedTo : undefined,
            attachments: attachments.length > 0 ? attachments : undefined,
          }

          addEvent(newSeriesEvent)
          if (attachments.length > 0) {
            putAttachments(newSeriesEvent.id, attachments).catch(() => {})
          }
          try {
            await createCalDAVEvent(masterEvent.calendarId, newSeriesEvent)
          } catch {
            showToast('Failed to sync new series with CalDAV server. It will be retried.')
          }
        } else {
          const eventId = originalEventId || selectedEventId
          // Editing the whole series from one occurrence: the form's due date is
          // that occurrence's, so unless the user actually changed it, keep the
          // master's own DUE as the series anchor.
          const masterForSeries = originalEventId
            ? events.find((e) => e.id === originalEventId)
            : undefined
          const seriesDueDate =
            isTaskMode && masterForSeries && dueDate === seededDueDateRef.current
              ? masterForSeries.dueDate?.split('T')[0] ||
                format(parseISO(masterForSeries.start), 'yyyy-MM-dd')
              : dueDate
          const eventStart =
            isTaskMode && seriesDueDate ? `${seriesDueDate}T${taskTime}` : startDateTime
          const eventEnd =
            isTaskMode && seriesDueDate ? `${seriesDueDate}T${taskEndTime}` : endDateTime
          // Include time in dueDate for non-all-day tasks so we can display it
          const taskDueDate =
            isTaskMode && seriesDueDate
              ? dueAllDay
                ? seriesDueDate
                : `${seriesDueDate}T${taskTime}`
              : undefined
          updateEvent(eventId!, {
            title,
            description: description || undefined,
            location: location || undefined,
            start: eventStart,
            end: eventEnd,
            isAllDay: isTaskMode ? dueAllDay : isAllDay,
            calendarId,
            recurrence: effectiveRecurrence,
            // Keep the raw RRULE in step with the structured rule. The
            // serializer prefers `rruleString` when both are present, so a
            // stale one would silently outvote the edit just made.
            rruleString: effectiveRecurrence ? buildRRuleString(effectiveRecurrence) : undefined,
            travelDuration: isTaskMode ? undefined : travelDuration,
            type: isTaskMode ? 'task' : 'event',
            dueDate: taskDueDate,
            completed: isTaskMode ? completed : undefined,
            priority: isTaskMode ? priority : undefined,
            parentTaskId: isTaskMode ? parentTaskId : undefined,
            reminders: isTaskMode ? undefined : reminders,
            transparency: isTaskMode ? undefined : transparency,
            categories: selectedCategories,
            relatedTo: relatedTo.length > 0 ? relatedTo : undefined,
            attachments: attachments.length > 0 ? attachments : undefined,
          })
          const cascadedTasks =
            isTaskMode && completed && !events.find((event) => event.id === eventId)?.completed
              ? completeTask(eventId!, true)
              : []
          // Sync IndexedDB with current attachments
          if (attachments.length > 0) {
            putAttachments(eventId!, attachments).catch(() => {})
          } else {
            deleteAttachments(eventId!).catch(() => {})
          }
          const existingEvent = events.find((e) => e.id === eventId)
          if (existingEvent) {
            console.log(
              '[EventModal] Saving event. attachments state:',
              JSON.stringify(attachments)
            )
            console.log(
              '[EventModal] existingEvent.attachments:',
              JSON.stringify(existingEvent.attachments)
            )
            await safeCalDAVUpdate(
              updateCalDAVEvent,
              calendarId,
              {
                ...existingEvent,
                title,
                description: description || undefined,
                location: location || undefined,
                start: eventStart,
                end: eventEnd,
                isAllDay: isTaskMode ? dueAllDay : isAllDay,
                calendarId,
                recurrence: effectiveRecurrence,
                rruleString: effectiveRecurrence
                  ? buildRRuleString(effectiveRecurrence)
                  : undefined,
                travelDuration: isTaskMode ? undefined : travelDuration,
                type: isTaskMode ? 'task' : 'event',
                dueDate: taskDueDate,
                completed: isTaskMode ? completed : undefined,
                priority: isTaskMode ? priority : undefined,
                parentTaskId: isTaskMode ? parentTaskId : undefined,
                reminders: isTaskMode ? undefined : reminders,
                transparency: isTaskMode ? undefined : transparency,
                categories: selectedCategories,
                relatedTo: relatedTo.length > 0 ? relatedTo : undefined,
              },
              {
                title,
                description: description || undefined,
                location: location || undefined,
                start: eventStart,
                end: eventEnd,
                isAllDay: isTaskMode ? dueAllDay : isAllDay,
                calendarId,
                recurrence: effectiveRecurrence,
                rruleString: effectiveRecurrence
                  ? buildRRuleString(effectiveRecurrence)
                  : undefined,
                travelDuration: isTaskMode ? undefined : travelDuration,
                type: isTaskMode ? 'task' : 'event',
                dueDate: taskDueDate,
                completed: isTaskMode ? completed : undefined,
                priority: isTaskMode ? priority : undefined,
                parentTaskId: isTaskMode ? parentTaskId : undefined,
                reminders: isTaskMode ? undefined : reminders,
                transparency: isTaskMode ? undefined : transparency,
                categories: selectedCategories,
                relatedTo: relatedTo.length > 0 ? relatedTo : undefined,
                attachments: attachments.length > 0 ? attachments : undefined,
              }
            )
            await Promise.all(
              cascadedTasks
                .filter((task) => task.id !== eventId)
                .map((task) => safeCalDAVUpdate(updateCalDAVEvent, task.calendarId, task, {}))
            )
          }
        }
      } else {
        const eventStart = isTaskMode && dueDate ? `${dueDate}T${taskTime}` : startDateTime
        const eventEnd = isTaskMode && dueDate ? `${dueDate}T${taskEndTime}` : endDateTime
        // Include time in dueDate for non-all-day tasks so we can display it
        const taskDueDate =
          isTaskMode && dueDate ? (dueAllDay ? dueDate : `${dueDate}T${taskTime}`) : undefined

        const newEvent: CalendarEvent = {
          id: uuidv4(),
          title,
          description: description || undefined,
          location: location || undefined,
          start: eventStart,
          end: eventEnd,
          isAllDay: isTaskMode ? dueAllDay : isAllDay,
          calendarId,
          recurrence: effectiveRecurrence,
          rruleString: effectiveRecurrence ? buildRRuleString(effectiveRecurrence) : undefined,
          travelDuration: isTaskMode ? undefined : travelDuration,
          type: isTaskMode ? 'task' : 'event',
          dueDate: taskDueDate,
          completed: isTaskMode ? completed : undefined,
          priority: isTaskMode ? priority : undefined,
          parentTaskId: isTaskMode ? parentTaskId : undefined,
          reminders: isTaskMode ? undefined : reminders,
          transparency: isTaskMode ? undefined : transparency,
          categories: selectedCategories,
          relatedTo: relatedTo.length > 0 ? relatedTo : undefined,
          attachments: attachments.length > 0 ? attachments : undefined,
        }
        addEvent(newEvent)
        // Learn smart defaults from this creation: the calendar chosen and, for
        // timed single-day events, the length picked for this kind of title.
        if (newEvent.title.trim()) {
          let durationMinutes: number | undefined
          if (!newEvent.isAllDay) {
            const diffMs = parseISO(newEvent.end).getTime() - parseISO(newEvent.start).getTime()
            const mins = Math.round(diffMs / 60000)
            if (mins > 0 && mins <= 24 * 60) durationMinutes = mins
          }
          useSmartDefaultsStore
            .getState()
            .record(newEvent.title, newEvent.calendarId, durationMinutes)
        }
        // Move attachments from temp 'new' key to actual event ID
        if (attachments.length > 0) {
          deleteAttachments('new').catch(() => {})
          putAttachments(newEvent.id, attachments).catch(() => {})
        }
        await safeCalDAVUpdate(createCalDAVEvent, calendarId, newEvent, {})
      }

      setShowRecurrenceDialog(false)
      closeModal()
    } finally {
      // Release the guard so a follow-up save (after an early-return toast,
      // or after the user re-opens the modal) can proceed. `closeModal()`
      // unmounts this component on the happy path, so resetting `isSaving`
      // here is harmless.
      isSavingRef.current = false
      setIsSaving(false)
    }
  }

  const handleRecurrenceDialogConfirm = async (mode: RecurrenceEditMode): Promise<void> => {
    if (!title.trim()) {
      showToast('Title is required')
      return
    }
    await saveEvent(mode)
  }

  const handleDelete = (): void => {
    if (isRecurringEvent) {
      setShowDeleteDialog(true)
      return
    }

    if (!confirmDelete) {
      setConfirmDelete(true)
      setTimeout(() => setConfirmDelete(false), 3000)
      return
    }

    performDelete(existingEventForMode?.recurrenceId ? 'this' : 'all')
  }

  const performDelete = async (mode: RecurrenceEditMode): Promise<void> => {
    if (!selectedEventId) return
    const ok = await deleteRecurringOccurrence({
      mode,
      clickedEventId: selectedEventId,
      originalEventId,
      events,
      saveRecurrenceOverride,
      deleteEvent,
      addEvent,
      createCalDAVEvent,
      deleteCalDAVEvent,
    })
    if (!ok) return
    setShowDeleteDialog(false)
    closeModal()
  }

  if (!isModalOpen && !isClosing) {
    return null
  }

  return (
    <div
      className={`${styles.modalBackdrop} ${isClosing ? styles.closing : ''}`}
      onClick={animateClose}
      data-component="modal-backdrop"
    >
      <motion.div
        ref={dialogRef}
        className={`${styles.modalCard} ${isClosing ? styles.modalClosing : ''}`}
        style={{ y: sheetY }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Event modal'}
        data-component="modal-card"
      >
        {/* Entrance animation lives entirely on this inner wrapper via plain
            CSS, deliberately with nothing to do with `sheetY`/drag above —
            three straight attempts to drive it off the same motion value
            used for drag (directly, then layout-effect-timed, then via
            framer's own initial/animate) all fought the drag system in some
            way. A plain CSS transform/opacity on a completely separate
            element can't conflict with anything. */}
        <div className={styles.modalEntrance} data-component="modal-entrance">
          <div className={styles.modalBand} data-component="modal-band" />
          <div className={styles.sheetDragRegion}>
            <div className={styles.dragHandle} aria-hidden="true" />
            <div className={styles.modalHeader}>
              <button
                type="button"
                className={styles.titleEditIcon}
                onClick={() => titleInputRef.current?.focus()}
                aria-label="Focus title input"
              >
                <svg
                  aria-hidden="true"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
              <div className={styles.titleInputWrapper}>
                <input
                  ref={titleInputRef}
                  type="text"
                  placeholder={isTaskMode ? 'Task title' : 'Event title'}
                  value={title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  onKeyDown={handleTitleKeyDown}
                  className={styles.modalTitle}
                  data-component="event-title-input"
                  required
                  onInvalid={(e) => {
                    e.preventDefault()
                    showToast('Title is required')
                  }}
                />
                {showSuggestions && (
                  <div className={styles.titleSuggestions}>
                    {titleSuggestions.map((ev, i) => (
                      <button
                        key={ev.id}
                        type="button"
                        className={`${styles.suggestionItem} ${i === highlightedIndex ? styles.suggestionItemActive : ''}`}
                        onClick={() => applySuggestion(ev)}
                      >
                        <span className={styles.suggestionTitle}>{ev.title}</span>
                        {ev.description && (
                          <span className={styles.suggestionDesc}>{ev.description}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {nlpSuggestion && !showSuggestions && (
                  <button
                    type="button"
                    className={styles.nlpChip}
                    onClick={() => applyNlpSuggestion(nlpSuggestion)}
                    data-component="nlp-suggestion"
                  >
                    <span className={styles.nlpChipIcon} aria-hidden="true">
                      ✨
                    </span>
                    <span className={styles.nlpChipText}>
                      {nlpSuggestion.isAllDay
                        ? format(nlpSuggestion.startDate, 'EEE, MMM d')
                        : format(nlpSuggestion.startDate, 'EEE, MMM d · h:mm a')}
                      {nlpSuggestion.recurrence ? ' · repeats' : ''}
                    </span>
                    <kbd className={styles.nlpChipKbd}>Tab</kbd>
                  </button>
                )}
              </div>
              <button className={styles.modalClose} onClick={animateClose} aria-label="Close">
                ×
              </button>
            </div>
          </div>
          <hr className={styles.modalDivider} />
          <form
            key={`${selectedEventId}-${selectedDate}-${selectedEventType}`}
            onClick={(e) => {
              // Close suggestions when clicking outside the suggestions dropdown
              if (!(e.target as HTMLElement).closest(`.${styles.titleSuggestions}`)) {
                setTitleSuggestions([])
              }
            }}
            onSubmit={handleSubmit}
            className={styles.modalBody}
            data-component="modal-body"
          >
            <div ref={scrollRef} className={styles.modalScroll} data-component="modal-scroll">
              <div className={styles.modalGroup}>
                {isTaskMode && (
                  <TaskFormFields
                    completed={completed}
                    onCompletedChange={setCompleted}
                    dueDate={dueDate}
                    onDueDateChange={(date) => {
                      setDueDate(date)
                      if (!date) setDueAllDay(true)
                    }}
                    dueTime={dueTime}
                    onDueTimeChange={setDueTime}
                    dueAllDay={dueAllDay}
                    onDueAllDayChange={setDueAllDay}
                    priority={priority}
                    onPriorityChange={setPriority}
                    parentTaskId={parentTaskId}
                    parentTasks={parentTaskOptions}
                    onParentTaskChange={setParentTaskId}
                    subtasks={subtasks}
                    recurrence={{
                      recurring: recurring && recurrenceAllowed,
                      onRecurringChange: setRecurring,
                      disabledReason: taskRecurrenceDisabledReason,
                      recurrence,
                      onRecurrenceChange: (freq) => {
                        setRecurrence(freq)
                        if (freq !== 'weekly' && freq !== 'monthly' && freq !== 'yearly') {
                          setByWeekday([])
                        }
                        if (freq !== 'monthly' && freq !== 'yearly') {
                          setByMonthDay([])
                          setByMonth([])
                          setByDayOrdinals([])
                        }
                      },
                      interval,
                      onIntervalChange: setInterval,
                      byWeekday,
                      onByWeekdayChange: setByWeekday,
                      byMonthDay,
                      onByMonthDayChange: setByMonthDay,
                      byMonth,
                      onByMonthChange: setByMonth,
                      byDayOrdinals,
                      onByDayOrdinalsChange: setByDayOrdinals,
                      endCondition,
                      onEndConditionChange: setEndCondition,
                      endOnDate,
                      onEndOnDateChange: setEndOnDate,
                      endAfterCount,
                      onEndAfterCountChange: setEndAfterCount,
                    }}
                    onOpenSubtask={(taskId) => openModal(undefined, undefined, taskId, 'task')}
                    onAddSubtask={
                      selectedEventId
                        ? () =>
                            openModal(
                              undefined,
                              undefined,
                              undefined,
                              'task',
                              undefined,
                              selectedEventId
                            )
                        : undefined
                    }
                  />
                )}

                {!isTaskMode && (
                  <EventFormFields
                    isAllDay={isAllDay}
                    onIsAllDayChange={setIsAllDay}
                    startDate={startDate}
                    onStartDateChange={setStartDate}
                    startTime={startTime}
                    onStartTimeChange={setStartTime}
                    endDate={endDate}
                    onEndDateChange={setEndDate}
                    endTime={endTime}
                    onEndTimeChange={handleEndTimeChange}
                    recurring={recurring}
                    onRecurringChange={setRecurring}
                    recurrence={recurrence}
                    onRecurrenceChange={(freq) => {
                      setRecurrence(freq)
                      // Clear weekday/month selections that don't apply to the new frequency
                      if (freq !== 'weekly' && freq !== 'monthly' && freq !== 'yearly') {
                        setByWeekday([])
                      }
                      if (freq !== 'monthly' && freq !== 'yearly') {
                        setByMonthDay([])
                        setByMonth([])
                        setByDayOrdinals([])
                      }
                    }}
                    interval={interval}
                    onIntervalChange={setInterval}
                    byWeekday={byWeekday}
                    onByWeekdayChange={setByWeekday}
                    byMonthDay={byMonthDay}
                    onByMonthDayChange={setByMonthDay}
                    byMonth={byMonth}
                    onByMonthChange={setByMonth}
                    byDayOrdinals={byDayOrdinals}
                    onByDayOrdinalsChange={setByDayOrdinals}
                    endCondition={endCondition}
                    onEndConditionChange={setEndCondition}
                    endOnDate={endOnDate}
                    onEndOnDateChange={setEndOnDate}
                    endAfterCount={endAfterCount}
                    onEndAfterCountChange={setEndAfterCount}
                    travelDuration={travelDuration}
                    onTravelDurationChange={setTravelDuration}
                    reminders={reminders}
                    onRemindersChange={setReminders}
                    transparency={transparency}
                    onTransparencyChange={setTransparency}
                    relatedTo={relatedTo}
                    onRelatedToChange={setRelatedTo}
                    candidateEvents={candidateEvents}
                    attachments={attachments}
                    onAttachmentsChange={setAttachments}
                    attachmentEventId={selectedEventId}
                  />
                )}
              </div>

              <div className={styles.modalGroup}>
                <div className={styles.modalRow2}>
                  <input
                    type="text"
                    placeholder="Location"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className={styles.modalInput}
                    data-component="event-location-input"
                  />

                  <select
                    id="calendar-select"
                    value={calendarId}
                    onChange={(e) => handleCalendarChange(e.target.value)}
                    className={styles.modalSelect}
                    data-component="event-calendar-select"
                    disabled={isCurrentCalendarReadOnly}
                  >
                    {isCurrentCalendarReadOnly &&
                      !compatibleCalendars.some((cal) => cal.id === calendarId) && (
                        <option value={calendarId}>
                          {calendars.find((c) => c.id === calendarId)?.name} (read-only)
                        </option>
                      )}
                    {compatibleCalendars.map((cal) => (
                      <option key={cal.id} value={cal.id}>
                        {cal.name}
                      </option>
                    ))}
                  </select>
                </div>

                {isCurrentCalendarReadOnly && (
                  <p className={styles.readOnlyNotice} data-component="readonly-calendar-notice">
                    This calendar is a read-only subscription — events sync from the source and
                    can&apos;t be edited here.
                  </p>
                )}
              </div>

              <div className={styles.modalGroup}>
                {categories.length > 0 && (
                  <div className={styles.modalRow2}>
                    <div className={styles.categoriesContainer}>
                      <div className={styles.categoriesLabel}>Categories</div>
                      <div className={styles.categoriesList}>
                        {categories.map((cat) => (
                          <button
                            key={cat.id}
                            type="button"
                            aria-pressed={selectedCategories.includes(cat.name)}
                            className={`${styles.categoryChip} ${
                              selectedCategories.includes(cat.name)
                                ? styles.categoryChipSelected
                                : ''
                            }`}
                            onClick={() => {
                              if (selectedCategories.includes(cat.name)) {
                                setSelectedCategories(
                                  selectedCategories.filter((name) => name !== cat.name)
                                )
                              } else {
                                setSelectedCategories([...selectedCategories, cat.name])
                              }
                            }}
                          >
                            <span
                              className={styles.categoryChipDot}
                              style={{ backgroundColor: cat.color }}
                            />
                            {cat.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {!showDescription ? (
                  <button
                    type="button"
                    className={styles.modalAddDesc}
                    onClick={() => setShowDescription(true)}
                  >
                    + Add description
                  </button>
                ) : (
                  <div className={styles.modalField}>
                    <div className={styles.fieldHeader}>
                      <label className={styles.label}>Description</label>
                      <button
                        type="button"
                        className={styles.removeFieldButton}
                        onClick={() => {
                          setShowDescription(false)
                          setDescription('')
                        }}
                      >
                        ×
                      </button>
                    </div>
                    <textarea
                      placeholder="Add description..."
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className={`${styles.modalInput} ${styles.modalTextarea}`}
                      data-component="event-description-input"
                      rows={3}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className={styles.modalFooter} data-component="modal-footer">
              {isEditing && !isCurrentCalendarReadOnly && (
                <button
                  type="button"
                  className={`${styles.modalDelete} ${confirmDelete ? styles.modalDeleteConfirm : ''}`}
                  onClick={handleDelete}
                >
                  {confirmDelete ? 'Click again to confirm' : 'Delete'}
                </button>
              )}
              <div className={styles.modalActions}>
                <button type="button" className={styles.modalCancel} onClick={animateClose}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.modalSave}
                  disabled={
                    !title.trim() ||
                    isTimeRangeInvalid ||
                    isSaving ||
                    isCurrentCalendarReadOnly ||
                    !compatibleCalendars.some((calendar) => calendar.id === calendarId)
                  }
                  aria-busy={isSaving}
                  data-component="modal-save"
                >
                  {isSaving && <span className={styles.modalSaveSpinner} aria-hidden="true" />}
                  <span>{isSaving ? 'Saving…' : isEditing ? 'Save' : 'Create'}</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      </motion.div>

      <RecurrenceDialog
        isOpen={showRecurrenceDialog}
        onClose={() => setShowRecurrenceDialog(false)}
        onConfirm={handleRecurrenceDialogConfirm}
        isTask={isTaskMode}
      />

      <DeleteDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={performDelete}
        isTask={isTaskMode}
      />
    </div>
  )
}
