import { type JSX, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { formatDisplayDate, formatEventTime } from '@/lib/datetime'
import { motion, AnimatePresence } from 'framer-motion'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { useModalDismiss } from '@/hooks/useModalDismiss'
import { DUR_FAST } from '@/lib/motion'
import { useSettingsStore } from '@/store/settingsStore'
import type { CalendarEvent } from '@/types'
import { LocationLink } from './LocationLink'
import { TaskCollapseToggle } from './TaskCollapseToggle'
import styles from './DayEventsPopup.module.css'

/** Breathing room kept between the popup and the edge of the window. */
const VIEWPORT_MARGIN = 8

/**
 * Keeps the popup inside the window. The caller can only offer the anchor's
 * position — how big the popup ends up is down to how many events the day has
 * — so the real placement is settled here, once the thing has been laid out.
 * A day late in the week opened off the right edge, and a day in the last row
 * of a six-week month ran off the bottom.
 *
 * Measured with `offsetWidth`/`offsetHeight` rather than `getBoundingClientRect`
 * because the popup animates in with a scale transform, which the rect reflects
 * and the layout size doesn't.
 */
function usePlacement(
  popupRef: React.RefObject<HTMLDivElement | null>,
  position: { x: number; y: number }
): { left: number; top: number; maxHeight: number | undefined } {
  const [placement, setPlacement] = useState<{
    left: number
    top: number
    maxHeight: number | undefined
  }>({ left: position.x, top: position.y, maxHeight: undefined })

  const place = useCallback((): void => {
    const popup = popupRef.current
    if (!popup) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    // Cap first: a tall popup that the window can't fit gets to scroll its
    // list instead of hanging off the bottom, and the clamp below then works
    // against the height it will actually have.
    const maxHeight = vh - VIEWPORT_MARGIN * 2
    const height = Math.min(popup.offsetHeight, maxHeight)
    const width = popup.offsetWidth
    const clamp = (value: number, size: number, extent: number): number =>
      Math.max(VIEWPORT_MARGIN, Math.min(value, extent - size - VIEWPORT_MARGIN))

    const next = {
      left: clamp(position.x, width, vw),
      top: clamp(position.y, height, vh),
      maxHeight,
    }
    setPlacement((prev) =>
      prev.left === next.left && prev.top === next.top && prev.maxHeight === next.maxHeight
        ? prev
        : next
    )
  }, [popupRef, position.x, position.y])

  useLayoutEffect(place, [place])

  useEffect(() => {
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [place])

  return placement
}

interface DayEventsPopupProps {
  date: Date
  events: CalendarEvent[]
  position: { x: number; y: number }
  onClose: () => void
  onEventClick: (event: CalendarEvent) => void
  taskHasSubtasks?: (taskId: string) => boolean
  taskIsCollapsed?: (taskId: string) => boolean
  taskDescendantCount?: (taskId: string) => number
  onToggleTaskSubtasks?: (taskId: string) => void
}

export function DayEventsPopup({
  date,
  events,
  position,
  onClose,
  onEventClick,
  taskHasSubtasks,
  taskIsCollapsed,
  taskDescendantCount,
  onToggleTaskSubtasks,
}: DayEventsPopupProps): JSX.Element {
  const { t } = useTranslation('calendar')
  const popupRef = useRef<HTMLDivElement>(null)
  const timeFormat = useSettingsStore((state) => state.timeFormat)
  const prefersReducedMotion = useReducedMotion()
  const dateLabel = formatDisplayDate(date, 'EEEE, MMMM d')
  const placement = usePlacement(popupRef, position)

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
        style={placement}
        data-component="day-events-popup"
        /* The popup is portaled into <body>, but React events still bubble
           along the tree it was declared in — the day cell. So a click on an
           event here also reached the cell's own handler, which opened the
           "new event on this day" modal on top of the one we just asked for,
           blanking it. Stop at the dialog's edge. */
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('modals.dayEvents.ariaLabel', { date: dateLabel })}
        tabIndex={-1}
        initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
        transition={{ duration: prefersReducedMotion ? 0 : DUR_FAST }}
      >
        <div className={styles.header}>
          <span className={styles.date}>{dateLabel}</span>
          <span className={styles.count}>
            {t('modals.dayEvents.eventCount', { count: events.length })}
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
                    ? t('modals.dayEvents.allDay')
                    : `${formatEventTime(event.start, event.timezone, timeFormat)} - ${formatEventTime(event.end, event.timezone, timeFormat)}`}
                </div>
                {event.location && (
                  <div className={styles.eventLocation}>
                    <LocationLink location={event.location} />
                  </div>
                )}
              </div>
              {event.type === 'task' &&
                taskHasSubtasks?.(event.id) &&
                taskIsCollapsed &&
                onToggleTaskSubtasks && (
                  <TaskCollapseToggle
                    taskTitle={event.title}
                    collapsed={taskIsCollapsed(event.id)}
                    hiddenCount={taskDescendantCount?.(event.id)}
                    onToggle={() => onToggleTaskSubtasks(event.id)}
                  />
                )}
            </div>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}
