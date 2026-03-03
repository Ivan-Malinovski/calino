import type { JSX } from 'react'
import { useState, useMemo, useEffect, useRef } from 'react'
import { format, parseISO, addHours } from 'date-fns'
import { v4 as uuidv4 } from 'uuid'
import { useCalendarStore } from '@/store/calendarStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import type { CalendarEvent, RecurrenceRule, TaskPriority } from '@/types'
import styles from './EventModal.module.css'

const DEFAULT_DURATION_HOURS = 1

const TRAVEL_DURATION_OPTIONS: { value: number | undefined; label: string }[] = [
  { value: undefined, label: 'None' },
  { value: 5, label: '5 min' },
  { value: 10, label: '10 min' },
  { value: 15, label: '15 min' },
  { value: 20, label: '20 min' },
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '1 hour' },
  { value: 90, label: '1.5 hours' },
  { value: 120, label: '2 hours' },
]

const RECURRENCE_OPTIONS: { value: RecurrenceRule['frequency'] | 'none'; label: string }[] = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
]

const PRIORITY_OPTIONS: { value: TaskPriority | undefined; label: string }[] = [
  { value: undefined, label: 'None' },
  { value: 1, label: 'High' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'Low' },
]

type RecurrenceEditMode = 'all' | 'future' | 'this'

function extractOriginalEventId(eventId: string): string | null {
  const isoDateMatch = eventId.match(/(.+)-(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)$/)
  if (isoDateMatch) {
    return isoDateMatch[1]
  }
  return null
}

interface InitialFormState {
  title: string
  description: string
  location: string
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  isAllDay: boolean
  calendarId: string
  recurrence: RecurrenceRule['frequency'] | 'none'
  travelDuration: number | undefined
}

function getInitialFormState(
  isModalOpen: boolean,
  selectedEventId: string | null,
  selectedDate: string | null,
  selectedEndDate: string | null,
  events: CalendarEvent[],
  calendars: { id: string; isDefault: boolean }[]
): InitialFormState & { isRecurringInstance: boolean; originalEventId: string | null } {
  const defaultCalendar = calendars.find((c) => c.isDefault) || calendars[0]

  const isEditing = selectedEventId !== null

  let existingEvent: CalendarEvent | undefined
  let isRecurringInstance = false
  let originalEventId: string | null = null

  if (isEditing && selectedEventId) {
    existingEvent = events.find((e) => e.id === selectedEventId)

    if (!existingEvent) {
      const originalId = extractOriginalEventId(selectedEventId)
      if (originalId) {
        existingEvent = events.find((e) => e.id === originalId)
        if (existingEvent) {
          isRecurringInstance = true
          originalEventId = originalId
        }
      }
    }
  }

  if (isModalOpen) {
    if (existingEvent) {
      return {
        title: existingEvent.title,
        description: existingEvent.description || '',
        location: existingEvent.location || '',
        startDate: format(parseISO(existingEvent.start), 'yyyy-MM-dd'),
        startTime: format(parseISO(existingEvent.start), 'HH:mm'),
        endDate: format(parseISO(existingEvent.end), 'yyyy-MM-dd'),
        endTime: format(parseISO(existingEvent.end), 'HH:mm'),
        isAllDay: existingEvent.isAllDay,
        calendarId: existingEvent.calendarId,
        recurrence: existingEvent.recurrence?.frequency || 'none',
        travelDuration: existingEvent.travelDuration,
        isRecurringInstance,
        originalEventId,
      }
    }

    if (selectedDate) {
      const dateStr = selectedDate.includes('T') ? selectedDate.split('T')[0] : selectedDate
      let startTimeVal = '09:00'
      let endTimeVal = '10:00'

      if (selectedDate.includes('T')) {
        const time = selectedDate.split('T')[1]
        startTimeVal = time
        const parsedTime = parseISO(`2000-01-01T${time}`)
        endTimeVal = format(addHours(parsedTime, DEFAULT_DURATION_HOURS), 'HH:mm')
      }

      if (selectedEndDate && selectedEndDate.includes('T')) {
        const endTime = selectedEndDate.split('T')[1]
        const endDatePart = selectedEndDate.split('T')[0]
        endTimeVal = endTime
        if (endDatePart !== dateStr) {
          return {
            title: '',
            description: '',
            location: '',
            startDate: dateStr,
            startTime: startTimeVal,
            endDate: endDatePart,
            endTime: endTimeVal,
            isAllDay: false,
            calendarId: defaultCalendar?.id || '',
            recurrence: 'none',
            travelDuration: undefined,
            isRecurringInstance: false,
            originalEventId: null,
          }
        }
      }

      return {
        title: '',
        description: '',
        location: '',
        startDate: dateStr,
        startTime: startTimeVal,
        endDate: dateStr,
        endTime: endTimeVal,
        isAllDay: false,
        calendarId: defaultCalendar?.id || '',
        recurrence: 'none',
        travelDuration: undefined,
        isRecurringInstance: false,
        originalEventId: null,
      }
    }
  }

  const today = format(new Date(), 'yyyy-MM-dd')
  return {
    title: '',
    description: '',
    location: '',
    startDate: today,
    startTime: '09:00',
    endDate: today,
    endTime: '10:00',
    isAllDay: false,
    calendarId: defaultCalendar?.id || '',
    recurrence: 'none',
    travelDuration: undefined,
    isRecurringInstance: false,
    originalEventId: null,
  }
}

