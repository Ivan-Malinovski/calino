import { type JSX, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { format, parseISO } from 'date-fns'
import { motion, AnimatePresence } from 'framer-motion'
import { useSettingsStore } from '@/store/settingsStore'
import { useCalendarStore } from '@/store/calendarStore'
import type { CalendarEvent } from '@/types'
import styles from './EventPreviewPopup.module.css'

interface EventPreviewPopupProps {
  event: CalendarEvent
  position: { x: number; y: number }
  clickedEventId: string
}

function extractOriginalEventId(eventId: string): string | null {
  const isoDateMatch = eventId.match(/(.+)-(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)$/)
  if (isoDateMatch) {
    return isoDateMatch[1]
  }
  return null
}

export function EventPreviewPopup({
  event,
  position,
  clickedEventId,
}: EventPreviewPopupProps): JSX.Element {
  const popupRef = useRef<HTMLDivElement>(null)
  const timeFormat = useSettingsStore((state) => state.timeFormat)
  const dateFormat = useSettingsStore((state) => state.dateFormat)
  const openModal = useCalendarStore((state) => state.openModal)
  const closePreview = useCalendarStore((state) => state.closePreview)
  const deleteEvent = useCalendarStore((state) => state.deleteEvent)
  const originalEventId = extractOriginalEventId(clickedEventId)

  const isTask = event.type === 'task'
  const timeFormatPattern = timeFormat === '24h' ? 'HH:mm' : 'h:mm a'
  const dateFormatPattern =
    dateFormat === 'MM/dd/yyyy'
      ? 'MMM d, yyyy'
      : dateFormat === 'dd/MM/yyyy'
        ? 'd MMM yyyy'
        : 'yyyy-MM-dd'

  const getEventDate = (): string => {
    if (isTask && event.dueDate) {
      return format(parseISO(event.dueDate), dateFormatPattern)
    }
    return format(parseISO(event.start), dateFormatPattern)
  }

  const getEventTime = (): string => {
    if (isTask) {
      if (event.isAllDay || !event.dueDate) {
        return event.dueDate ? format(parseISO(event.dueDate), dateFormatPattern) : 'No due date'
      }
      return format(parseISO(event.dueDate), timeFormatPattern)
    }
    if (event.isAllDay) {
      return 'All day'
    }
    return `${format(parseISO(event.start), timeFormatPattern)} - ${format(parseISO(event.end), timeFormatPattern)}`
  }

  const handleOpen = (): void => {
    closePreview()
    if (originalEventId) {
      openModal(undefined, undefined, originalEventId)
    } else {
      openModal(undefined, undefined, event.id)
    }
  }

  const handleDelete = (): void => {
    const idToDelete = originalEventId || event.id
    deleteEvent(idToDelete)
    closePreview()
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
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closePreview()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [closePreview])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        closePreview()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [closePreview])

  useEffect(() => {
    const handleContextMenu = (): void => {
      closePreview()
    }
    document.addEventListener('contextmenu', handleContextMenu)
    return () => document.removeEventListener('contextmenu', handleContextMenu)
  }, [closePreview])

  return createPortal(
    <AnimatePresence>
      <motion.div
        ref={popupRef}
        className={styles.popup}
        style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.15 }}
      >
        <div className={styles.header}>
          <div className={styles.titleRow}>
            <div
              className={styles.colorDot}
              style={{ backgroundColor: event.color || '#4285F4' }}
            />
            <span className={styles.title}>{event.title}</span>
          </div>
          <button className={styles.closeBtn} onClick={closePreview} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
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
            <svg className={styles.icon} width="14" height="14" viewBox="0 0 14 14" fill="none">
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
            <span>{getEventDate()}</span>
          </div>

          <div className={styles.field}>
            <svg className={styles.icon} width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" />
              <path d="M7 4V7L9 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <span>{getEventTime()}</span>
          </div>

          {event.location && (
            <div className={styles.field}>
              <svg className={styles.icon} width="14" height="14" viewBox="0 0 14 14" fill="none">
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
              <span className={styles.location}>{event.location}</span>
            </div>
          )}

          {(event.recurrence || event.rruleString) && (
            <div className={styles.field}>
              <svg className={styles.icon} width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M11 5.5C11 7.433 9.433 9 7.5 9C5.567 9 4 7.433 4 5.5C4 3.567 5.567 2 7.5 2"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
                <path
                  d="M7.5 2V4.5L9.5 5.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <rect x="1" y="10" width="12" height="2" rx="1" fill="currentColor" />
              </svg>
              <span>Recurring event</span>
            </div>
          )}

          {event.travelDuration !== undefined && event.travelDuration > 0 && (
            <div className={styles.field}>
              <svg className={styles.icon} width="14" height="14" viewBox="0 0 14 14" fill="none">
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

          {isTask && event.priority !== undefined && event.priority > 0 && (
            <div className={styles.field}>
              <svg className={styles.icon} width="14" height="14" viewBox="0 0 14 14" fill="none">
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
              <svg className={styles.icon} width="14" height="14" viewBox="0 0 14 14" fill="none">
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

          {event.description && (
            <div className={styles.description}>
              <div className={styles.descriptionLabel}>Description</div>
              <div className={styles.descriptionText}>{event.description}</div>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <button className={styles.openBtn} onClick={handleOpen}>
            {isTask ? 'Open task' : 'Open event'}
          </button>
          <button className={styles.deleteBtn} onClick={handleDelete} aria-label="Delete">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
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
    </AnimatePresence>,
    document.body
  )
}
