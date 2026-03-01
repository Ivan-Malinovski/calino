import type { JSX } from 'react'
import { useState, useRef } from 'react'
import { format, parseISO } from 'date-fns'
import { motion } from 'framer-motion'
import { useDraggable } from '@dnd-kit/core'
import { useCalendarStore } from '@/store/calendarStore'
import type { CalendarEvent } from '@/types'
import styles from './EventCard.module.css'

interface EventCardProps {
  event: CalendarEvent
  onClick?: (event: CalendarEvent) => void
  compact?: boolean
  isDragging?: boolean
}

export function EventCard({
  event,
  onClick,
  compact = false,
  isDragging = false,
}: EventCardProps): JSX.Element {
  const calendars = useCalendarStore((state) => state.calendars)
  const setSelectedEventId = useCalendarStore((state) => state.setSelectedEventId)
  const openModal = useCalendarStore((state) => state.openModal)
  const updateEvent = useCalendarStore((state) => state.updateEvent)

  const [isResizing, setIsResizing] = useState(false)
  const resizeStartY = useRef<number | null>(null)
  const resizeStartEnd = useRef<Date | null>(null)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging: isCurrentDragging,
  } = useDraggable({
    id: event.id,
  })

  const calendar = calendars.find((c) => c.id === event.calendarId)
  const eventColor = event.color || calendar?.color || '#4285F4'

  const handleClick = (e: React.MouseEvent): void => {
    if (isCurrentDragging || isResizing) {
      e.stopPropagation()
      return
    }
    if (onClick) {
      onClick(event)
    } else {
      setSelectedEventId(event.id)
      openModal()
    }
  }

  const handleResizeStart = (e: React.PointerEvent): void => {
    e.stopPropagation()
    e.preventDefault()
    setIsResizing(true)
    resizeStartY.current = e.clientY
    resizeStartEnd.current = parseISO(event.end)

    const handleResizeMove = (moveEvent: PointerEvent): void => {
      if (resizeStartY.current === null || resizeStartEnd.current === null) return

      const deltaY = moveEvent.clientY - resizeStartY.current
      const deltaMinutes = Math.round((deltaY / 60) * 60)
      const newEnd = new Date(resizeStartEnd.current.getTime() + deltaMinutes * 60 * 1000)

      if (newEnd > parseISO(event.start)) {
        updateEvent(event.id, { end: newEnd.toISOString() })
      }
    }

    const handleResizeEnd = (): void => {
      setIsResizing(false)
      resizeStartY.current = null
      resizeStartEnd.current = null
      document.removeEventListener('pointermove', handleResizeMove)
      document.removeEventListener('pointerup', handleResizeEnd)
    }

    document.addEventListener('pointermove', handleResizeMove)
    document.addEventListener('pointerup', handleResizeEnd)
  }

  const formatTime = (dateString: string): string => {
    return format(parseISO(dateString), 'h:mm a')
  }

  const style = transform
    ? {
        backgroundColor: `${eventColor}20`,
        borderLeftColor: eventColor,
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        cursor: 'grabbing',
        zIndex: 1000,
      }
    : {
        backgroundColor: `${eventColor}20`,
        borderLeftColor: eventColor,
        cursor: 'grab',
      }

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      className={`${styles.card} ${compact ? styles.compact : ''} ${isCurrentDragging || isDragging ? styles.dragging : ''} ${isResizing ? styles.resizing : ''}`}
      onClick={handleClick}
      onPointerDown={(e) => e.stopPropagation()}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: isCurrentDragging ? 0.5 : 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.2 }}
      layout
      {...listeners}
      {...attributes}
    >
      <div className={styles.title}>{event.title}</div>
      {!compact && !event.isAllDay && (
        <div className={styles.time}>
          {formatTime(event.start)} - {formatTime(event.end)}
        </div>
      )}
      {event.isAllDay && <div className={styles.time}>All day</div>}
      {event.location && <div className={styles.location}>{event.location}</div>}
      {!compact && <div className={styles.resizeHandle} onPointerDown={handleResizeStart} />}
    </motion.div>
  )
}
