import type { JSX } from 'react'
import { useMemo, useState, useCallback } from 'react'
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

const HOUR_HEIGHT = 60

interface DroppableCellProps {
  day: Date
  hour: Date
  onClick: () => void
  onMouseDown: (e: React.MouseEvent) => void
}

function DroppableCell({ day, hour, onClick, onMouseDown }: DroppableCellProps): JSX.Element {
  const droppableId = `${format(day, 'yyyy-MM-dd')}-${format(hour, 'HH:mm')}`
  const { setNodeRef, isOver } = useDroppable({ id: droppableId })

  return (
    <div
      ref={setNodeRef}
      className={`${styles.cell} ${isOver ? styles.dropTarget : ''}`}
      onClick={onClick}
      onMouseDown={onMouseDown}
    />
  )
}

export function WeekView(): JSX.Element {
  const currentDate = useCalendarStore((state) => state.currentDate)
  const events = useCalendarStore((state) => state.events)
  const getEventsForDateRange = useCalendarStore((state) => state.getEventsForDateRange)
  const openModal = useCalendarStore((state) => state.openModal)
  const updateEvent = useCalendarStore((state) => state.updateEvent)
  const firstDayOfWeek = useSettingsStore((state) => state.firstDayOfWeek)
  const timeFormat = useSettingsStore((state) => state.timeFormat)

  const [activeEvent, setActiveEvent] = useState<CalendarEvent | null>(null)
  const [renderKey, setRenderKey] = useState(0)
  const [isDraggingToCreate, setIsDraggingToCreate] = useState(false)
  const [dragStart, setDragStart] = useState<string | null>(null)
  const [dragEnd, setDragEnd] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  )

  const date = parseISO(currentDate)

  const weekDays = useMemo(() => {
    const weekStart = startOfWeek(date, { weekStartsOn: firstDayOfWeek || 0 })
    const weekEnd = endOfWeek(date, { weekStartsOn: firstDayOfWeek || 0 })
    return eachDayOfInterval({ start: weekStart, end: weekEnd })
  }, [date, firstDayOfWeek])

  const eventsMap = useMemo(() => {
    const weekStart = startOfWeek(date, { weekStartsOn: firstDayOfWeek || 0 })
    const weekEnd = endOfWeek(date, { weekStartsOn: firstDayOfWeek || 0 })
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
  }, [date, firstDayOfWeek, getEventsForDateRange, events])

  const handleCellClick = (day: Date, hour: Date): void => {
    const hourStr = format(hour, 'HH:mm')
    openModal(`${format(day, 'yyyy-MM-dd')}T${hourStr}`)
  }

  const handleDragStartFromCell = useCallback(
    (day: Date, hour: Date, e: React.MouseEvent): void => {
      if (e.button !== 0) return
      e.preventDefault()
      const hourStr = format(hour, 'HH:mm')
      const startTime = `${format(day, 'yyyy-MM-dd')}T${hourStr}`
      setIsDraggingToCreate(true)
      setDragStart(startTime)
      setDragEnd(startTime)
    },
    []
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent): void => {
      if (!isDraggingToCreate || !dragStart) return

      const target = e.currentTarget as HTMLDivElement
      const rect = target.getBoundingClientRect()
      const x = e.clientX - rect.left
      const dayWidth = rect.width / 7
      const dayIndex = Math.floor(x / dayWidth)
      const y = e.clientY - rect.top

      const day = weekDays[Math.min(Math.max(dayIndex, 0), 6)]
      if (!day) return

      const totalMinutes = (y / HOUR_HEIGHT) * 60
      const snappedMinutes = Math.round(totalMinutes / 15) * 15
      const hours = Math.floor(snappedMinutes / 60)
      const mins = snappedMinutes % 60
      const timeStr = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`
      const endTime = `${format(day, 'yyyy-MM-dd')}T${timeStr}`
      setDragEnd(endTime)
    },
    [isDraggingToCreate, dragStart, date, firstDayOfWeek, weekDays]
  )

  const handleMouseUp = useCallback((): void => {
    if (!isDraggingToCreate || !dragStart || !dragEnd) return

    const startDateTime = parseISO(dragStart)
    const endDateTime = parseISO(dragEnd)

    if (endDateTime <= startDateTime) {
      setIsDraggingToCreate(false)
      setDragStart(null)
      setDragEnd(null)
      return
    }

    const startDateStr = format(startDateTime, 'yyyy-MM-dd')
    const startTimeStr = format(startDateTime, 'HH:mm')
    const endDateStr = format(endDateTime, 'yyyy-MM-dd')
    const endTimeStr = format(endDateTime, 'HH:mm')

    const selectedDate = `${startDateStr}T${startTimeStr}`
    const endDateTimeStr = `${endDateStr}T${endTimeStr}`
    openModal(selectedDate, endDateTimeStr)

    setIsDraggingToCreate(false)
    setDragStart(null)
    setDragEnd(null)
  }, [isDraggingToCreate, dragStart, dragEnd, openModal])

  const selectionOverlay = useMemo(() => {
    if (!isDraggingToCreate || !dragStart || !dragEnd) return null

    const start = parseISO(dragStart)
    const end = parseISO(dragEnd)

    const startDateKey = format(start, 'yyyy-MM-dd')
    const endDateKey = format(end, 'yyyy-MM-dd')
    const startDayIndex = weekDays.findIndex((d) => format(d, 'yyyy-MM-dd') === startDateKey)
    const endDayIndex = weekDays.findIndex((d) => format(d, 'yyyy-MM-dd') === endDateKey)

    if (startDayIndex === -1 || endDayIndex === -1) return null

    const startMinutes = start.getHours() * 60 + start.getMinutes()
    const endMinutes = end.getHours() * 60 + end.getMinutes()
    const top = startMinutes * (HOUR_HEIGHT / 60)
    const height = (endMinutes - startMinutes) * (HOUR_HEIGHT / 60)

    const dayWidth = 100 / 7
    const left = startDayIndex * dayWidth
    const width = (endDayIndex - startDayIndex + 1) * dayWidth

    return (
      <div
        className={styles.selectionOverlay}
        style={{
          top: `${top}px`,
          height: `${Math.max(height, 20)}px`,
          left: `${left}%`,
          width: `${width}%`,
        }}
      />
    )
  }, [isDraggingToCreate, dragStart, dragEnd, weekDays])

  const renderDayEvents = (day: Date): JSX.Element[] => {
    const dateKey = format(day, 'yyyy-MM-dd')
    const dayEvents = eventsMap.get(dateKey) || []

    const sortedEvents = [...dayEvents].sort(
      (a, b) => parseISO(a.start).getTime() - parseISO(b.start).getTime()
    )

    const positioned: { event: CalendarEvent; column: number }[] = []

    // First pass: assign columns
    sortedEvents.forEach((event) => {
      const eventStart = parseISO(event.start).getTime()
      const eventEnd = parseISO(event.end).getTime()

      let column = 0
      while (true) {
        const hasCollision = positioned.some(
          (p) =>
            p.column === column &&
            parseISO(p.event.start).getTime() < eventEnd &&
            parseISO(p.event.end).getTime() > eventStart
        )
        if (!hasCollision) break
        column++
      }

      positioned.push({ event, column })
    })

    // Second pass: calculate totalColumns for each event
    const withTotals = positioned.map(({ event, column }) => {
      const eventStart = parseISO(event.start).getTime()
      const eventEnd = parseISO(event.end).getTime()

      let totalColumns = 1
      const eventStartMinutes = eventStart / 60000
      const eventEndMinutes = eventEnd / 60000

      for (let t = eventStartMinutes; t < eventEndMinutes; t += 30) {
        const overlapping = positioned.filter(
          (p) =>
            parseISO(p.event.start).getTime() / 60000 < t + 30 &&
            parseISO(p.event.end).getTime() / 60000 > t
        ).length
        totalColumns = Math.max(totalColumns, overlapping)
      }

      return { event, column, totalColumns }
    })

    return withTotals.map(({ event, column, totalColumns }) => {
      const start = parseISO(event.start)
      const end = parseISO(event.end)

      const startHour = start.getHours()
      const startMinutes = start.getMinutes()
      const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60)
      const height = Math.max((durationMinutes / 60) * HOUR_HEIGHT, 20)

      const leftPercent = (column / totalColumns) * 100
      const widthPercent = 100 / totalColumns

      return (
        <div
          key={event.id}
          className={styles.eventPositioned}
          style={{
            top: `${(startHour * 60 + startMinutes) * (HOUR_HEIGHT / 60)}px`,
            height: `${height}px`,
            left: `${leftPercent}%`,
            width: `${widthPercent}%`,
          }}
        >
          <EventCard event={event} compact enableResize />
        </div>
      )
    })
  }

  const handleDragStart = (event: DragStartEvent): void => {
    const eventId = event.active.id as string
    const draggedEvent = events.find((e) => e.id === eventId)
    setActiveEvent(draggedEvent || null)
  }

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    // Defer clearing active event to avoid scroll jump
    setTimeout(() => setActiveEvent(null), 0)

    if (!over) return

    const droppableId = over.id as string
    const lastDashIndex = droppableId.lastIndexOf('-')
    const dayStr = droppableId.substring(0, lastDashIndex)
    const hourStr = droppableId.substring(lastDashIndex + 1)

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

    // Force re-render to ensure visual update
    setRenderKey((k) => k + 1)
  }

  const weekNumber = useMemo(() => {
    const weekStart = startOfWeek(date, { weekStartsOn: firstDayOfWeek || 0 })
    return getISOWeek(weekStart)
  }, [date, firstDayOfWeek])

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className={styles.container} key={renderKey}>
        <div className={styles.header}>
          <div className={styles.weekNumberHeader}>W{weekNumber}</div>
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
        <div
          className={styles.body}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <div className={styles.timeColumn}>
            {HOURS.map((hour) => (
              <div key={hour.toISOString()} className={styles.timeCell}>
                {format(hour, timeFormat === '24h' ? 'HH:mm' : 'h a')}
              </div>
            ))}
          </div>
          {weekDays.map((day) => (
            <div key={day.toISOString()} className={styles.dayColumn}>
              <div className={styles.hourCells}>
                {HOURS.map((hour) => (
                  <DroppableCell
                    key={`${day.toISOString()}-${hour.toISOString()}`}
                    day={day}
                    hour={hour}
                    onClick={() => handleCellClick(day, hour)}
                    onMouseDown={(e) => handleDragStartFromCell(day, hour, e)}
                  />
                ))}
              </div>
              <div className={styles.eventsOverlay}>
                {day === weekDays[0] && selectionOverlay}
                {renderDayEvents(day)}
              </div>
            </div>
          ))}
        </div>
      </div>
      <DragOverlay>{activeEvent ? <EventCard event={activeEvent} isDragging /> : null}</DragOverlay>
    </DndContext>
  )
}
