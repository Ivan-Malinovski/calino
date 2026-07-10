import type { JSX } from 'react'
import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { format, parseISO } from 'date-fns'
import { pad2 } from '@/lib/datetime'
import { v4 as uuidv4 } from 'uuid'
import { useCalendarStore } from '@/store/calendarStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { showToast } from '@/lib/toast'
import { safeCalDAVUpdate } from '@/lib/caldavHelpers'
import { deleteEventWithUndo } from '@/lib/deleteWithUndo'
import { buildRRuleString } from '@/lib/recurrence'
import { buildMasterTruncation } from '@/lib/recurrenceSplit'
import type { CalendarEvent, CalendarAttachment, RecurrenceRule, TaskPriority, Reminder } from '@/types'
import { putAttachments, getAttachments, deleteAttachments } from '@/lib/attachmentStore'
import { TaskFormFields } from './TaskFormFields'
import { EventFormFields } from './EventFormFields'
import { RecurrenceDialog } from './RecurrenceDialog'
import { DeleteDialog } from './DeleteDialog'
import { getInitialFormState } from './eventModalState'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { parseNaturalLanguage } from '@/features/nlp'
import type { NLPParseResult } from '@/features/nlp'
import { useSmartDefaultsStore } from '@/store/smartDefaultsStore'

import styles from './EventModal.module.css'

type RecurrenceEditMode = 'all' | 'future' | 'this'

