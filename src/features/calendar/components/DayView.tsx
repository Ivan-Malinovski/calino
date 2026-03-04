import type { JSX } from 'react'
import { useMemo, useState, useCallback, useRef, useLayoutEffect, useEffect } from 'react'
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
import { DEFAULT_CALENDAR_COLOR } from '@/config'
import { EventCard } from './EventCard'
import { ContextMenu } from '@/components/common/ContextMenu'
import { useSwipeNavigation } from '@/hooks/useSwipeNavigation'
import type { CalendarEvent, Calendar } from '@/types'
import styles from './DayView.module.css'

const HOURS = eachHourOfInterval({
  start: startOfDay(new Date()),
  end: endOfDay(new Date()),
})

const BASE_hourHeight = 60

function formatTravelDuration(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    if (mins > 0) {
      return `${hours}h ${mins}m`
    }
    return `${hours}h`
  }
  return `${minutes} min`
}

export function DayView(): JSX.Element {
  const currentDate = useCalendarStore((state) => state.currentDate)
  const events = useCalendarStore((state) => state.events)
  const calendars = useCalendarStore((state) => state.calendars)
  const getEventsForDateRange = useCalendarStore((state) => state.getEventsForDateRange)
  const openModal = useCalendarStore((state) => state.openModal)
  const updateEvent = useCalendarStore((state) => state.updateEvent)
  const timeFormat = useSettingsStore((state) => state.timeFormat)

  const [activeEvent, setActiveEvent] = useState<CalendarEvent | null>(null)
  const [isDraggingToCreate, setIsDraggingToCreate] = useState(false)
  const [dragStart, setDragStart] = useState<string | null>(null)
  const [dragEnd, setDragEnd] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.7)
  const hourHeight = BASE_hourHeight * scale
  const lastPinchDistance = useRef<number | null>(null)

  const { handleTouchStart: swipeTouchStart, handleTouchEnd: swipeTouchEnd } = useSwipeNavigation({
    currentView: 'day',
    currentDate,
  })

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  )

  useEffect(() => {
    const handleWheelZoom = (e: WheelEvent): void => {
      if (e.ctrlKey) {
        e.preventDefault()
        const delta = e.deltaY > 0 ? -0.1 : 0.1
        setScale((s) => Math.min(Math.max(s + delta, 0.7), 1.5))
      }
    }

    const container = containerRef.current
    if (container) {
      container.addEventListener('wheel', handleWheelZoom, { passive: false })
    }

    return () => {
      if (container) {
        container.removeEventListener('wheel', handleWheelZoom)
      }
    }
  }, [])

  const getPinchDistance = (touches: React.TouchList): number => {
    const dx = touches[0].clientX - touches[1].clientX
    const dy = touches[0].clientY - touches[1].clientY
    return Math.sqrt(dx * dx + dy * dy)
  }

  const handlePinchTouchStart = (e: React.TouchEvent): void => {
    if (e.touches.length === 2) {
      lastPinchDistance.current = getPinchDistance(e.touches)
    }
  }

  const handlePinchTouchMove = (e: React.TouchEvent): void => {
    if (e.touches.length === 2 && lastPinchDistance.current !== null) {
      e.preventDefault()
      const currentDistance = getPinchDistance(e.touches)
      const delta = currentDistance - lastPinchDistance.current

      if (delta > 10) {
        setScale((s) => Math.min(s + 0.1, 1.5))
        lastPinchDistance.current = currentDistance
      } else if (delta < -10) {
        setScale((s) => Math.max(s - 0.1, 0.7))
        lastPinchDistance.current = currentDistance
      }
    }
  }

  const handlePinchTouchEnd = (): void => {
    lastPinchDistance.current = null
  }

  const date = parseISO(currentDate)

  const dayEvents = useMemo(() => {
    return getEventsForDateRange(format(date, 'yyyy-MM-dd'), format(date, 'yyyy-MM-dd')).filter(
      (e) => e.type !== 'task'
    )
  }, [date, getEventsForDateRange, events])

  const dayTasks = useMemo(() => {
    const dateKey = format(date, 'yyyy-MM-dd')
    const visibleCalendarIds = calendars.filter((c) => c.isVisible).map((c) => c.id)
    return events.filter(
      (e) =>
        e.type === 'task' &&
        visibleCalendarIds.includes(e.calendarId) &&
        (e.dueDate
          ? format(parseISO(e.dueDate), 'yyyy-MM-dd') === dateKey
          : format(parseISO(e.start), 'yyyy-MM-dd') === dateKey)
    )
  }, [date, events, calendars])

  const [isScrolled, setIsScrolled] = useState(false)
  const lastDateRef = useRef(date.toISOString())
  const hasScrolledForDate = useRef(false)

  useLayoutEffect(() => {
    if (dayEvents.length === 0 || !bodyRef.current) return

    const currentDateStr = date.toISOString()

    if (lastDateRef.current !== currentDateStr) {
      lastDateRef.current = currentDateStr
      hasScrolledForDate.current = false
    }

    if (hasScrolledForDate.current) return

    const rafId = requestAnimationFrame(() => {
      if (!bodyRef.current || dayEvents.length === 0) return

      const sortedEvents = [...dayEvents].sort(
        (a, b) => parseISO(a.start).getTime() - parseISO(b.start).getTime()
      )
      const firstEvent = sortedEvents[0]
      const eventStart = parseISO(firstEvent.start)
      const hours = eventStart.getHours()
      const minutes = eventStart.getMinutes()
      const scrollTop = (hours * 60 + minutes) * (hourHeight / 60) - 60

      bodyRef.current.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' })
      hasScrolledForDate.current = true
    })

    return () => cancelAnimationFrame(rafId)
  }, [dayEvents, date])

  const handleScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    setIsScrolled(e.currentTarget.scrollTop > 0)
  }

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
      const totalMinutes = (y / hourHeight) * 60
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
    const top = startMinutes * (hourHeight / 60)
    const height = (endMinutes - startMinutes) * (hourHeight / 60)

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
      const height = Math.max((durationMinutes / 60) * hourHeight, 20)

      const gap = 4
      const leftPercent = (column / totalColumns) * 100 + gap / 2
      const widthPercent = 100 / totalColumns - gap

      const calendar = calendars.find((c: Calendar) => c.id === event.calendarId)
      const eventColor = event.color || calendar?.color || DEFAULT_CALENDAR_COLOR

      const elements: JSX.Element[] = []

      if (event.travelDuration && event.travelDuration > 0) {
        const travelStart = new Date(start.getTime() - event.travelDuration * 60 * 1000)
        const travelStartHour = travelStart.getHours()
        const travelStartMinutes = travelStart.getMinutes()
        const travelDurationMinutes = event.travelDuration
        const travelHeight = Math.max((travelDurationMinutes / 60) * hourHeight, 16)

        elements.push(
          <div
            key={`${event.id}-travel`}
            className={styles.travelBar}
            style={{
              top: `${(travelStartHour * 60 + travelStartMinutes) * (hourHeight / 60)}px`,
              height: `${travelHeight}px`,
              left: `${leftPercent}%`,
              width: `${widthPercent}%`,
              backgroundColor: `${eventColor}15`,
            }}
            onClick={() => openModal(undefined, undefined, event.id)}
          >
            <span className={styles.travelBarInner}>
              {formatTravelDuration(event.travelDuration)} travel
            </span>
          </div>
        )
      }

      elements.push(
        <div
          key={event.id}
          className={styles.eventPositioned}
          style={{
            top: `${(startHour * 60 + startMinutes) * (hourHeight / 60)}px`,
            height: `${height}px`,
            left: `${leftPercent}%`,
            width: `${widthPercent}%`,
          }}
        >
          <EventCard event={event} hideTopRadius={!!event.travelDuration} />
        </div>
      )

      return <>{elements}</>
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
      <div
        className={styles.container}
        ref={containerRef}
        style={{ '--hour-height': `${60 * scale}px`, touchAction: 'none' } as React.CSSProperties}
        onContextMenu={(e) => {
          e.preventDefault()
          setContextMenu({ x: e.clientX, y: e.clientY })
        }}
        onTouchStart={(e) => {
          handlePinchTouchStart(e)
          swipeTouchStart(e)
        }}
        onTouchMove={handlePinchTouchMove}
        onTouchEnd={(e) => {
          handlePinchTouchEnd()
          swipeTouchEnd(e)
        }}
      >
        <div className={`${styles.header} ${isScrolled ? styles.headerShadow : ''}`}>
          <div className={styles.dayInfo}>
            <div className={styles.dayName}>{format(date, 'EEEE')}</div>
            <div className={`${styles.dayNumber} ${isCurrentDay ? styles.today : ''}`}>
              {format(date, 'd')}
            </div>
          </div>
        </div>
        <div
          ref={bodyRef}
          className={styles.body}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onScroll={handleScroll}
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
      {dayTasks.filter((t) => t.isAllDay).length > 0 && (
        <div className={styles.tasksFixedFooter}>
          <div></div>
          <div>
            {dayTasks
              .filter((t) => t.isAllDay)
              .map((task) => (
                <EventCard key={task.id} event={task} compact />
              ))}
          </div>
        </div>
      )}
      <DragOverlay>{activeEvent ? <EventCard event={activeEvent} isDragging /> : null}</DragOverlay>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: 'Create event',
              onClick: () => {
                openModal(format(date, 'yyyy-MM-dd'))
                setContextMenu(null)
              },
            },
            {
              label: 'Create task',
              onClick: () => {
                openModal(format(date, 'yyyy-MM-dd'), undefined, undefined, 'task')
                setContextMenu(null)
              },
            },
          ]}
        />
      )}
    </DndContext>
  )
}
