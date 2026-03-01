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
import { format, eachHourOfInterval, startOfDay, endOfDay, parseISO, isToday } from 'date-fns'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { EventCard } from './EventCard'
import type { CalendarEvent } from '@/types'
import styles from './DayView.module.css'

const HOURS = eachHourOfInterval({
  start: startOfDay(new Date()),
  end: endOfDay(new Date()),
})

const HOUR_HEIGHT = 60

export function DayView(): JSX.Element {
  const currentDate = useCalendarStore((state) => state.currentDate)
  const events = useCalendarStore((state) => state.events)
  const getEventsForDateRange = useCalendarStore((state) => state.getEventsForDateRange)
  const openModal = useCalendarStore((state) => state.openModal)
  const updateEvent = useCalendarStore((state) => state.updateEvent)
  const setCurrentDate = useCalendarStore((state) => state.setCurrentDate)
  const timeFormat = useSettingsStore((state) => state.timeFormat)

  const [activeEvent, setActiveEvent] = useState<CalendarEvent | null>(null)
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

  const dayEvents = useMemo(() => {
    return getEventsForDateRange(format(date, 'yyyy-MM-dd'), format(date, 'yyyy-MM-dd'))
  }, [date, getEventsForDateRange, events])

  const handleCellClick = (hour: Date): void => {
    const hourStr = format(hour, 'HH:mm')
    openModal(`${format(date, 'yyyy-MM-dd')}T${hourStr}`)
  }

  const handleDragStartFromCell = useCallback(
    (hour: Date, e: React.MouseEvent): void => {
      if (e.button !== 0) return
      e.preventDefault()
      const hourStr = format(hour, 'HH:mm')
      const startTime = `${format(date, 'yyyy-MM-dd')}T${hourStr}`
      setIsDraggingToCreate(true)
      setDragStart(startTime)
      setDragEnd(startTime)
    },
    [date]
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent): void => {
      if (!isDraggingToCreate || !dragStart) return

      const target = e.currentTarget as HTMLDivElement
      const rect = target.getBoundingClientRect()
      const y = e.clientY - rect.top
      const totalMinutes = (y / HOUR_HEIGHT) * 60
      const snappedMinutes = Math.round(totalMinutes / 15) * 15
      const hours = Math.floor(snappedMinutes / 60)
      const mins = snappedMinutes % 60
      const timeStr = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`
      const endTime = `${format(date, 'yyyy-MM-dd')}T${timeStr}`
      setDragEnd(endTime)
    },
    [isDraggingToCreate, dragStart, date]
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
    const startMinutes = start.getHours() * 60 + start.getMinutes()
    const endMinutes = end.getHours() * 60 + end.getMinutes()
    const top = startMinutes * (HOUR_HEIGHT / 60)
    const height = (endMinutes - startMinutes) * (HOUR_HEIGHT / 60)

    return (
      <div
        className={styles.selectionOverlay}
        style={{ top: `${top}px`, height: `${Math.max(height, 20)}px` }}
      />
    )
  }, [isDraggingToCreate, dragStart, dragEnd])

  const handleDragStart = (event: DragStartEvent): void => {
    const eventId = event.active.id as string
    const draggedEvent = events.find((e) => e.id === eventId)
    setActiveEvent(draggedEvent || null)
  }

  const handleDragEnd = (dragEvent: DragEndEvent): void => {
    const { active, over } = dragEvent
    setActiveEvent(null)

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
    setCurrentDate(dayStr)
  }

  const renderEvents = (): JSX.Element[] => {
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
          <EventCard event={event} />
        </div>
      )
    })
  }

  const isCurrentDay = isToday(date)

  const HourCell = ({ hour }: { hour: Date }): JSX.Element => {
    const droppableId = `${format(date, 'yyyy-MM-dd')}-${format(hour, 'HH:mm')}`
    const { setNodeRef, isOver } = useDroppable({ id: droppableId })

    return (
      <div key={hour.toISOString()} className={styles.hourRow}>
        <div className={styles.timeLabel}>
          {format(hour, timeFormat === '24h' ? 'HH:mm' : 'h a')}
        </div>
        <div
          ref={setNodeRef}
          className={`${styles.cell} ${isOver ? styles.dropTarget : ''}`}
          onClick={() => handleCellClick(hour)}
          onMouseDown={(e) => handleDragStartFromCell(hour, e)}
        />
      </div>
    )
  }

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
        <div
          className={styles.body}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {HOURS.map((hour) => (
            <HourCell key={hour.toISOString()} hour={hour} />
          ))}
          <div className={styles.eventsOverlay}>
            {selectionOverlay}
            {renderEvents()}
          </div>
        </div>
      </div>
      <DragOverlay>{activeEvent ? <EventCard event={activeEvent} isDragging /> : null}</DragOverlay>
    </DndContext>
  )
}