export function EventModal(): JSX.Element | null {
  const isModalOpen = useCalendarStore((state) => state.isModalOpen)
  const selectedEventId = useCalendarStore((state) => state.selectedEventId)
  const selectedDate = useCalendarStore((state) => state.selectedDate)
  const selectedEndDate = useCalendarStore((state) => state.selectedEndDate)
  const initialTitle = useCalendarStore((state) => state.initialTitle)
  const initialCalendarId = useCalendarStore((state) => state.initialCalendarId)
  const subtaskParentId = useCalendarStore((state) => state.subtaskParentId)
  const selectedEventType = useCalendarStore((state) => state.selectedEventType)
  const events = useCalendarStore((state) => state.events)
  const calendars = useCalendarStore((state) => state.calendars)
  const categories = useCalendarStore((state) => state.categories)
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
    setTimeout(() => {
      setIsClosing(false)
      closeModal()
    }, prefersReducedMotion ? 0 : 200)
  }, [closeModal, prefersReducedMotion])
  const {
    createEvent: createCalDAVEvent,
    updateEvent: updateCalDAVEvent,
    deleteEvent: deleteCalDAVEvent,
  } = useCalDAV()

  const existingEvent = selectedEventId
    ? events.find((event) => event.id === selectedEventId)
    : undefined
  const requiredCalendarComponent =
    selectedEventType === 'task' || existingEvent?.type === 'task' ? 'VTODO' : 'VEVENT'
  const compatibleCalendars = useMemo(
    () =>
      calendars.filter(
        (calendar) =>
          !calendar.supportedComponents ||
          calendar.supportedComponents.includes(requiredCalendarComponent)
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
        categories
      ),
    [isModalOpen, selectedEventId, selectedDate, selectedEndDate, events, compatibleCalendars, categories]
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
  const [recurrence, setRecurrence] = useState<RecurrenceRule['frequency']>(
    initialState.recurrence
  )
  const [interval, setInterval] = useState<number>(initialState.interval)
  const [byWeekday, setByWeekday] = useState<number[]>(initialState.byWeekday)
  const [byMonthDay, setByMonthDay] = useState<number[]>(initialState.byMonthDay)
  const [byMonth, setByMonth] = useState<number[]>(initialState.byMonth)
  const [byDayOrdinals, setByDayOrdinals] = useState<number[]>(initialState.byDayOrdinals)
  const [endCondition, setEndCondition] = useState<'never' | 'on' | 'after'>(initialState.endCondition)
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

  const handleEndTimeChange = useCallback((val: string): void => {
    durationTouchedRef.current = true
    setEndTime(val)
  }, [])

  const handleCalendarChange = useCallback((val: string): void => {
    calendarTouchedRef.current = true
    setCalendarId(val)
  }, [])

  // Load attachments from IndexedDB when modal opens with existing event
  useEffect(() => {
    if (!isModalOpen || !initialState.attachments || initialState.attachments.length === 0) {
      setAttachments([])
      return
    }
    if (!selectedEventId) {
      setAttachments(initialState.attachments)
      return
    }
    getAttachments(selectedEventId)
      .then((loaded) => {
        if (loaded.length > 0) {
          setAttachments(loaded)
        } else {
          // No IndexedDB data yet (migrated from localStorage), use zustand metadata
          setAttachments(initialState.attachments!)
        }
      })
      .catch(() => {
        setAttachments(initialState.attachments!)
      })
  }, [isModalOpen, selectedEventId])

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
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeModalRef = useRef(closeModal)
  useEffect(() => { closeModalRef.current = closeModal })

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
        const strippedSomething = parsed.title.trim().length > 0 && parsed.title.trim() !== val.trim()
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
    // Fill time only if using default (09:00-10:00)
    if (startTime === '09:00' && endTime === '10:00') {
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
    if (nlpSuggestion && !showSuggestions && (e.key === 'Tab' || (e.key === 'Enter' && e.shiftKey))) {
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
      const currentEvent = selectedEventId
        ? currentEvents.find((event) => event.id === selectedEventId)
        : undefined
      const requiredComponent =
        currentSelectedEventType === 'task' || currentEvent?.type === 'task'
          ? 'VTODO'
          : 'VEVENT'
      const currentCalendars = state.calendars.filter(
        (calendar) =>
          !calendar.supportedComponents ||
          calendar.supportedComponents.includes(requiredComponent)
      )
      const currentCategories = state.categories

      const formDefaults = getInitialFormState(
        isModalOpen,
        selectedEventId,
        selectedDate,
        selectedEndDate,
        currentEvents,
        currentCalendars,
        currentCategories
      )

      calendarTouchedRef.current = false
      durationTouchedRef.current = false

      const requestedParent = subtaskParentId
        ? currentEvents.find((event) => event.id === subtaskParentId && event.type === 'task')
        : undefined
      // Seed from formDefaults; if the caller passed an initialTitle (e.g. the
      // TodoView composer), override with that. This means the user's typed
      // text isn't lost when they press Enter in the inline composer.
      setTitle(initialTitle ?? formDefaults.title)
      setDescription(formDefaults.description)
      setLocation(formDefaults.location)
      setStartDate(formDefaults.startDate)
      setStartTime(formDefaults.startTime)
      setEndDate(formDefaults.endDate)
      setEndTime(formDefaults.endTime)
      setIsAllDay(formDefaults.isAllDay)
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
      setShowDescription(!!formDefaults.description)
      setSelectedCategories(formDefaults.categories)
      setRelatedTo(formDefaults.relatedTo)
      setParentTaskId(currentEvent?.parentTaskId ?? requestedParent?.id)

      const existingEvent = selectedEventId
        ? currentEvents.find((e) => e.id === selectedEventId)
        : undefined
      if (existingEvent?.type === 'task') {
        const taskDueDate =
          existingEvent.dueDate?.split('T')[0] ||
          format(parseISO(existingEvent.start), 'yyyy-MM-dd')
        setDueDate(taskDueDate)
        const taskTime = format(parseISO(existingEvent.start), 'HH:mm')
        setDueTime(taskTime !== '00:00' ? taskTime : '09:00')
        setDueAllDay(existingEvent.isAllDay ?? true)
        setCompleted(existingEvent.completed || false)
        setPriority(existingEvent.priority)
      } else if (currentSelectedEventType === 'task') {
        setDueDate(requestedParent?.dueDate?.split('T')[0] || selectedDate || format(new Date(), 'yyyy-MM-dd'))
        setDueTime('09:00')
        setDueAllDay(true)
        setCompleted(false)
        setPriority(undefined)
      } else {
        setDueDate('')
        setDueTime('09:00')
        setDueAllDay(true)
        setCompleted(false)
        setPriority(undefined)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only reset on user-initiated event/date/endDate changes
  }, [selectedEventId, selectedDate, selectedEndDate, subtaskParentId, initialCalendarId])

  // Auto-focus title input when creating a new event
  useEffect(() => {
    if (isModalOpen && !selectedEventId) {
      setTimeout(() => titleInputRef.current?.focus(), 50)
    }
  }, [isModalOpen, selectedEventId])

  const isEditing = selectedEventId !== null
  const isRecurringEvent = initialState.recurring
  const showSuggestions = !isEditing && titleSuggestions.length > 0
  const originalEventId = initialState.originalEventId
  const existingEventForMode = selectedEventId
    ? events.find((e) => e.id === selectedEventId)
    : undefined
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
    return events.filter((task) => task.type === 'task' && task.calendarId === calendarId && !excludedIds.has(task.id))
  }, [calendarId, events, isTaskMode, selectedEventId])
  const subtasks = useMemo(
    () => events.filter((task) => task.type === 'task' && task.parentTaskId === selectedEventId),
    [events, selectedEventId]
  )

  const hasChanges = useMemo(() => {
    if (!existingEventForMode) return true

    const existingAttachments = existingEventForMode.attachments || []
    const attachmentsChanged = JSON.stringify(attachments) !== JSON.stringify(existingAttachments)

    if (isTaskMode) {
      const taskDueDate = dueDate || format(parseISO(existingEventForMode.start), 'yyyy-MM-dd')
      const taskTime = dueAllDay ? '00:00:00' : `${dueTime}:00`
      const currentStart = `${taskDueDate}T${taskTime}`
      return (
        title !== existingEventForMode.title ||
        description !== (existingEventForMode.description || '') ||
        location !== (existingEventForMode.location || '') ||
        currentStart !== existingEventForMode.start ||
        dueAllDay !== (existingEventForMode.isAllDay ?? true) ||
        completed !== (existingEventForMode.completed || false) ||
        priority !== existingEventForMode.priority ||
        parentTaskId !== existingEventForMode.parentTaskId ||
        calendarId !== existingEventForMode.calendarId ||
        JSON.stringify(selectedCategories) !== JSON.stringify(existingEventForMode.categories || []) ||
        JSON.stringify(relatedTo) !== JSON.stringify(existingEventForMode.relatedTo || []) ||
        attachmentsChanged
      )
    }

    const localStart = isAllDay ? `${startDate}T00:00:00` : `${startDate}T${startTime}:00`
    const localEnd = isAllDay ? `${endDate}T23:59:59` : `${endDate}T${endTime}:00`
    const existingStart = format(parseISO(existingEventForMode.start), "yyyy-MM-dd'T'HH:mm:ss")
    const existingEnd = format(parseISO(existingEventForMode.end), "yyyy-MM-dd'T'HH:mm:ss")

    const existingRecurrence = existingEventForMode.recurrence
    const buildRecurrenceJSON = (
      recur: boolean,
      freq: string,
      inter: number,
      weekdays: number[],
      monthDays: number[],
      months: number[],
      setPos: number[],
      eCond: string,
      eDate: string,
      eCount: number,
    ) => recur ? JSON.stringify({
      frequency: freq, interval: inter, byWeekday: weekdays, byMonthDay: monthDays,
      byMonth: months, byDayOrdinals: setPos,
      // Only compare fields relevant to the active end condition
      ...(eCond === 'on' ? { endOnDate: eDate } : eCond === 'after' ? { endAfterCount: eCount } : {}),
    }) : null

    // R2.4 — Existing recurrence's per-BYDAY ordinals: prefer byDayOrdinals
    // (new), fall back to bySetPos for legacy data (events persisted
    // before R2.4 stored per-BYDAY ordinals in bySetPos when byWeekday
    // was present).
    const existingDayOrdinals = (() => {
      if (existingRecurrence?.byDayOrdinals && existingRecurrence.byDayOrdinals.length > 0) {
        return existingRecurrence.byDayOrdinals
      }
      if (
        existingRecurrence?.bySetPos &&
        existingRecurrence.bySetPos.length > 0 &&
        existingRecurrence.byWeekday &&
        existingRecurrence.byWeekday.length > 0
      ) {
        return existingRecurrence.bySetPos
      }
      return []
    })()

    const existingEndCondition = existingRecurrence?.endDate ? 'on' : existingRecurrence?.count ? 'after' : 'never'
    const currentRecurrenceJSON = buildRecurrenceJSON(
      recurring, recurrence, interval, byWeekday, byMonthDay, byMonth, byDayOrdinals,
      endCondition, endOnDate, endAfterCount,
    )
    const existingRecurrenceJSON = existingRecurrence ? buildRecurrenceJSON(
      true,
      existingRecurrence.frequency,
      existingRecurrence.interval ?? 1,
      existingRecurrence.byWeekday ?? [],
      existingRecurrence.byMonthDay ?? [],
      existingRecurrence.byMonth ?? [],
      existingDayOrdinals,
      existingEndCondition,
      existingRecurrence.endDate ? format(parseISO(existingRecurrence.endDate), 'yyyy-MM-dd') : '',
      existingRecurrence.count ?? 10,
    ) : null

    return (
      title !== existingEventForMode.title ||
      description !== (existingEventForMode.description || '') ||
      location !== (existingEventForMode.location || '') ||
      localStart !== existingStart ||
      localEnd !== existingEnd ||
      isAllDay !== existingEventForMode.isAllDay ||
      recurring !== !!existingRecurrence ||
      currentRecurrenceJSON !== existingRecurrenceJSON ||
      travelDuration !== existingEventForMode.travelDuration ||
      calendarId !== existingEventForMode.calendarId ||
      JSON.stringify(selectedCategories) !== JSON.stringify(existingEventForMode.categories || []) ||
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
        isAllDay
          ? 'End date must be on or after start date'
          : 'End time must be after start time'
      )
      return
    }

    if (isEditing && isRecurringEvent && hasChanges) {
      setShowRecurrenceDialog(true)
      return
    }

    saveEvent('all')
  }

  // R3.4 — single source of truth for end-before-start. Used by:
  //   - the form's Save button (disabled prop)
  //   - the submit handler (toast + early return)
  //   - saveEvent (called from the recurrence-dialog confirm path)
  //   Each of those three sites used to inline-compute this; consolidating
  // here keeps them in lockstep.
  const isTimeRangeInvalid = useMemo(() => {
    if (!isAllDay) {
      const startMs = new Date(`${startDate}T${startTime}:00`).getTime()
      const endMs = new Date(`${endDate}T${endTime}:00`).getTime()
      return endMs <= startMs
    }
    return endDate < startDate
  }, [isAllDay, startDate, startTime, endDate, endTime])

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
      // end<start would slip through.
      if (!isAllDay) {
        const startMs = new Date(`${startDate}T${startTime}:00`).getTime()
        const endMs = new Date(`${endDate}T${endTime}:00`).getTime()
        if (endMs <= startMs) {
          showToast('End time must be after start time')
          return
        }
      } else if (endDate < startDate) {
        showToast('End date must be on or after start date')
        return
      }

      const localStart = isAllDay ? `${startDate}T00:00:00` : `${startDate}T${startTime}:00`
      const localEnd = isAllDay ? `${endDate}T23:59:59` : `${endDate}T${endTime}:00`
      const startDateTime = isAllDay ? `${startDate}T00:00:00` : new Date(localStart).toISOString()
      const endDateTime = isAllDay ? `${endDate}T00:00:00` : new Date(localEnd).toISOString()

      const recurrenceRule: RecurrenceRule | undefined =
        recurring
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

      if (isEditing && selectedEventId) {
        // For recurring-instance edits ("this occurrence" / "this and following"),
        // the clicked occurrence's date is encoded in the instance id as
        // `masterId-<ISO>` and differs from the form's start date (which reflects
        // the master's first occurrence). Anchor those edits to the clicked
        // occurrence's date, preserving the event's time-of-day and duration
        // (including any edits the user made in the form). Falls back to the form
        // date for non-instance ids (plain master edits).
        const occInstanceMatch = selectedEventId.match(
          /-(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
        )
        const occDateStr = occInstanceMatch ? occInstanceMatch[1] : startDate
        const durationMs = new Date(endDateTime).getTime() - new Date(startDateTime).getTime()
        const occStartDateTime = isAllDay
          ? `${occDateStr}T00:00:00`
          : new Date(`${occDateStr}T${startTime}:00`).toISOString()
        let occEndDateTime: string
        if (isAllDay) {
          const spanDays = Math.round(
            (new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime()) /
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

          const isoDateMatch = selectedEventId.match(
            /(.+)-(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)$/
          )
          const originalOccurrenceDate = isoDateMatch ? isoDateMatch[2] : null
          if (!originalOccurrenceDate) {
            showToast('Invalid event data. Cannot edit single occurrence.')
            return
          }

          const exceptionEvent: CalendarEvent = {
            id: `${originalEventId}-${originalOccurrenceDate}`,
            calendarId: masterEvent.calendarId,
            title,
            description: description || undefined,
            location: location || undefined,
            start: occStartDateTime,
            end: occEndDateTime,
            isAllDay,
            recurrence: undefined,
            rruleString: undefined,
            recurrenceId: originalOccurrenceDate,
            travelDuration,
            reminders,
            transparency,
            sequence: 0,
            relatedTo: relatedTo.length > 0 ? relatedTo : undefined,
            attachments: attachments.length > 0 ? attachments : undefined,
          }

          addEvent(exceptionEvent)
          // Sync IndexedDB for exception event
          if (attachments.length > 0) {
            putAttachments(exceptionEvent.id, attachments).catch(() => {})
          }
          try {
            await createCalDAVEvent(masterEvent.calendarId, exceptionEvent)
          } catch {
            showToast('Failed to sync event with CalDAV server. It will be retried.')
          }

          // Add EXDATE to master so rrule expansion skips this date and only
          // the exception event is shown.  Without this the master would still
          // generate an occurrence on that date, creating a visible duplicate.
          const occurrenceDate = originalOccurrenceDate.split('T')[0]
          const masterExcludedDates = masterEvent.excludedDates || []
          if (!masterExcludedDates.includes(occurrenceDate)) {
            const updatedExcludedDates = [...masterExcludedDates, occurrenceDate]
            updateEvent(originalEventId, { excludedDates: updatedExcludedDates })
            await safeCalDAVUpdate(
              updateCalDAVEvent,
              masterEvent.calendarId,
              { ...masterEvent, excludedDates: updatedExcludedDates },
              { excludedDates: updatedExcludedDates }
            ).catch(() => {})
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

          const isoDateMatch = selectedEventId.match(
            /(.+)-(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)$/
          )
          const originalOccurrenceDate = isoDateMatch ? isoDateMatch[2] : null
          if (!originalOccurrenceDate) {
            showToast('Invalid event data. Cannot split series.')
            return
          }

          const occurrenceDateStr = originalOccurrenceDate.split('T')[0]
          // Update master: end its recurrence the day before the split and add an
          // EXDATE for the split date (shared with the preview popup's split path).
          const {
            excludedDates: updatedExcludedDates,
            recurrence: masterRecurrence,
            rruleString: masterRruleString,
          } = buildMasterTruncation(masterEvent, occurrenceDateStr)

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
            isAllDay,
            recurrence: recurrenceRule,
            rruleString: recurrenceRule ? buildRRuleString(recurrenceRule) : undefined,
            travelDuration,
            reminders,
            transparency,
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
          const taskTime = dueAllDay ? '00:00:00' : `${dueTime}:00`
          const taskEndTime = dueAllDay ? '23:59:59' : `${dueTime}:00`
          const eventStart = isTaskMode && dueDate ? `${dueDate}T${taskTime}` : startDateTime
          const eventEnd = isTaskMode && dueDate ? `${dueDate}T${taskEndTime}` : endDateTime
          // Include time in dueDate for non-all-day tasks so we can display it
          const taskDueDate =
            isTaskMode && dueDate ? (dueAllDay ? dueDate : `${dueDate}T${taskTime}`) : undefined
          updateEvent(eventId!, {
            title,
            description: description || undefined,
            location: location || undefined,
            start: eventStart,
            end: eventEnd,
            isAllDay: isTaskMode ? dueAllDay : isAllDay,
            calendarId,
            recurrence: isTaskMode ? undefined : recurrenceRule,
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
            console.log('[EventModal] Saving event. attachments state:', JSON.stringify(attachments))
            console.log('[EventModal] existingEvent.attachments:', JSON.stringify(existingEvent.attachments))
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
                recurrence: isTaskMode ? undefined : recurrenceRule,
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
                recurrence: isTaskMode ? undefined : recurrenceRule,
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
        const taskTime = dueAllDay ? '00:00:00' : `${dueTime}:00`
        const taskEndTime = dueAllDay ? '23:59:59' : `${dueTime}:00`
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
          recurrence: isTaskMode ? undefined : recurrenceRule,
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
          useSmartDefaultsStore.getState().record(newEvent.title, newEvent.calendarId, durationMinutes)
        }
        // Move attachments from temp 'new' key to actual event ID
        if (attachments.length > 0) {
          deleteAttachments('new').catch(() => {})
          putAttachments(newEvent.id, attachments).catch(() => {})
        }
        await safeCalDAVUpdate(
          createCalDAVEvent,
          calendarId,
          newEvent,
          {}
        )
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

    performDelete('all')
  }

  const performDelete = async (mode: RecurrenceEditMode): Promise<void> => {
    if (mode === 'this' && originalEventId) {
      // Add the occurrence's date to excludedDates on the master - do not delete the series
      if (!selectedEventId) return
      const occurrenceStartISO = selectedEventId.slice(originalEventId.length + 1)
      const occurrenceDate = occurrenceStartISO.split('T')[0]
      const masterEvent = events.find((e) => e.id === originalEventId)
      if (masterEvent) {
        const excludedDates = masterEvent.excludedDates || []
        if (!excludedDates.includes(occurrenceDate)) {
          const updatedExcludedDates = [...excludedDates, occurrenceDate]
          updateEvent(originalEventId, { excludedDates: updatedExcludedDates })
          await safeCalDAVUpdate(
            updateCalDAVEvent,
            calendarId,
            { ...masterEvent, excludedDates: updatedExcludedDates },
            { excludedDates: updatedExcludedDates }
          )
        }
      }
    } else {
      const eventIdToDelete = originalEventId || selectedEventId
      if (eventIdToDelete) {
        const eventToDelete = events.find((e) => e.id === eventIdToDelete)
        if (eventToDelete) {
          deleteEventWithUndo({
            event: eventToDelete,
            deleteEvent,
            addEvent,
            createCalDAVEvent,
            deleteCalDAVEvent,
          })
        }
      }
    }
    setShowDeleteDialog(false)
    closeModal()
  }

  if (!isModalOpen && !isClosing) {
    return null
  }

  return (
    <div className={`${styles.modalBackdrop} ${isClosing ? styles.closing : ''}`} onClick={animateClose} data-component="modal-backdrop">
      <div ref={dialogRef} className={`${styles.modalCard} ${isClosing ? styles.modalClosing : ''}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title || 'Event modal'} data-component="modal-card">
        <div className={styles.modalBand} data-component="modal-band" />
        <div className={styles.modalHeader}>
          <button
            type="button"
            className={styles.titleEditIcon}
            onClick={() => titleInputRef.current?.focus()}
            aria-label="Focus title input"
          >
            <svg aria-hidden="true"
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
                <span className={styles.nlpChipIcon} aria-hidden="true">✨</span>
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
          {isTaskMode && (
            <TaskFormFields
              completed={completed}
              onCompletedChange={setCompleted}
              dueDate={dueDate}
              onDueDateChange={setDueDate}
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
               onOpenSubtask={(taskId) => openModal(undefined, undefined, taskId, 'task')}
               onAddSubtask={selectedEventId ? () => openModal(undefined, undefined, undefined, 'task', undefined, selectedEventId) : undefined}
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
            >
              {compatibleCalendars.map((cal) => (
                <option key={cal.id} value={cal.id}>
                  {cal.name}
                </option>
              ))}
            </select>
          </div>

          {categories.length > 0 && (
            <div className={styles.modalRow2}>
              <div className={styles.categoriesContainer}>
                <div className={styles.categoriesLabel}>Categories</div>
                <div className={styles.categoriesList}>
                  {categories.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      className={`${styles.categoryChip} ${
                        selectedCategories.includes(cat.name) ? styles.categoryChipSelected : ''
                      }`}
                      onClick={() => {
                        if (selectedCategories.includes(cat.name)) {
                          setSelectedCategories(selectedCategories.filter((name) => name !== cat.name))
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

          <div className={styles.modalFooter} data-component="modal-footer">
            {isEditing && (
              <button type="button" className={`${styles.modalDelete} ${confirmDelete ? styles.modalDeleteConfirm : ''}`} onClick={handleDelete}>
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
                  !compatibleCalendars.some((calendar) => calendar.id === calendarId)
                }
                aria-busy={isSaving}
                data-component="modal-save"
              >
                {isSaving && (
                  <span className={styles.modalSaveSpinner} aria-hidden="true" />
                )}
                <span>{isSaving ? 'Saving…' : isEditing ? 'Save' : 'Create'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>

      <RecurrenceDialog
        isOpen={showRecurrenceDialog}
        onClose={() => setShowRecurrenceDialog(false)}
        onConfirm={handleRecurrenceDialogConfirm}
      />

      <DeleteDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={performDelete}
      />
    </div>
  )
}
