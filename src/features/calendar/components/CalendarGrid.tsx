import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import {
  DndContext,
  DragOverlay,
  useDroppable,
  useSensor,
  useSensors,
  PointerSensor,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  eachWeekOfInterval,
  isSameMonth,
  isToday,
  parseISO,
  getISOWeek,
} from 'date-fns'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { EventCard } from './EventCard'
import type { CalendarEvent } from '@/types'
import styles from './CalendarGrid.module.css'

export function CalendarGrid(): JSX.Element {
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

  const handleDragStart = (event: DragStartEvent): void => {
    const eventId = event.active.id as string
    const draggedEvent = events.find((e) => e.id === eventId)
    setActiveEvent(draggedEvent || null)
  }

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    setActiveEvent(null)

    if (!over) return

    const droppableId = over.id as string
    const dayStr = droppableId

    if (!dayStr) return

    const originalEvent = events.find((e) => e.id === active.id)
    if (!originalEvent) return

    const originalStart = parseISO(originalEvent.start)
    const originalEnd = parseISO(originalEvent.end)
    const durationMs = originalEnd.getTime() - originalStart.getTime()

    // Keep the same time as the original event
    const hours = originalStart.getHours().toString().padStart(2, '0')
    const minutes = originalStart.getMinutes().toString().padStart(2, '0')
    const newStart = parseISO(`${dayStr}T${hours}:${minutes}:00`)
    const newEnd = new Date(newStart.getTime() + durationMs)

    updateEvent(active.id as string, {
      start: newStart.toISOString(),
      end: newEnd.toISOString(),
    })
  }

  const weekdays = useMemo(() => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const idx = firstDayOfWeek || 0
    return [...days.slice(idx), ...days.slice(0, idx)]
  }, [firstDayOfWeek])

  const date = parseISO(currentDate)

  const days = useMemo(() => {
    const monthStart = startOfMonth(date)
    const monthEnd = endOfMonth(date)
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: firstDayOfWeek })
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: firstDayOfWeek })

    return eachDayOfInterval({ start: calendarStart, end: calendarEnd })
  }, [date, firstDayOfWeek])

  const weeks = useMemo(() => {
    const monthStart = startOfMonth(date)
    const monthEnd = endOfMonth(date)
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: firstDayOfWeek })
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: firstDayOfWeek })

    return eachWeekOfInterval({
      start: calendarStart,
      end: calendarEnd,
      weekStartsOn: firstDayOfWeek || 0,
    })
  }, [date, firstDayOfWeek])

  const weekNumbers = useMemo(() => {
    return weeks.map((weekStart) => getISOWeek(weekStart))
  }, [weeks])

  const eventsMap = useMemo(() => {
    const monthStart = startOfMonth(date)
    const monthEnd = endOfMonth(date)
    const monthEvents = getEventsForDateRange(
      format(monthStart, 'yyyy-MM-dd'),
      format(monthEnd, 'yyyy-MM-dd')
    )

    const map = new Map<string, CalendarEvent[]>()
    monthEvents.forEach((event) => {
      const eventDate = format(parseISO(event.start), 'yyyy-MM-dd')
      const existing = map.get(eventDate) || []
      map.set(eventDate, [...existing, event])
    })
    return map
  }, [date, events, calendars, getEventsForDateRange])

  const handleDayClick = (day: Date): void => {
    openModal(format(day, 'yyyy-MM-dd'))
  }

  const daysWithWeeks = useMemo(() => {
    const result: { day: Date; weekNum: number }[] = []
    let currentWeekStart = days[0]
    let weekIndex = 0

    days.forEach((day) => {
      const dayWeekStart = startOfWeek(day, { weekStartsOn: firstDayOfWeek || 0 })
      if (dayWeekStart.getTime() !== currentWeekStart.getTime()) {
        currentWeekStart = dayWeekStart
        weekIndex++
      }
      result.push({
        day,
        weekNum: weekNumbers[weekIndex],
      })
    })
    return result
  }, [days, weekNumbers, firstDayOfWeek])

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className={styles.grid}>
        <div className={styles.header}>
          <div className={styles.weekNumHeader}>W#</div>
          {weekdays.map((day) => (
            <div key={day} className={styles.weekday}>
              {day}
            </div>
          ))}
        </div>
        <div className={styles.daysContainer}>
          {weekNumbers.map((weekNum, weekIdx) => (
            <div key={weekIdx} className={styles.weekRow}>
              <div className={styles.weekNumber}>{weekNum}</div>
              {daysWithWeeks
                .filter((d) => d.weekNum === weekNum)
                .map(({ day }) => {
                  const dateKey = format(day, 'yyyy-MM-dd')
                  const dayEvents = eventsMap.get(dateKey) || []
                  const isCurrentMonth = isSameMonth(day, date)
                  const isTodayDate = isToday(day)

                  return (
                    <DroppableDay
                      key={dateKey}
                      dateKey={dateKey}
                      day={day}
                      dayEvents={dayEvents}
                      isCurrentMonth={isCurrentMonth}
                      isTodayDate={isTodayDate}
                      onDayClick={handleDayClick}
                    />
                  )
                })}
            </div>
          ))}
        </div>
      </div>
      <DragOverlay>{activeEvent ? <EventCard event={activeEvent} /> : null}</DragOverlay>
    </DndContext>
  )
}

interface DroppableDayProps {
  dateKey: string
  day: Date
  dayEvents: CalendarEvent[]
  isCurrentMonth: boolean
  isTodayDate: boolean
  onDayClick: (day: Date) => void
}

function DroppableDay({
  dateKey,
  day,
  dayEvents,
  isCurrentMonth,
  isTodayDate,
  onDayClick,
}: DroppableDayProps): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: dateKey })

  return (
    <div
      ref={setNodeRef}
      className={`${styles.day} ${!isCurrentMonth ? styles.otherMonth : ''} ${isTodayDate ? styles.today : ''} ${isOver ? styles.dropTarget : ''}`}
      onClick={() => onDayClick(day)}
    >
      <div className={styles.dayHeader}>
        <span className={styles.dayNumber}>{format(day, 'd')}</span>
      </div>
      <div className={styles.events}>
        <AnimatePresence>
          {dayEvents.slice(0, 3).map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </AnimatePresence>
        {dayEvents.length > 3 && (
          <div className={styles.moreEvents}>+{dayEvents.length - 3} more</div>
        )}
      </div>
    </div>
  )
}
