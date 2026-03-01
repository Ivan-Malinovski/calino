import type { JSX } from 'react'
import { useState, useMemo } from 'react'
import { format, parseISO, addHours } from 'date-fns'
import { v4 as uuidv4 } from 'uuid'
import { useCalendarStore } from '@/store/calendarStore'
import type { CalendarEvent, RecurrenceRule } from '@/types'
import styles from './EventModal.module.css'

const DEFAULT_DURATION_HOURS = 1

const RECURRENCE_OPTIONS: { value: RecurrenceRule['frequency'] | 'none'; label: string }[] = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
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
    isRecurringInstance: false,
    originalEventId: null,
  }
}

export function EventModal(): JSX.Element | null {
  const isModalOpen = useCalendarStore((state) => state.isModalOpen)
  const selectedEventId = useCalendarStore((state) => state.selectedEventId)
  const selectedDate = useCalendarStore((state) => state.selectedDate)
  const selectedEndDate = useCalendarStore((state) => state.selectedEndDate)
  const events = useCalendarStore((state) => state.events)
  const calendars = useCalendarStore((state) => state.calendars)
  const addEvent = useCalendarStore((state) => state.addEvent)
  const updateEvent = useCalendarStore((state) => state.updateEvent)
  const deleteEvent = useCalendarStore((state) => state.deleteEvent)
  const closeModal = useCalendarStore((state) => state.closeModal)

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
  const [calendarId] = useState(initialState.calendarId)
  const [recurrence, setRecurrence] = useState<RecurrenceRule['frequency'] | 'none'>(
    initialState.recurrence
  )
  const [showRecurrenceDialog, setShowRecurrenceDialog] = useState(false)

  const isEditing = selectedEventId !== null
  const isRecurringEvent = initialState.recurrence !== 'none'
  const isRecurringInstance = initialState.isRecurringInstance
  const originalEventId = initialState.originalEventId

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()

    if (isEditing && isRecurringInstance && isRecurringEvent) {
      setShowRecurrenceDialog(true)
      return
    }

    saveEvent('all')
  }

  const saveEvent = (mode: RecurrenceEditMode): void => {
    const startDateTime = isAllDay ? `${startDate}T00:00:00` : `${startDate}T${startTime}:00`
    const endDateTime = isAllDay ? `${endDate}T23:59:59` : `${endDate}T${endTime}:00`

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
        }
        addEvent(newEvent)
      } else {
        updateEvent(originalEventId || selectedEventId, {
          title,
          description: description || undefined,
          location: location || undefined,
          start: startDateTime,
          end: endDateTime,
          isAllDay,
          calendarId,
          recurrence: recurrenceRule,
        })
      }
    } else {
      const newEvent: CalendarEvent = {
        id: uuidv4(),
        title,
        description: description || undefined,
        location: location || undefined,
        start: startDateTime,
        end: endDateTime,
        isAllDay,
        calendarId,
        recurrence: recurrenceRule,
      }
      addEvent(newEvent)
    }

    setShowRecurrenceDialog(false)
    closeModal()
  }

  const handleRecurrenceDialogConfirm = (mode: RecurrenceEditMode): void => {
    saveEvent(mode)
  }

  const handleDelete = (): void => {
    if (selectedEventId) {
      deleteEvent(selectedEventId)
      closeModal()
    }
  }

  if (!isModalOpen) {
    return null
  }

  return (
    <div className={styles.overlay} onClick={closeModal}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>{isEditing ? 'Edit event' : 'Create event'}</h2>
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
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <input
              type="text"
              placeholder="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={styles.input}
              required
            />
          </div>

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

          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label}>Start</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={styles.input}
                required
              />
            </div>
            {!isAllDay && (
              <div className={styles.field}>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className={styles.input}
                  required
                />
              </div>
            )}
          </div>

          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label}>End</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={styles.input}
                required
              />
            </div>
            {!isAllDay && (
              <div className={styles.field}>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className={styles.input}
                  required
                />
              </div>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Repeat</label>
            <select
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
            <input
              type="text"
              placeholder="Location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className={styles.input}
            />
          </div>

          <div className={styles.field}>
            <textarea
              placeholder="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={styles.textarea}
              rows={3}
            />
          </div>

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
    </div>
  )
}
