import { type JSX, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { format } from 'date-fns'
import { formatTime } from '@/lib/datetime'
import { motion, AnimatePresence } from 'framer-motion'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { useModalDismiss } from '@/hooks/useModalDismiss'
import { DUR_FAST } from '@/lib/motion'
import { useSettingsStore } from '@/store/settingsStore'
import type { CalendarEvent } from '@/types'
import { LocationLink } from './LocationLink'
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
  const prefersReducedMotion = useReducedMotion()
  const dateLabel = format(date, 'EEEE, MMMM d')

  // Focus trap + Escape + focus restore, shared with every other dialog.
  useModalDismiss(popupRef, true, onClose)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  return createPortal(
    <AnimatePresence>
      <motion.div
        ref={popupRef}
        className={styles.popup}
        style={{ left: position.x, top: position.y }}
        role="dialog"
        aria-modal="true"
        aria-label={`Events for ${dateLabel}`}
        tabIndex={-1}
        initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
        transition={{ duration: prefersReducedMotion ? 0 : DUR_FAST }}
      >
        <div className={styles.header}>
          <span className={styles.date}>{format(date, 'EEEE, MMMM d')}</span>
          <span className={styles.count}>
            {events.length} event{events.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className={styles.eventList}>
          {events.map((event) => (
            <div
              key={event.id}
              className={styles.eventItem}
              role="button"
              tabIndex={0}
              onClick={() => onEventClick(event)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onEventClick(event)
                }
              }}
            >
              <div
                className={styles.colorDot}
                style={{ backgroundColor: event.color || 'var(--color-accent)' }}
              />
              <div className={styles.eventDetails}>
                <div className={styles.eventTitle}>{event.title}</div>
                <div className={styles.eventTime}>
                  {event.isAllDay
                    ? 'All day'
                    : `${formatTime(event.start, timeFormat)} - ${formatTime(event.end, timeFormat)}`}
                </div>
                {event.location && (
                  <div className={styles.eventLocation}>
                    <LocationLink location={event.location} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}
