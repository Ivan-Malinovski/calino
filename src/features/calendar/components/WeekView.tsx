import type { JSX } from 'react'
import React, { useMemo, useState, useCallback, useRef, useLayoutEffect, useEffect } from 'react'
import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  useDroppable,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  format,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  startOfDay,
  endOfDay,
  isToday,
  parseISO,
  getISOWeek,
  addWeeks,
  addDays,
} from 'date-fns'
import { pad2 } from '@/lib/datetime'
import { hasDueTime } from '@/lib/events'
import type { CalendarEvent } from '@/types'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { safeCalDAVUpdate } from '@/lib/caldavHelpers'
import { EventCard } from './EventCard'
import WeekDayColumn from './WeekDayColumn'
import { ContextMenu } from '@/components/common/ContextMenu'
import { useGestures } from '@/hooks/useGestures'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useContextMenuStore } from '@/store/contextMenuStore'
import { useWindowHeight } from '@/hooks/useWindowHeight'
import { hapticIfEnabled } from '@/lib/haptics'
import { HOURS } from '@/lib/hours'
import { CurrentTimeIndicator } from './CurrentTimeIndicator'
import { DropPreviewBand } from './DropPreviewBand'
import {
  MINUTE_SNAP_INTERVAL,
  snapMinuteOfDay,
  computeDropPreview,
  isSameDropPreview,
  type DropPreview,
} from '../lib/dragSnap'
import styles from './WeekView.module.css'

const BASE_HOUR_HEIGHT = 60

interface DroppableCellProps {
  day: Date
  hour: Date
  onClick: () => void
  onMouseDown: (e: React.MouseEvent) => void
}

// The cell is only a drop *target* — the highlight showing where the event will
// land is drawn by DropPreviewBand, which knows the exact quarter hour.
const DroppableCell = React.memo(function DroppableCell({ day, hour, onClick, onMouseDown }: DroppableCellProps): JSX.Element {
  const droppableId = `${format(day, 'yyyy-MM-dd')}-${format(hour, 'HH:mm')}`
  const { setNodeRef } = useDroppable({ id: droppableId })

  return (
    <div
      ref={setNodeRef}
      className={styles.cell}
      onClick={onClick}
      onMouseDown={onMouseDown}
    />
  )
})

interface DayHeaderProps {
  day: Date
  isTodayDay: boolean
  allDayEvents: CalendarEvent[]
  activeIsTimed: boolean
}

// Each day header doubles as an all-day drop target: dragging a timed event
// onto it turns the event into an all-day event (the inverse of dragging a pill
// down into the grid).
const DayHeader = React.memo(function DayHeader({ day, isTodayDay, allDayEvents, activeIsTimed }: DayHeaderProps): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: `allday::${format(day, 'yyyy-MM-dd')}` })

  return (
    <div
      ref={setNodeRef}
      className={`${styles.dayHeader} ${isTodayDay ? styles.today : ''} ${allDayEvents.length > 0 ? styles.hasAllDayEvents : ''} ${isOver && activeIsTimed ? styles.dayHeaderDropActive : ''}`}
    >
      <div className={styles.dayName}>{format(day, 'EEE')}</div>
      <div className={styles.dayNumber}>{format(day, 'd')}</div>
      {allDayEvents.length > 0 && (
        <div className={styles.allDayEventsInHeader}>
          {allDayEvents.map((event) => (
            <EventCard key={event.id} event={event} compact monthView enableResize={false} />
          ))}
        </div>
      )}
    </div>
  )
})

