import { type JSX, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { format, parseISO } from 'date-fns'
import { motion, AnimatePresence } from 'framer-motion'
import { useSettingsStore } from '@/store/settingsStore'
import type { CalendarEvent } from '@/types'
import styles from './DayEventsPopup.module.css'

interface DayEventsPopupProps {
  date: Date
  events: CalendarEvent[]
  position: { x: number; y: number }
  onClose: () => void
  onEventClick: (event: CalendarEvent) => void
}

export function DayEventsPopup({
  date,
  events,
  position,
  onClose,
  onEventClick,
}: DayEventsPopupProps): JSX.Element {
  const popupRef = useRef<HTMLDivElement>(null)
  const timeFormat = useSettingsStore((state) => state.timeFormat)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  const formatTime = (dateString: string): string => {
    const pattern = timeFormat === '24h' ? 'HH:mm' : 'h:mm a'
    return format(parseISO(dateString), pattern)
  }

  return createPortal(
    <AnimatePresence>
      <motion.div
        ref={popupRef}
        className={styles.popup}
        style={{ left: position.x, top: position.y }}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.15 }}
      >
        <div className={styles.header}>
          <span className={styles.date}>{format(date, 'EEEE, MMMM d')}</span>
          <span className={styles.count}>
            {events.length} event{events.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className={styles.eventList}>
          {events.map((event) => (
            <div key={event.id} className={styles.eventItem} onClick={() => onEventClick(event)}>
              <div
                className={styles.colorDot}
                style={{ backgroundColor: event.color || '#4285F4' }}
              />
              <div className={styles.eventDetails}>
                <div className={styles.eventTitle}>{event.title}</div>
                <div className={styles.eventTime}>
                  {event.isAllDay
                    ? 'All day'
                    : `${formatTime(event.start)} - ${formatTime(event.end)}`}
                </div>
                {event.location && <div className={styles.eventLocation}>{event.location}</div>}
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}
