import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { format, eachHourOfInterval, startOfDay, endOfDay, parseISO, isToday } from 'date-fns'
import { useCalendarStore } from '@/store/calendarStore'
import { EventCard } from './EventCard'
import type { CalendarEvent } from '@/types'
import styles from './DayView.module.css'

const HOURS = eachHourOfInterval({
  start: startOfDay(new Date()),
  end: endOfDay(new Date()),
})

interface DroppableCellProps {
  hour: Date
  events: CalendarEvent[]
  onClick: () => void
}

function DroppableCell({ hour, events, onClick }: DroppableCellProps): JSX.Element {
  const droppableId = `${format(hour, 'yyyy-MM-dd')}-${format(hour, 'HH:mm')}`
  const { setNodeRef, isOver } = useDroppable({ id: droppableId })

  return (
    <div
      ref={setNodeRef}
      className={`${styles.cell} ${isOver ? styles.dropTarget : ''}`}
      onClick={onClick}
    >
      {events.map((event) => (
        <EventCard key={event.id} event={event} />
      ))}
    </div>
  )
}

export function DayView(): JSX.Element {
  const currentDate = useCalendarStore((state) => state.currentDate)
  const events = useCalendarStore((state) => state.events)
  const calendars = useCalendarStore((state) => state.calendars)
  const getEventsForDateRange = useCalendarStore((state) => state.getEventsForDateRange)
  const openModal = useCalendarStore((state) => state.openModal)
  const updateEvent = useCalendarStore((state) => state.updateEvent)

  const [activeEvent, setActiveEvent] = useState<CalendarEvent | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  )

  const date = parseISO(currentDate)

  const dayEvents = useMemo(() => {
    return getEventsForDateRange(format(date, 'yyyy-MM-dd'), format(date, 'yyyy-MM-dd'))
  }, [date, events, calendars, getEventsForDateRange])

  const handleCellClick = (hour: Date): void => {
    const hourStr = format(hour, 'HH:mm')
    openModal(`${format(date, 'yyyy-MM-dd')}T${hourStr}`)
  }

  const getEventsForHour = (hour: Date): CalendarEvent[] => {
    const hourStart = hour.getHours()
    return dayEvents.filter((event) => {
      const eventHour = parseISO(event.start).getHours()
      return eventHour === hourStart
    })
  }

  const handleDragStart = (event: DragStartEvent): void => {
    const eventId = event.active.id as string
    const draggedEvent = events.find((e) => e.id === eventId)
    setActiveEvent(draggedEvent || null)
  }

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    setActiveEvent(null)

    if (!over) return

    const [dayStr, hourStr] = (over.id as string).split('-')
    if (!dayStr || !hourStr) return

    const newStart = parseISO(`${dayStr}T${hourStr}`)
    const originalEvent = events.find((e) => e.id === active.id)
    if (!originalEvent) return

    const originalStart = parseISO(originalEvent.start)
    const originalEnd = parseISO(originalEvent.end)
    const durationMs = originalEnd.getTime() - originalStart.getTime()
    const newEnd = new Date(newStart.getTime() + durationMs)

    updateEvent(active.id as string, {
      start: newStart.toISOString(),
      end: newEnd.toISOString(),
    })
  }

  const isCurrentDay = isToday(date)

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.dayInfo}>
            <div className={styles.dayName}>{format(date, 'EEEE')}</div>
            <div className={`${styles.dayNumber} ${isCurrentDay ? styles.today : ''}`}>
              {format(date, 'd')}
            </div>
          </div>
        </div>
        <div className={styles.body}>
          {HOURS.map((hour) => (
            <div key={hour.toISOString()} className={styles.hourRow}>
              <div className={styles.timeLabel}>{format(hour, 'h a')}</div>
              <DroppableCell
                hour={hour}
                events={getEventsForHour(hour)}
                onClick={() => handleCellClick(hour)}
              />
            </div>
          ))}
        </div>
      </div>
      <DragOverlay>{activeEvent ? <EventCard event={activeEvent} isDragging /> : null}</DragOverlay>
    </DndContext>
  )
}