export function EventModal(): JSX.Element | null {
  const isModalOpen = useCalendarStore((state) => state.isModalOpen)
  const selectedEventId = useCalendarStore((state) => state.selectedEventId)
  const selectedDate = useCalendarStore((state) => state.selectedDate)
  const selectedEndDate = useCalendarStore((state) => state.selectedEndDate)
  const selectedEventType = useCalendarStore((state) => state.selectedEventType)
  const events = useCalendarStore((state) => state.events)
  const calendars = useCalendarStore((state) => state.calendars)
  const addEvent = useCalendarStore((state) => state.addEvent)
  const updateEvent = useCalendarStore((state) => state.updateEvent)
  const deleteEvent = useCalendarStore((state) => state.deleteEvent)
  const closeModal = useCalendarStore((state) => state.closeModal)
  const {
    createEvent: createCalDAVEvent,
    updateEvent: updateCalDAVEvent,
    deleteEvent: deleteCalDAVEvent,
  } = useCalDAV()

  const initialState = useMemo(
    () =>
      getInitialFormState(
        isModalOpen,
        selectedEventId,
        selectedDate,
        selectedEndDate,
        events,
        calendars
      ),
    [isModalOpen, selectedEventId, selectedDate, selectedEndDate, events, calendars]
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
  const [recurrence, setRecurrence] = useState<RecurrenceRule['frequency'] | 'none'>(
    initialState.recurrence
  )
  const [travelDuration, setTravelDuration] = useState<number | undefined>(
    initialState.travelDuration
  )
  const [showRecurrenceDialog, setShowRecurrenceDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showDescription, setShowDescription] = useState(!!initialState.description)
  const [dueDate, setDueDate] = useState<string>('')
  const [dueTime, setDueTime] = useState<string>('09:00')
  const [dueAllDay, setDueAllDay] = useState(true)
  const [completed, setCompleted] = useState(false)
  const [priority, setPriority] = useState<TaskPriority | undefined>(undefined)

  const lastSelectedEventId = useRef<string | null>(null)
  const lastSelectedDate = useRef<string | null>(null)

  useEffect(() => {
    if (
      selectedEventId !== lastSelectedEventId.current ||
      selectedDate !== lastSelectedDate.current
    ) {
      lastSelectedEventId.current = selectedEventId
      lastSelectedDate.current = selectedDate
      setTitle(initialState.title)
      setDescription(initialState.description)
      setLocation(initialState.location)
      setStartDate(initialState.startDate)
      setStartTime(initialState.startTime)
      setEndDate(initialState.endDate)
      setEndTime(initialState.endTime)
      setIsAllDay(initialState.isAllDay)
      setCalendarId(initialState.calendarId)
      setRecurrence(initialState.recurrence)
      setTravelDuration(initialState.travelDuration)
      setShowDescription(!!initialState.description)

      const existingEvent = selectedEventId
        ? events.find((e) => e.id === selectedEventId)
        : undefined
      if (existingEvent?.type === 'task') {
        const taskDueDate =
          existingEvent.dueDate || format(parseISO(existingEvent.start), 'yyyy-MM-dd')
        setDueDate(taskDueDate)
        const taskTime = format(parseISO(existingEvent.start), 'HH:mm')
        setDueTime(taskTime !== '00:00' ? taskTime : '09:00')
        setDueAllDay(existingEvent.isAllDay ?? true)
        setCompleted(existingEvent.completed || false)
        setPriority(existingEvent.priority)
      } else if (selectedEventType === 'task') {
        setDueDate(selectedDate || format(new Date(), 'yyyy-MM-dd'))
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
  }, [selectedEventId, selectedDate, initialState, events, selectedEventType])

  const isEditing = selectedEventId !== null
  const isRecurringEvent = initialState.recurrence !== 'none'
  const isRecurringInstance = initialState.isRecurringInstance
  const originalEventId = initialState.originalEventId
  const existingEventForMode = selectedEventId
    ? events.find((e) => e.id === selectedEventId)
    : undefined
  const eventType = existingEventForMode?.type
  const isTaskMode = selectedEventType === 'task' || eventType === 'task'

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()

    if (isEditing && isRecurringInstance && isRecurringEvent) {
      setShowRecurrenceDialog(true)
      return
    }

    saveEvent('all')
  }

  const saveEvent = async (mode: RecurrenceEditMode): Promise<void> => {
    const localStart = isAllDay ? `${startDate}T00:00:00` : `${startDate}T${startTime}:00`
    const localEnd = isAllDay ? `${endDate}T23:59:59` : `${endDate}T${endTime}:00`
    const startDateTime = new Date(localStart).toISOString()
    const endDateTime = new Date(localEnd).toISOString()

    const recurrenceRule: RecurrenceRule | undefined =
      recurrence !== 'none' ? { frequency: recurrence, interval: 1 } : undefined

    if (isEditing && selectedEventId) {
      if (mode === 'this' && originalEventId) {
        const newEvent: CalendarEvent = {
          id: uuidv4(),
          title,
          description: description || undefined,
          location: location || undefined,
          start: startDateTime,
          end: endDateTime,
          isAllDay,
          calendarId,
          recurrence: undefined,
          travelDuration,
        }
        addEvent(newEvent)
        try {
          await createCalDAVEvent(calendarId, newEvent)
        } catch {
          // error already handled by useCalDAV
        }
      } else {
        const eventId = originalEventId || selectedEventId
        const taskTime = dueAllDay ? '00:00:00' : `${dueTime}:00`
        const taskEndTime = dueAllDay ? '23:59:59' : `${dueTime}:00`
        const eventStart = isTaskMode && dueDate ? `${dueDate}T${taskTime}` : startDateTime
        const eventEnd = isTaskMode && dueDate ? `${dueDate}T${taskEndTime}` : endDateTime
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
          dueDate: isTaskMode ? dueDate : undefined,
          completed: isTaskMode ? completed : undefined,
          priority: isTaskMode ? priority : undefined,
        })
        const existingEvent = events.find((e) => e.id === eventId)
        if (existingEvent) {
          try {
            await updateCalDAVEvent(calendarId, {
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
              dueDate: isTaskMode ? dueDate : undefined,
              completed: isTaskMode ? completed : undefined,
              priority: isTaskMode ? priority : undefined,
            })
          } catch {
            // error already handled by useCalDAV
          }
        }
      }
    } else {
      const taskTime = dueAllDay ? '00:00:00' : `${dueTime}:00`
      const taskEndTime = dueAllDay ? '23:59:59' : `${dueTime}:00`
      const eventStart = isTaskMode && dueDate ? `${dueDate}T${taskTime}` : startDateTime
      const eventEnd = isTaskMode && dueDate ? `${dueDate}T${taskEndTime}` : endDateTime

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
        dueDate: isTaskMode ? dueDate : undefined,
        completed: isTaskMode ? completed : undefined,
        priority: isTaskMode ? priority : undefined,
      }
      addEvent(newEvent)
      try {
        await createCalDAVEvent(calendarId, newEvent)
      } catch {
        // error already handled by useCalDAV
      }
    }

    setShowRecurrenceDialog(false)
    closeModal()
  }

  const handleRecurrenceDialogConfirm = async (mode: RecurrenceEditMode): Promise<void> => {
    await saveEvent(mode)
  }

  const handleDelete = (): void => {
    if (isRecurringInstance && isRecurringEvent) {
      setShowDeleteDialog(true)
      return
    }

    performDelete('all')
  }

  const performDelete = async (mode: RecurrenceEditMode): Promise<void> => {
    if (mode === 'this' && originalEventId) {
      const newEvent: CalendarEvent = {
        id: uuidv4(),
        title: `${title} (exception)`,
        description: description || undefined,
        location: location || undefined,
        start: startDate && startTime ? `${startDate}T${startTime}:00` : `${startDate}T00:00:00`,
        end: endDate && endTime ? `${endDate}T${endTime}:00` : `${endDate}T23:59:59`,
        isAllDay,
        calendarId,
        recurrence: undefined,
        travelDuration,
      }
      deleteEvent(originalEventId)
      addEvent(newEvent)
      try {
        await deleteCalDAVEvent(calendarId, originalEventId)
        await createCalDAVEvent(calendarId, newEvent)
      } catch {
        // error already handled by useCalDAV
      }
    } else {
      const eventIdToDelete = originalEventId || selectedEventId
      if (eventIdToDelete) {
        deleteEvent(eventIdToDelete)
        try {
          await deleteCalDAVEvent(calendarId, eventIdToDelete)
        } catch {
          // error already handled by useCalDAV
        }
      }
    }
    setShowDeleteDialog(false)
    closeModal()
  }

  if (!isModalOpen) {
    return null
  }

  return (
    <div className={styles.overlay} onClick={closeModal}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>
            {isEditing
              ? isTaskMode
                ? 'Edit task'
                : 'Edit event'
              : isTaskMode
                ? 'Create task'
                : 'Create event'}
          </h2>
          <button className={styles.closeButton} onClick={closeModal}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path
                d="M18 6L6 18M6 6L18 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <form
          key={`${selectedEventId}-${selectedDate}`}
          onSubmit={handleSubmit}
          className={styles.form}
        >
          <div className={styles.field}>
            <input
              type="text"
              placeholder="Add title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={styles.titleInput}
              required
            />
          </div>

          {isTaskMode && (
            <>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={completed}
                      onChange={(e) => setCompleted(e.target.checked)}
                    />
                    <span>Completed</span>
                  </label>
                </div>

                <div className={styles.field}>
                  <label className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={dueAllDay}
                      onChange={(e) => setDueAllDay(e.target.checked)}
                    />
                    <span>Only due date</span>
                  </label>
                </div>
              </div>

              <div className={styles.row}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="due-date">
                    Due date
                  </label>
                  <input
                    type="date"
                    id="due-date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className={styles.input}
                    required={isTaskMode}
                  />
                </div>

                {!dueAllDay && (
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="due-time">
                      Due time
                    </label>
                    <input
                      type="time"
                      id="due-time"
                      value={dueTime}
                      onChange={(e) => setDueTime(e.target.value)}
                      className={styles.input}
                    />
                  </div>
                )}

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="priority-select">
                    Priority
                  </label>
                  <select
                    id="priority-select"
                    value={priority ?? ''}
                    onChange={(e) =>
                      setPriority(
                        e.target.value ? (Number(e.target.value) as TaskPriority) : undefined
                      )
                    }
                    className={styles.select}
                  >
                    {PRIORITY_OPTIONS.map((option) => (
                      <option key={option.label} value={option.value ?? ''}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}

          {!isTaskMode && (
            <div className={styles.field}>
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={isAllDay}
                  onChange={(e) => setIsAllDay(e.target.checked)}
                />
                <span>All day</span>
              </label>
            </div>
          )}

          {!isTaskMode && (
            <div className={styles.dateTimeRow}>
              <div className={styles.dateTimeGroup}>
                <label className={styles.label}>Start</label>
                <div className={styles.dateTimeInputs}>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value)
                      if (endDate && e.target.value > endDate) {
                        setEndDate(e.target.value)
                      }
                    }}
                    className={styles.input}
                    required
                  />
                  {!isAllDay && (
                    <input
                      type="time"
                      value={startTime}
                      onChange={(e) => {
                        setStartTime(e.target.value)
                        if (startDate === endDate && e.target.value > endTime) {
                          setEndTime(e.target.value)
                        }
                      }}
                      className={styles.input}
                      required
                    />
                  )}
                </div>
              </div>

              <div className={styles.dateTimeGroup}>
                <label className={styles.label}>End</label>
                <div className={styles.dateTimeInputs}>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className={styles.input}
                    required
                  />
                  {!isAllDay && (
                    <input
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className={styles.input}
                      required
                    />
                  )}
                </div>
              </div>
            </div>
          )}

          {!isTaskMode && (
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="recurrence-select">
                  Repeat
                </label>
                <select
                  id="recurrence-select"
                  value={recurrence}
                  onChange={(e) =>
                    setRecurrence(e.target.value as RecurrenceRule['frequency'] | 'none')
                  }
                  className={styles.select}
                >
                  {RECURRENCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="travel-duration-select">
                  Travel time
                </label>
                <select
                  id="travel-duration-select"
                  value={travelDuration ?? ''}
                  onChange={(e) =>
                    setTravelDuration(e.target.value ? Number(e.target.value) : undefined)
                  }
                  className={styles.select}
                >
                  {TRAVEL_DURATION_OPTIONS.map((option) => (
                    <option key={option.label} value={option.value ?? ''}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className={styles.row}>
            <div className={styles.field}>
              <input
                type="text"
                placeholder="Location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className={styles.input}
              />
            </div>

            <div className={styles.field}>
              <select
                id="calendar-select"
                value={calendarId}
                onChange={(e) => setCalendarId(e.target.value)}
                className={styles.select}
              >
                {calendars.map((cal) => (
                  <option key={cal.id} value={cal.id}>
                    {cal.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {!showDescription ? (
            <button
              type="button"
              className={styles.addButton}
              onClick={() => setShowDescription(true)}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add description
            </button>
          ) : (
            <div className={styles.field}>
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
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <textarea
                placeholder="Add description..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={styles.textarea}
                rows={3}
              />
            </div>
          )}

          <div className={styles.footer}>
            {isEditing && (
              <button type="button" className={styles.deleteButton} onClick={handleDelete}>
                Delete
              </button>
            )}
            <div className={styles.actions}>
              <button type="button" className={styles.cancelButton} onClick={closeModal}>
                Cancel
              </button>
              <button type="submit" className={styles.saveButton}>
                {isEditing ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        </form>
      </div>

      {showRecurrenceDialog && (
        <div className={styles.overlay} onClick={() => setShowRecurrenceDialog(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.header}>
              <h2 className={styles.title}>Update recurring event</h2>
              <button className={styles.closeButton} onClick={() => setShowRecurrenceDialog(false)}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M18 6L6 18M6 6L18 18"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
            <div className={styles.form}>
              <p style={{ padding: '16px', color: '#666' }}>
                How would you like to apply these changes?
              </p>
              <div className={styles.field} style={{ padding: '0 16px 16px' }}>
                <button
                  type="button"
                  className={styles.saveButton}
                  style={{ width: '100%', marginBottom: '8px' }}
                  onClick={() => handleRecurrenceDialogConfirm('all')}
                >
                  All events
                </button>
                <button
                  type="button"
                  className={styles.saveButton}
                  style={{ width: '100%', marginBottom: '8px' }}
                  onClick={() => handleRecurrenceDialogConfirm('this')}
                >
                  This event only
                </button>
                <button
                  type="button"
                  className={styles.cancelButton}
                  style={{ width: '100%' }}
                  onClick={() => setShowRecurrenceDialog(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDeleteDialog && (
        <div className={styles.overlay} onClick={() => setShowDeleteDialog(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.header}>
              <h2 className={styles.title}>Delete recurring event</h2>
              <button className={styles.closeButton} onClick={() => setShowDeleteDialog(false)}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M18 6L6 18M6 6L18 18"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
            <div className={styles.form}>
              <p style={{ padding: '16px', color: '#666' }}>
                How would you like to delete this event?
              </p>
              <div className={styles.field} style={{ padding: '0 16px 16px' }}>
                <button
                  type="button"
                  className={styles.deleteButton}
                  style={{ width: '100%', marginBottom: '8px' }}
                  onClick={() => performDelete('all')}
                >
                  All events
                </button>
                <button
                  type="button"
                  className={styles.deleteButton}
                  style={{ width: '100%', marginBottom: '8px' }}
                  onClick={() => performDelete('this')}
                >
                  This event only
                </button>
                <button
                  type="button"
                  className={styles.cancelButton}
                  style={{ width: '100%' }}
                  onClick={() => setShowDeleteDialog(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
