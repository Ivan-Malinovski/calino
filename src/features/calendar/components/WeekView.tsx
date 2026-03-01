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
import {
  format,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  eachHourOfInterval,
  startOfDay,
  endOfDay,
  isToday,
  parseISO,
  getISOWeek,
} from 'date-fns'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { EventCard } from './EventCard'
import type { CalendarEvent } from '@/types'
import styles from './WeekView.module.css'

const HOURS = eachHourOfInterval({
  start: startOfDay(new Date()),
  end: endOfDay(new Date()),
})

interface DroppableCellProps {
  day: Date
  hour: Date
  events: CalendarEvent[]
  onClick: () => void
}

function DroppableCell({ day, hour, events, onClick }: DroppableCellProps): JSX.Element {
  const droppableId = `${format(day, 'yyyy-MM-dd')}-${format(hour, 'HH:mm')}`
  const { setNodeRef, isOver } = useDroppable({ id: droppableId })

  return (
    <div
      ref={setNodeRef}
      className={`${styles.cell} ${isOver ? styles.dropTarget : ''}`}
      onClick={onClick}
    >
      {events.length > 0
        ? events.map((event) => <EventCard key={event.id} event={event} compact />)
        : null}
    </div>
  )
}

export function WeekView(): JSX.Element {
  const currentDate = useCalendarStore((state) => state.currentDate)
  const events = useCalendarStore((state) => state.events)
  const calendars = useCalendarStore((state) => state.calendars)
  const getEventsForDateRange = useCalendarStore((state) => state.getEventsForDateRange)
  const openModal = useCalendarStore((state) => state.openModal)
  const updateEvent = useCalendarStore((state) => state.updateEvent)
  const firstDayOfWeek = useSettingsStore((state) => state.firstDayOfWeek)

  const [activeEvent, setActiveEvent] = useState<CalendarEvent | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  )

  const date = parseISO(currentDate)

  const weekDays = useMemo(() => {
    const weekStart = startOfWeek(date, { weekStartsOn: firstDayOfWeek })
    const weekEnd = endOfWeek(date, { weekStartsOn: firstDayOfWeek })
    return eachDayOfInterval({ start: weekStart, end: weekEnd })
  }, [date, firstDayOfWeek])

  const eventsMap = useMemo(() => {
    const weekStart = startOfWeek(date, { weekStartsOn: firstDayOfWeek })
    const weekEnd = endOfWeek(date, { weekStartsOn: firstDayOfWeek })
    const weekEvents = getEventsForDateRange(
      format(weekStart, 'yyyy-MM-dd'),
      format(weekEnd, 'yyyy-MM-dd')
    )

    const map = new Map<string, CalendarEvent[]>()
    weekEvents.forEach((event: CalendarEvent) => {
      const dateKey = format(parseISO(event.start), 'yyyy-MM-dd')
      const existing = map.get(dateKey) || []
      map.set(dateKey, [...existing, event])
    })
    return map
  }, [date, firstDayOfWeek, events, calendars, getEventsForDateRange])

  const handleCellClick = (day: Date, hour: Date): void => {
    if (!activeEvent) {
      const hourStr = format(hour, 'HH:mm')
      openModal(`${format(day, 'yyyy-MM-dd')}T${hourStr}`)
    }
  }

  const getEventsForHour = (day: Date, hour: Date): CalendarEvent[] => {
    const dateKey = format(day, 'yyyy-MM-dd')
    const dayEvents = eventsMap.get(dateKey) || []
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

    if (isToday(originalStart) && originalStart.getHours() === newStart.getHours()) {
      return
    }

    updateEvent(active.id as string, {
      start: newStart.toISOString(),
      end: newEnd.toISOString(),
    })
  }

  const weekNumber = useMemo(() => {
    const weekStart = startOfWeek(date, { weekStartsOn: firstDayOfWeek })
    return getISOWeek(weekStart)
  }, [date, firstDayOfWeek])

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.weekNumberColumn}>
            <span className={styles.weekNumber}>W{weekNumber}</span>
          </div>
          <div className={styles.timeGutter}></div>
          {weekDays.map((day) => (
            <div
              key={day.toISOString()}
              className={`${styles.dayHeader} ${isToday(day) ? styles.today : ''}`}
            >
              <div className={styles.dayName}>{format(day, 'EEE')}</div>
              <div className={styles.dayNumber}>{format(day, 'd')}</div>
            </div>
          ))}
        </div>
        <div className={styles.body}>
          {HOURS.map((hour) => (
            <div key={hour.toISOString()} className={styles.hourRow}>
              <div className={styles.timeLabel}>{format(hour, 'h a')}</div>
              {weekDays.map((day) => {
                const hourEvents = getEventsForHour(day, hour)
                return (
                  <DroppableCell
                    key={`${day.toISOString()}-${hour.toISOString()}`}
                    day={day}
                    hour={hour}
                    events={hourEvents}
                    onClick={() => handleCellClick(day, hour)}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <DragOverlay>{activeEvent ? <EventCard event={activeEvent} isDragging /> : null}</DragOverlay>
    </DndContext>
  )
}