export function WeekView({ dayCount = 7 }: { dayCount?: number } = {}): JSX.Element {
  const currentDate = useCalendarStore((state) => state.currentDate)
  const events = useCalendarStore((state) => state.events)
  const calendars = useCalendarStore((state) => state.calendars)
  const getEventsForDateRange = useCalendarStore((state) => state.getEventsForDateRange)
  // Subscribed to a primitive counter so the eventsMap memo only depends on
  // a number, not the events array reference (R4.3).
  const rangeExpansionVersion = useCalendarStore((state) => state.rangeExpansionVersion)
  const openModal = useCalendarStore((state) => state.openModal)
  const storeUpdateEvent = useCalendarStore((state) => state.updateEvent)
  const setCurrentDate = useCalendarStore((state) => state.setCurrentDate)
  const firstDayOfWeek = useSettingsStore((state) => state.firstDayOfWeek)
  const timeFormat = useSettingsStore((state) => state.timeFormat)
  const openMenuId = useContextMenuStore((state) => state.openMenuId)
  const openMenu = useContextMenuStore((state) => state.openMenu)
  const closeMenu = useContextMenuStore((state) => state.closeMenu)

  const { updateEvent: caldavUpdateEvent } = useCalDAV()

  const [activeEvent, setActiveEvent] = useState<CalendarEvent | null>(null)
  const [dropPreview, setDropPreview] = useState<DropPreview | null>(null)
  const [isDraggingToCreate, setIsDraggingToCreate] = useState(false)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    day: Date
    hour?: number
  } | null>(null)
  const [dragStart, setDragStart] = useState<string | null>(null)
  const [dragEnd, setDragEnd] = useState<string | null>(null)
  const [isScrolled, setIsScrolled] = useState(false)
  const [scale, setScale] = useState(1)
  const windowHeight = useWindowHeight()
  const stretchFactor = windowHeight > 1570 ? windowHeight / 1570 : 1
  const effectiveScale = scale * stretchFactor
  const containerRef = useRef<HTMLDivElement>(null)
  const headerScrollRef = useRef<HTMLDivElement>(null)
  const bodyScrollRef = useRef<HTMLDivElement>(null)
  const mobileScrollRef = useRef<HTMLDivElement>(null)
  const daysContainerRef = useRef<HTMLDivElement>(null)
  const hourHeight = BASE_HOUR_HEIGHT * effectiveScale

  useEffect(() => {
    if (openMenuId !== null && openMenuId !== 'weekview' && contextMenu) {
      setContextMenu(null)
    }
  }, [openMenuId])

  const isMobile = useIsMobile()

  const handleSwipe = useCallback(
    (direction: 'left' | 'right' | 'up' | 'down') => {
      const date = parseISO(currentDate)
      let newDate: Date

      if (direction === 'left' || direction === 'right') {
        newDate =
          dayCount === 7
            ? direction === 'left'
              ? addWeeks(date, 1)
              : addWeeks(date, -1)
            : direction === 'left'
              ? addDays(date, dayCount)
              : addDays(date, -dayCount)
      } else {
        newDate = direction === 'up' ? addDays(date, dayCount) : addDays(date, -dayCount)
      }

      setCurrentDate(newDate.toISOString().split('T')[0])
    },
    [currentDate, setCurrentDate, dayCount]
  )

  const handlePinch = useCallback((scaleValue: number) => {
    setScale(scaleValue)
  }, [])

  const { bind } = useGestures({
    onSwipe: handleSwipe,
    onPinch: handlePinch,
    swipeThreshold: 50,
    pinchScaleRange: { min: 1, max: 1.5 },
  })

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  )

  // Prefer the droppable directly under the pointer (so dropping on the thin
  // day-header strip registers), falling back to rect overlap for the hour grid.
  const collisionDetection: CollisionDetection = useCallback((args) => {
    const pointerCollisions = pointerWithin(args)
    return pointerCollisions.length > 0 ? pointerCollisions : rectIntersection(args)
  }, [])

  // Live preview of where the dragged event will land, refreshed on drag move.
  // The card itself follows the pointer freely; only this band snaps.
  const handleDragMove = (event: DragMoveEvent): void => {
    const durationMinutes = activeEvent && !activeEvent.isAllDay
      ? (parseISO(activeEvent.end).getTime() - parseISO(activeEvent.start).getTime()) / 60_000
      : 60
    const next = computeDropPreview(event.active, event.over, event.delta.y, hourHeight, durationMinutes)
    setDropPreview((prev) => (isSameDropPreview(prev, next) ? prev : next))
  }

  useEffect(() => {
    const handleWheelZoom = (e: WheelEvent): void => {
      if (e.ctrlKey) {
        e.preventDefault()
        const delta = e.deltaY > 0 ? -0.1 : 0.1
        setScale((s) => Math.min(Math.max(s + delta, 1), 1.5))
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

    let isSyncing = false

    const syncScroll = (source: HTMLElement, target: HTMLElement) => () => {
      if (isSyncing) return
      isSyncing = true
      target.scrollLeft = source.scrollLeft
      isSyncing = false
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

  const date = useMemo(() => parseISO(currentDate), [currentDate])

  // Range start/end: a full calendar week (aligned to firstDayOfWeek) when
  // dayCount === 7, otherwise a rolling window of `dayCount` days anchored on
  // the current date (used by the 3-day view).
  const { rangeStart, rangeEnd } = useMemo(() => {
    if (dayCount === 7) {
      return {
        rangeStart: startOfWeek(date, { weekStartsOn: firstDayOfWeek || 0 }),
        rangeEnd: endOfWeek(date, { weekStartsOn: firstDayOfWeek || 0 }),
      }
    }
    const start = startOfDay(date)
    return { rangeStart: start, rangeEnd: endOfDay(addDays(start, dayCount - 1)) }
  }, [date, firstDayOfWeek, dayCount])

  const weekDays = useMemo(
    () => eachDayOfInterval({ start: rangeStart, end: rangeEnd }),
    [rangeStart, rangeEnd]
  )

  const { allDayEventsMap, eventsMap, timedFragmentsMap } = useMemo(() => {
    const weekEvents = getEventsForDateRange(
      format(rangeStart, 'yyyy-MM-dd'),
      format(rangeEnd, 'yyyy-MM-dd')
    )

    const allDay = new Map<string, CalendarEvent[]>()
    const timed = new Map<string, CalendarEvent[]>()
    const timedFragments = new Map<string, CalendarEvent[]>()

    for (const event of weekEvents) {
      const eventStart = parseISO(event.start)
      const eventEnd = parseISO(event.end)
      const startKey = format(eventStart, 'yyyy-MM-dd')
      const endKey = format(eventEnd, 'yyyy-MM-dd')

      if (event.type !== 'task' && event.type !== 'journal' && event.isAllDay) {
        allDay.set(startKey, [...(allDay.get(startKey) || []), event])
      } else if (event.type !== 'task' && !event.isAllDay) {
        // Tasks (all-day or timed) are never placed in the time grid — they
        // render as compact cards in the per-day task footer, matching month
        // view. Only real timed events reach this branch.
        if (startKey === endKey) {
          timed.set(startKey, [...(timed.get(startKey) || []), event])
        } else {
          let currentDay = eventStart
          while (currentDay <= eventEnd) {
            const dayKey = format(currentDay, 'yyyy-MM-dd')
            const isFirst = dayKey === startKey
            const isLast = dayKey === endKey
            const fragment: CalendarEvent = {
              ...event,
              start: isFirst ? event.start : format(startOfDay(currentDay), "yyyy-MM-dd'T'HH:mm:ss"),
              end: isLast ? event.end : format(endOfDay(currentDay), "yyyy-MM-dd'T'HH:mm:ss"),
              isFragment: true,
              isFirstFragment: isFirst,
              isLastFragment: isLast,
              originalStart: event.start,
              originalEnd: event.end,
            }
            timedFragments.set(dayKey, [...(timedFragments.get(dayKey) || []), fragment])
            currentDay = addDays(currentDay, 1)
          }
        }
      }
    }

    return { allDayEventsMap: allDay, eventsMap: timed, timedFragmentsMap: timedFragments }
    // `events` and `calendars` are kept as deps alongside
    // `rangeExpansionVersion` for defense-in-depth: the version bump
    // and the array replacement don't always land in the same Zustand
    // notify cycle, and direct setState callers (e.g. history store)
    // could in theory miss the bump. The linter flags these as
    // 'unnecessary dependencies' but the e2e undo/redo test would
    // catch a regression if either were removed. R4.1/R4.3 review fix.
  }, [rangeStart, rangeEnd, calendars, getEventsForDateRange, events, rangeExpansionVersion])

  const tasksMap = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    const visibleCalendarIds = calendars.filter((c) => c.isVisible).map((c) => c.id)
    events
      .filter(
        (event) =>
          event.type === 'task' && !!event.dueDate && visibleCalendarIds.includes(event.calendarId)
      )
      .forEach((task) => {
        const taskDate = format(parseISO(task.dueDate!), 'yyyy-MM-dd')
        const existing = map.get(taskDate) || []
        map.set(taskDate, [...existing, task])
      })
    return map
  }, [events, calendars, rangeExpansionVersion])

  const bodyRef = useRef<HTMLDivElement>(null)
  const lastDateRef = useRef(date.toISOString())
  const hasScrolledForDate = useRef(false)
  const isCurrentWeek = weekDays.some((d) => isToday(d))

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

      if (isCurrentWeek) {
        // Scroll to current time with padding above
        const now = new Date()
        const minutesSinceMidnight = now.getHours() * 60 + now.getMinutes()
        const fraction = minutesSinceMidnight / (24 * 60)
        const scrollTop = fraction * bodyRef.current.scrollHeight - bodyRef.current.clientHeight * 0.3
        bodyRef.current.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' })
      } else {
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
        const fraction = (hours * 60 + minutes) / (24 * 60)
        const scrollTop = fraction * bodyRef.current.scrollHeight - 60
        bodyRef.current.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' })
      }

      hasScrolledForDate.current = true
    })

    return () => cancelAnimationFrame(rafId)
  }, [eventsMap, date, isMobile, hourHeight, isCurrentWeek])

  useLayoutEffect(() => {
    if (isMobile) return

    const measure = () => {
      const body = bodyRef.current
      const container = containerRef.current
      if (!body || !container) return
      const scrollbarWidth = body.offsetWidth - body.clientWidth
      container.style.setProperty('--scrollbar-width', `${scrollbarWidth}px`)
    }

    measure()

    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [isMobile])

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

      const daysContainer = daysContainerRef.current
      if (!daysContainer) return

      const rect = daysContainer.getBoundingClientRect()
      const x = e.clientX - rect.left
      const dayWidth = rect.width / weekDays.length
      const dayIndex = Math.floor(x / dayWidth)
      const y = e.clientY - rect.top

      const day = weekDays[Math.min(Math.max(dayIndex, 0), weekDays.length - 1)]
      if (!day) return

      const totalMinutes = (y / rect.height) * 24 * 60
      const snappedMinutes = Math.round(totalMinutes / MINUTE_SNAP_INTERVAL) * MINUTE_SNAP_INTERVAL
      const hours = Math.floor(snappedMinutes / 60)
      const mins = snappedMinutes % 60
      const timeStr = `${pad2(hours)}:${pad2(mins)}`
      const endTime = `${format(day, 'yyyy-MM-dd')}T${timeStr}`
      setDragEnd(endTime)
    },
    [isDraggingToCreate, dragStart, weekDays, daysContainerRef]
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
    const topPct = (startMinutes / (24 * 60)) * 100
    const heightPct = ((endMinutes - startMinutes) / (24 * 60)) * 100

    const dayWidth = 100 / weekDays.length
    const left = startDayIndex * dayWidth
    const width = (endDayIndex - startDayIndex + 1) * dayWidth

    return (
      <div
        className={styles.selectionOverlay}
        style={{
          top: `${topPct}%`,
          height: `${Math.max(heightPct, 0.5)}%`,
          left: `${left}%`,
          width: `${width}%`,
        }}
      />
    )
  }, [isDraggingToCreate, dragStart, dragEnd, weekDays])

  const dayColumnProps = useMemo(() => {
    return weekDays.map((day) => {
      const dateKey = format(day, 'yyyy-MM-dd')
      return {
        day,
        events: eventsMap.get(dateKey) || [],
        fragments: timedFragmentsMap.get(dateKey) || [],
        timedTasks: (tasksMap.get(dateKey) || []).filter((t) => hasDueTime(t)),
      }
    })
  }, [weekDays, eventsMap, timedFragmentsMap, tasksMap])

  const handleDragStart = (event: DragStartEvent): void => {
    hapticIfEnabled('light')
    const eventId = String(event.active.id)
    const draggedEvent = events.find((e) => e.id === eventId)
    setActiveEvent(draggedEvent || null)
  }

  const handleDragEnd = async (event: DragEndEvent): Promise<void> => {
    const { active, over, delta } = event
    // Defer clearing active event to avoid scroll jump
    setTimeout(() => setActiveEvent(null), 0)
    setDropPreview(null)

    if (!over) return

    const droppableId = String(over.id)

    // Dropped on a day header → convert a timed event into an all-day event.
    if (droppableId.startsWith('allday::')) {
      const dayStr = droppableId.slice('allday::'.length)
      const originalEvent = events.find((e) => e.id === active.id)
      if (!originalEvent || originalEvent.isAllDay) return
      // Defensive: dnd-kit's useDraggable is disabled on recurring events, but
      // if some other code path triggers a drop on a recurring event, refuse
      // rather than silently moving the whole series.
      if (originalEvent.recurrence || originalEvent.rruleString) return

      const allDayUpdates = {
        start: `${dayStr}T00:00:00`,
        end: `${dayStr}T00:00:00`,
        isAllDay: true,
      }
      storeUpdateEvent(String(active.id), allDayUpdates)
      await safeCalDAVUpdate(
        caldavUpdateEvent,
        originalEvent.calendarId,
        { ...originalEvent, ...allDayUpdates },
        allDayUpdates,
        'Failed to sync dragged event'
      )
      return
    }

    const lastDashIndex = droppableId.lastIndexOf('-')
    const dayStr = droppableId.substring(0, lastDashIndex)
    const hourStr = droppableId.substring(lastDashIndex + 1)

    if (!dayStr || !hourStr) return

    const originalEvent = events.find((e) => e.id === active.id)
    if (!originalEvent) return
    // Defensive: dnd-kit's useDraggable is disabled on recurring events, but
    // if some other code path triggers a drop on a recurring event, refuse
    // rather than silently moving the whole series.
    if (originalEvent.recurrence || originalEvent.rruleString) return

    // Dragging an all-day event into the timed grid turns it into a regular
    // timed event: default it to a 1-hour block. Otherwise preserve duration.
    let updates: { start: string; end: string; isAllDay?: boolean }
    if (originalEvent.isAllDay) {
      const newStart = parseISO(`${dayStr}T${hourStr}`)
      const newEnd = new Date(newStart.getTime() + 60 * 60 * 1000)
      updates = {
        start: newStart.toISOString(),
        end: newEnd.toISOString(),
        isAllDay: false,
      }
    } else {
      const originalStart = parseISO(originalEvent.start)
      const originalEnd = parseISO(originalEvent.end)
      const durationMs = originalEnd.getTime() - originalStart.getTime()
      // The droppable cell only tells us which day was dropped on; the time of
      // day comes from how far the card was dragged vertically, snapped to a
      // quarter hour. Using the hour cell alone would round to whole hours.
      const startMinutes = originalStart.getHours() * 60 + originalStart.getMinutes()
      const newStart = parseISO(`${dayStr}T00:00:00`)
      newStart.setMinutes(snapMinuteOfDay(startMinutes, delta.y, hourHeight))
      const newEnd = new Date(newStart.getTime() + durationMs)
      updates = {
        start: newStart.toISOString(),
        end: newEnd.toISOString(),
      }
    }

    storeUpdateEvent(String(active.id), updates)

    await safeCalDAVUpdate(
      caldavUpdateEvent,
      originalEvent.calendarId,
      { ...originalEvent, ...updates },
      updates,
      'Failed to sync dragged event'
    )
  }

  const weekNumber = useMemo(() => {
    const weekStart = startOfWeek(date, { weekStartsOn: firstDayOfWeek || 0 })
    return getISOWeek(weekStart)
  }, [date, firstDayOfWeek])

  const renderMobileContent = () => (
    <div ref={mobileScrollRef} className={styles.mobileContainer}>
      <div className={styles.mobileHeader}>
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
      <div className={styles.mobileBody}>
        <div className={styles.timeColumn}>
          {HOURS.map((hour) => (
            <div key={hour.toISOString()} className={styles.timeCell}>
              {format(hour, timeFormat === '24h' ? 'HH:mm' : 'h a')}
            </div>
          ))}
        </div>
        <div ref={daysContainerRef} className={styles.daysContainer}>
          {selectionOverlay}
          {weekDays.map((day, idx) => {
            return (
              <div
                key={day.toISOString()}
                className={`${styles.dayColumn} ${isToday(day) ? styles.todayColumn : ''}`}
                onContextMenu={(e) => {
                  e.preventDefault()
                  openMenu('weekview')
                  const rect = e.currentTarget.getBoundingClientRect()
                  const y = e.clientY - rect.top
                  const hourClicked = Math.max(0, Math.min(23, Math.floor((y / rect.height) * 24)))
                  setContextMenu({ x: e.clientX, y: e.clientY, day, hour: hourClicked })
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
                <div className={styles.eventsOverlay}>
                  {dropPreview?.dateKey === format(day, 'yyyy-MM-dd') && (
                    <DropPreviewBand preview={dropPreview} timeFormat={timeFormat} />
                  )}
                  <WeekDayColumn {...dayColumnProps[idx]} calendars={calendars} hourHeight={hourHeight} openModal={openModal} />
                  {isToday(day) && <CurrentTimeIndicator hourHeight={hourHeight} timeFormat={timeFormat} showLabel={false} />}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )

  const renderDesktopContent = () => {
    const allDayEventsByDay = weekDays.map((day) => {
      const dateKey = format(day, 'yyyy-MM-dd')
      return allDayEventsMap.get(dateKey) || []
    })

    return (
      <>
        <div className={`${styles.header} ${isScrolled ? styles.headerShadow : ''}`}>
          <div className={styles.weekNumberHeader}>{dayCount === 7 ? `W${weekNumber}` : ''}</div>
          <div className={styles.headerDays}>
            {weekDays.map((day, idx) => (
              <DayHeader
                key={day.toISOString()}
                day={day}
                isTodayDay={isToday(day)}
                allDayEvents={allDayEventsByDay[idx]}
                activeIsTimed={!!activeEvent && !activeEvent.isAllDay}
              />
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
          <div ref={daysContainerRef} className={styles.daysContainer}>
            {selectionOverlay}
            {weekDays.map((day, idx) => {
              return (
                <div
                  key={day.toISOString()}
                  className={styles.dayColumn}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    openMenu('weekview')
                    const rect = e.currentTarget.getBoundingClientRect()
                    const y = e.clientY - rect.top
                    const hourClicked = Math.max(0, Math.min(23, Math.floor((y / rect.height) * 24)))
                    setContextMenu({ x: e.clientX, y: e.clientY, day, hour: hourClicked })
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
                  <div className={styles.eventsOverlay}>
                    {dropPreview?.dateKey === format(day, 'yyyy-MM-dd') && (
                      <DropPreviewBand preview={dropPreview} timeFormat={timeFormat} />
                    )}
                    <WeekDayColumn {...dayColumnProps[idx]} calendars={calendars} hourHeight={hourHeight} openModal={openModal} />
                    {isToday(day) && <CurrentTimeIndicator hourHeight={hourHeight} timeFormat={timeFormat} showLabel={false} />}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDropPreview(null)}
    >
      <div
        className={styles.container}
        ref={containerRef}
        style={{ '--hour-height': `${60 * effectiveScale}px`, '--day-count': weekDays.length } as React.CSSProperties}
        {...bind}
      >
        {isMobile ? renderMobileContent() : renderDesktopContent()}
        {(() => {
          const tasksByDay: CalendarEvent[][] = Array(weekDays.length)
            .fill(null)
            .map(() => [])
          weekDays.forEach((day, idx) => {
            const dayKey = format(day, 'yyyy-MM-dd')
            const dayTasks = tasksMap.get(dayKey) || []
            // Timed tasks live on the timeline (rendered as pills in the day
            // column); only all-day / untimed tasks belong in the footer.
            dayTasks.filter((t) => !hasDueTime(t)).forEach((t) => tasksByDay[idx].push(t))
          })
          const hasTasks = tasksByDay.some((arr) => arr.length > 0)
          if (!hasTasks) return null
          return (
            <div className={styles.tasksFixedFooter}>
              <div></div>
              {tasksByDay.map((tasks, idx) => (
                <div key={idx} className={styles.tasksFixedFooterCol}>
                  {tasks.map((task) => (
                    <EventCard key={task.id} event={task} compact monthView enableResize={false} />
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
          menuId="weekview"
          onClose={() => {
            closeMenu()
            setContextMenu(null)
          }}
          items={[
            {
              label: 'Create event',
              onClick: () => {
                const hourStr =
                  contextMenu.hour !== undefined
                    ? `T${pad2(contextMenu.hour)}:00`
                    : ''
                openModal(`${format(contextMenu.day, 'yyyy-MM-dd')}${hourStr}`)
                setContextMenu(null)
              },
            },
            {
              label: 'Create task',
              onClick: () => {
                const dateStr = format(contextMenu.day, 'yyyy-MM-dd')
                openModal(dateStr, undefined, undefined, 'task')
                setContextMenu(null)
              },
            },
          ]}
        />
      )}
    </DndContext>
  )
}
