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

  const [didDrag, setDidDrag] = useState(false)
  const startPos = useRef<{ x: number; y: number } | null>(null)

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

  const handleClick = (): void => {
    if (didDrag) {
      setDidDrag(false)
      return
    }

    if (onClick) {
      onClick(event)
    } else {
      setSelectedEventId(event.id)
      openModal()
    }
  }

  const handlePointerDown = (e: React.PointerEvent): void => {
    startPos.current = { x: e.clientX, y: e.clientY }
    setDidDrag(false)
  }

  const handlePointerMove = (e: React.PointerEvent): void => {
    if (startPos.current) {
      const dx = Math.abs(e.clientX - startPos.current.x)
      const dy = Math.abs(e.clientY - startPos.current.y)
      if (dx > 5 || dy > 5) {
        setDidDrag(true)
      }
    }
  }

  const handlePointerUp = (): void => {
    setTimeout(() => {
      setDidDrag(false)
      startPos.current = null
    }, 50)
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
      className={`${styles.card} ${compact ? styles.compact : ''} ${isCurrentDragging || isDragging ? styles.dragging : ''}`}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
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
    </motion.div>
  )
}
