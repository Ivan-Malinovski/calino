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
import { DEFAULT_CALENDAR_COLOR } from '@/config'
import { EventCard } from './EventCard'
import { ContextMenu } from '@/components/common/ContextMenu'
import { useSwipeNavigation } from '@/hooks/useSwipeNavigation'
import type { CalendarEvent, Calendar } from '@/types'
import styles from './WeekView.module.css'

const HOURS = eachHourOfInterval({
  start: startOfDay(new Date()),
  end: endOfDay(new Date()),
})

const BASE_HOUR_HEIGHT = 60

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
  const calendars = useCalendarStore((state) => state.calendars)
  const getEventsForDateRange = useCalendarStore((state) => state.getEventsForDateRange)
  const openModal = useCalendarStore((state) => state.openModal)
  const updateEvent = useCalendarStore((state) => state.updateEvent)
  const firstDayOfWeek = useSettingsStore((state) => state.firstDayOfWeek)
  const timeFormat = useSettingsStore((state) => state.timeFormat)

  const [activeEvent, setActiveEvent] = useState<CalendarEvent | null>(null)
  const [isDraggingToCreate, setIsDraggingToCreate] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; day: Date } | null>(null)
  const [dragStart, setDragStart] = useState<string | null>(null)
  const [dragEnd, setDragEnd] = useState<string | null>(null)
  const [isScrolled, setIsScrolled] = useState(false)
  const [scale, setScale] = useState(0.7)
  const containerRef = useRef<HTMLDivElement>(null)
  const headerScrollRef = useRef<HTMLDivElement>(null)
  const bodyScrollRef = useRef<HTMLDivElement>(null)
  const hourHeight = BASE_HOUR_HEIGHT * scale
  const lastPinchDistance = useRef<number | null>(null)

  const { handleTouchStart: swipeTouchStart, handleTouchEnd: swipeTouchEnd } = useSwipeNavigation({
    currentView: 'week',
    currentDate,
  })

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768

  const handleMobileTouchStart = useCallback(
    (e: React.TouchEvent) => {
      handlePinchTouchStart(e)
      if (!isMobile) {
        swipeTouchStart(e)
      }
    },
    [isMobile, swipeTouchStart]
  )

  const handleMobileTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      handlePinchTouchEnd()

      if (!isMobile) {
        swipeTouchEnd(e)
        return
      }

      const scrollContainer = bodyScrollRef.current
      if (!scrollContainer) {
        swipeTouchEnd(e)
        return
      }

      const touchStartX = (e.target as HTMLElement).dataset.touchStartX
      if (!touchStartX) {
        swipeTouchEnd(e)
        return
      }

      const touchEndX = e.changedTouches[0].clientX
      const diff = parseFloat(touchStartX) - touchEndX

      if (Math.abs(diff) < 50) {
        return
      }

      const scrollLeft = scrollContainer.scrollLeft
      const maxScroll = scrollContainer.scrollWidth - scrollContainer.clientWidth
      const isAtStart = scrollLeft <= 10
      const isAtEnd = scrollLeft >= maxScroll - 10

      if ((diff > 0 && isAtEnd) || (diff < 0 && isAtStart)) {
        swipeTouchEnd(e)
      }
    },
    [isMobile, swipeTouchEnd]
  )

  const handleTouchStartCapture = useCallback(
    (e: React.TouchEvent) => {
      if (isMobile && e.touches.length === 1) {
        const target = e.target as HTMLElement
        target.dataset.touchStartX = String(e.touches[0].clientX)
      }
    },
    [isMobile]
  )

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

  useEffect(() => {
    if (!isMobile) return

    const headerEl = headerScrollRef.current
    const bodyEl = bodyScrollRef.current
    if (!headerEl || !bodyEl) return

    const syncScroll = (source: HTMLElement, target: HTMLElement) => () => {
      target.scrollLeft = source.scrollLeft
    }

    const handleHeaderScroll = syncScroll(headerEl, bodyEl)
    const handleBodyScroll = syncScroll(bodyEl, headerEl)

    headerEl.addEventListener('scroll', handleHeaderScroll)
    bodyEl.addEventListener('scroll', handleBodyScroll)

    return () => {
      headerEl.removeEventListener('scroll', handleHeaderScroll)
      bodyEl.removeEventListener('scroll', handleBodyScroll)
    }
  }, [isMobile])

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
    weekEvents
      .filter((event) => {
        if (event.type !== 'task') return true
        if (event.isAllDay) return false
        return event.start && event.dueDate
      })
      .forEach((event: CalendarEvent) => {
        const dateKey = format(parseISO(event.start), 'yyyy-MM-dd')
        const existing = map.get(dateKey) || []
        map.set(dateKey, [...existing, event])
      })
    return map
  }, [date, firstDayOfWeek, getEventsForDateRange, events])

  const tasksMap = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    const visibleCalendarIds = calendars.filter((c) => c.isVisible).map((c) => c.id)
    events
      .filter(
        (event) =>
          event.type === 'task' && event.isAllDay && visibleCalendarIds.includes(event.calendarId)
      )
      .forEach((task) => {
        const taskDate = task.dueDate
          ? format(parseISO(task.dueDate), 'yyyy-MM-dd')
          : format(parseISO(task.start), 'yyyy-MM-dd')
        const existing = map.get(taskDate) || []
        map.set(taskDate, [...existing, task])
      })
    return map
  }, [events, calendars])

  const bodyRef = useRef<HTMLDivElement>(null)
  const lastDateRef = useRef(date.toISOString())
  const hasScrolledForDate = useRef(false)

  useLayoutEffect(() => {
    if (isMobile || !bodyRef.current) return

    const currentDateStr = date.toISOString()

    if (lastDateRef.current !== currentDateStr) {
      lastDateRef.current = currentDateStr
      hasScrolledForDate.current = false
    }

    if (hasScrolledForDate.current) return

    const rafId = requestAnimationFrame(() => {
      if (!bodyRef.current) return

      const sortedAllEvents: CalendarEvent[] = []
      eventsMap.forEach((dayEvents) => {
        sortedAllEvents.push(...dayEvents)
      })

      if (sortedAllEvents.length === 0) return

      sortedAllEvents.sort((a, b) => parseISO(a.start).getTime() - parseISO(b.start).getTime())
      const firstEvent = sortedAllEvents[0]
      const eventStart = parseISO(firstEvent.start)
      const hours = eventStart.getHours()
      const minutes = eventStart.getMinutes()
      const scrollTop = (hours * 60 + minutes) * (hourHeight / 60) - 60

      bodyRef.current.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' })
      hasScrolledForDate.current = true
    })

    return () => cancelAnimationFrame(rafId)
  }, [eventsMap, date, isMobile, hourHeight])

  const handleScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    setIsScrolled(e.currentTarget.scrollTop > 0)
  }

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

      const totalMinutes = (y / hourHeight) * 60
      const snappedMinutes = Math.round(totalMinutes / 15) * 15
      const hours = Math.floor(snappedMinutes / 60)
      const mins = snappedMinutes % 60
      const timeStr = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`
      const endTime = `${format(day, 'yyyy-MM-dd')}T${timeStr}`
      setDragEnd(endTime)
    },
    [isDraggingToCreate, dragStart, date, firstDayOfWeek, weekDays, hourHeight]
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
    const top = startMinutes * (hourHeight / 60)
    const height = (endMinutes - startMinutes) * (hourHeight / 60)

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

    return withTotals.flatMap(({ event, column, totalColumns }) => {
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
          <EventCard event={event} enableResize hideTopRadius={!!event.travelDuration} />
        </div>
      )

      return elements
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
  }

  const weekNumber = useMemo(() => {
    const weekStart = startOfWeek(date, { weekStartsOn: firstDayOfWeek || 0 })
    return getISOWeek(weekStart)
  }, [date, firstDayOfWeek])

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div
        className={styles.container}
        ref={containerRef}
        style={{ '--hour-height': `${60 * scale}px`, touchAction: 'none' } as React.CSSProperties}
        onTouchStartCapture={handleTouchStartCapture}
        onTouchStart={handleMobileTouchStart}
        onTouchMove={handlePinchTouchMove}
        onTouchEnd={handleMobileTouchEnd}
      >
        <div
          ref={headerScrollRef}
          className={`${styles.header} ${isScrolled ? styles.headerShadow : ''}`}
        >
          <div className={styles.weekNumberHeader}>W{weekNumber}</div>
          <div className={styles.headerDays}>
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
        </div>
        <div
          ref={bodyRef}
          className={styles.body}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onScroll={handleScroll}
        >
          <div className={styles.timeColumn}>
            {HOURS.map((hour) => (
              <div key={hour.toISOString()} className={styles.timeCell}>
                {format(hour, timeFormat === '24h' ? 'HH:mm' : 'h a')}
              </div>
            ))}
          </div>
          <div ref={bodyScrollRef} className={styles.daysContainer}>
            {weekDays.map((day) => {
              return (
                <div
                  key={day.toISOString()}
                  className={styles.dayColumn}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setContextMenu({ x: e.clientX, y: e.clientY, day })
                  }}
                >
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
                  <div className={styles.eventsOverlay} style={{ height: 24 * hourHeight }}>
                    {day === weekDays[0] && selectionOverlay}
                    {renderDayEvents(day)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        {(() => {
          const tasksByDay: CalendarEvent[][] = Array(7)
            .fill(null)
            .map(() => [])
          weekDays.forEach((day, idx) => {
            const dayKey = format(day, 'yyyy-MM-dd')
            const dayTasks = tasksMap.get(dayKey) || []
            dayTasks.filter((t) => t.isAllDay).forEach((t) => tasksByDay[idx].push(t))
          })
          const hasTasks = tasksByDay.some((arr) => arr.length > 0)
          if (!hasTasks) return null
          return (
            <div className={styles.tasksFixedFooter}>
              <div></div>
              {tasksByDay.map((tasks, idx) => (
                <div key={idx} className={styles.tasksFixedFooterCol}>
                  {tasks.map((task) => (
                    <EventCard key={task.id} event={task} compact />
                  ))}
                </div>
              ))}
            </div>
          )
        })()}
      </div>
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
                openModal(format(contextMenu.day, 'yyyy-MM-dd'))
                setContextMenu(null)
              },
            },
            {
              label: 'Create task',
              onClick: () => {
                openModal(format(contextMenu.day, 'yyyy-MM-dd'), undefined, undefined, 'task')
                setContextMenu(null)
              },
            },
          ]}
        />
      )}
    </DndContext>
  )
}
