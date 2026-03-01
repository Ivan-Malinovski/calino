import type { JSX } from 'react'
import { useMemo, useState, useRef, useCallback, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
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
  eachDayOfInterval,
  isSameMonth,
  isToday,
  parseISO,
  getISOWeek,
  getDay,
  addMonths,
  subMonths,
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
  const setCurrentDate = useCalendarStore((state) => state.setCurrentDate)
  const setCurrentView = useCalendarStore((state) => state.setCurrentView)
  const firstDayOfWeek = useSettingsStore((state) => state.firstDayOfWeek)

  const [activeEvent, setActiveEvent] = useState<CalendarEvent | null>(null)
  const [scrollDirection, setScrollDirection] = useState<'up' | 'down' | null>(null)
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentDateRef = useRef(currentDate)
  const containerRef = useRef<HTMLDivElement>(null)

  currentDateRef.current = currentDate

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  )

  const changeMonth = useCallback(
    (direction: 'up' | 'down') => {
      if (direction === 'down') {
        setCurrentDate(format(addMonths(parseISO(currentDateRef.current), 1), 'yyyy-MM-dd'))
      } else if (direction === 'up') {
        setCurrentDate(format(subMonths(parseISO(currentDateRef.current), 1), 'yyyy-MM-dd'))
      }
    },
    [setCurrentDate]
  )

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (scrollCooldownRef.current) return
      if (Math.abs(e.deltaY) < 20) return

      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }

      const direction = e.deltaY > 0 ? 'down' : 'up'
      setScrollDirection(direction)

      scrollCooldownRef.current = setTimeout(() => {
        scrollCooldownRef.current = null
      }, 400)

      scrollTimeoutRef.current = setTimeout(() => {
        changeMonth(direction)
        setScrollDirection(null)
      }, 0)
    },
    [changeMonth]
  )

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const direction = e.key === 'ArrowDown' ? 'down' : 'up'
        changeMonth(direction)
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
      if (scrollCooldownRef.current) {
        clearTimeout(scrollCooldownRef.current)
      }
    }
  }, [changeMonth])

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
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: firstDayOfWeek })
    const calendarEnd = new Date(calendarStart)
    calendarEnd.setDate(calendarEnd.getDate() + 35)

    return eachDayOfInterval({ start: calendarStart, end: calendarEnd })
  }, [date, firstDayOfWeek])

  const numWeeks = Math.floor(days.length / 7)

  const weekNumbers = useMemo(() => {
    return Array.from({ length: numWeeks }, (_, i) => getISOWeek(days[i * 7]))
  }, [numWeeks, days])

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

  const handleDayNumberClick = (day: Date): void => {
    setCurrentDate(format(day, 'yyyy-MM-dd'))
    setCurrentView('day')
  }

  const handleWeekClick = (weekStart: Date): void => {
    setCurrentDate(format(weekStart, 'yyyy-MM-dd'))
    setCurrentView('week')
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className={styles.grid} ref={containerRef} onWheel={handleWheel}>
        <div className={styles.header}>
          <div className={styles.weekNumHeader}>W#</div>
          {weekdays.map((day) => (
            <div key={day} className={styles.weekday}>
              {day}
            </div>
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={currentDate}
            className={styles.daysContainer}
            initial={{ opacity: 0, y: scrollDirection === 'down' ? -10 : 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: scrollDirection === 'down' ? 10 : -10 }}
            transition={{ duration: 0.1 }}
          >
            {weekNumbers.map((weekNum, weekIdx) => (
              <div key={weekIdx} className={styles.weekRow}>
                <div
                  className={styles.weekNumber}
                  onClick={() => handleWeekClick(days[weekIdx * 7])}
                >
                  {weekNum}
                </div>
                {days.slice(weekIdx * 7, weekIdx * 7 + 7).map((day) => {
                  const dateKey = format(day, 'yyyy-MM-dd')
                  const dayEvents = eventsMap.get(dateKey) || []
                  const isCurrentMonth = isSameMonth(day, date)
                  const isTodayDate = isToday(day)
                  const dayOfWeek = getDay(day)
                  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6

                  return (
                    <DroppableDay
                      key={dateKey}
                      dateKey={dateKey}
                      day={day}
                      dayEvents={dayEvents}
                      isCurrentMonth={isCurrentMonth}
                      isTodayDate={isTodayDate}
                      isWeekend={isWeekend}
                      onDayClick={handleDayClick}
                      onDayNumberClick={handleDayNumberClick}
                    />
                  )
                })}
              </div>
            ))}
          </motion.div>
        </AnimatePresence>
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
  isWeekend: boolean
  onDayClick: (day: Date) => void
  onDayNumberClick: (day: Date) => void
}

function DroppableDay({
  dateKey,
  day,
  dayEvents,
  isCurrentMonth,
  isTodayDate,
  isWeekend,
  onDayClick,
  onDayNumberClick,
}: DroppableDayProps): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: dateKey })

  return (
    <div
      ref={setNodeRef}
      className={`${styles.day} ${!isCurrentMonth ? styles.otherMonth : ''} ${isTodayDate ? styles.today : ''} ${isWeekend ? styles.weekend : ''} ${isOver ? styles.dropTarget : ''}`}
      onClick={() => onDayClick(day)}
    >
      <div className={styles.dayHeader}>
        <span
          className={styles.dayNumber}
          onClick={(e) => {
            e.stopPropagation()
            onDayNumberClick(day)
          }}
        >
          {format(day, 'd')}
        </span>
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
