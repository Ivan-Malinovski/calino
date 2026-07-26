import type { JSX } from 'react'
import React, { useMemo, useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import {
  DndContext,
  DragOverlay,
  useDroppable,
  useDndContext,
  useSensor,
  useSensors,
  MouseSensor,
  TouchSensor,
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
  isSameMonth,
  isToday,
  parseISO,
  getISOWeek,
  getDay,
  addMonths,
  subMonths,
  isSameDay,
  isBefore,
  startOfDay,
  endOfDay,
  addDays,
  differenceInCalendarDays,
} from 'date-fns'
import { pad2 } from '@/lib/datetime'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { useIsMobile, useIsCompactMobile } from '@/hooks/useIsMobile'
import { useDateChangeMotion, type DateChangeMotion } from '@/hooks/useDateChangeMotion'
import { safeCalDAVUpdate } from '@/lib/caldavHelpers'
import { EventCard } from './EventCard'
import { DayEventsPopup } from './DayEventsPopup'
import { ContextMenu } from '@/components/common/ContextMenu'
import { useGestures } from '@/hooks/useGestures'
import { eventCardVariants } from '../lib/eventAnimations'
import { hapticIfEnabled } from '@/lib/haptics'
import { useIsTallWindow, useIsWideWindow } from '@/hooks/useWindowHeight'
import { useIsPortraitWindow } from '@/hooks/useWindow'
import { useDragDuplicateModifier } from '@/hooks/useDragDuplicateModifier'
import { useDragModifierStore } from '@/store/dragModifierStore'
import { useContextMenuStore } from '@/store/contextMenuStore'
import { AgendaView } from './AgendaView'
import { DayView } from './DayView'
import type { CalendarEvent, ViewType } from '@/types'
import { getJournalDates, getTasksDueOn } from '@/store/calendarStore'
import styles from './CalendarGrid.module.css'

const VIEW_ROUTES: Record<ViewType, string> = {
  month: '/month',
  year: '/year',
  week: '/week',
  '3day': '/3day',
  day: '/day',
  agenda: '/agenda',
  todo: '/tasks',
  journal: '/journal',
  contacts: '/contacts',
}

export function CalendarGrid(): JSX.Element {
  const currentDate = useCalendarStore((state) => state.currentDate)
  const events = useCalendarStore((state) => state.events)
  const calendars = useCalendarStore((state) => state.calendars)
  const categories = useCalendarStore((state) => state.categories)
  const selectedCategoryIds = useCalendarStore((state) => state.selectedCategoryIds)
  const selectedCategoryNames = useMemo(
    () =>
      selectedCategoryIds.length > 0
        ? categories.filter((c) => selectedCategoryIds.includes(c.id)).map((c) => c.name)
        : [],
    [selectedCategoryIds, categories]
  )
  const getEventsForDateRange = useCalendarStore((state) => state.getEventsForDateRange)
  // R4.3: primitive version counter is a stable dep for the per-range memos
  // below (replaces the raw `events` array ref which would force a re-run on
  // every mutation even when the visible range's result is unchanged).
  const rangeExpansionVersion = useCalendarStore((state) => state.rangeExpansionVersion)
  const openModal = useCalendarStore((state) => state.openModal)
  const storeUpdateEvent = useCalendarStore((state) => state.updateEvent)
  const duplicateEvent = useCalendarStore((state) => state.duplicateEvent)
  const setCurrentDate = useCalendarStore((state) => state.setCurrentDate)
  const setCurrentView = useCalendarStore((state) => state.setCurrentView)
  const isOverlayOpen = useCalendarStore((state) => state.isOverlayOpen)
  const navigate = useNavigate()
  const firstDayOfWeek = useSettingsStore((state) => state.firstDayOfWeek)
  const compactRecurringEvents = useSettingsStore((state) => state.compactRecurringEvents ?? false)
  const compressPastWeeks = useSettingsStore((state) => state.compressPastWeeks ?? false)
  const monthViewEventLimit = useSettingsStore((state) => state.monthViewEventLimit ?? 3)
  const showWeekNumbers = useSettingsStore((state) => state.showWeekNumbers)
  const hideCompletedTasksInMonthView = useSettingsStore(
    (state) => state.hideCompletedTasksInMonthView ?? true
  )
  const journalEnabled = useSettingsStore((state) => state.journalEnabled)
  const agendaBelowMonthEnabled = useSettingsStore((state) => state.agendaBelowMonthEnabled)
  const monthAgendaGridRatioSetting = useSettingsStore((state) => state.monthAgendaGridRatio)
  const monthAgendaSplitRatioSetting = useSettingsStore((state) => state.monthAgendaSplitRatio)
  const updateSettings = useSettingsStore((state) => state.updateSettings)

  const { updateEvent: caldavUpdateEvent } = useCalDAV()

  const { bind } = useGestures({
    onSwipe: (direction) => {
      // Vertical swipes map directly; horizontal swipes mirror the
      // Google Calendar convention (left → next month, right → previous).
      if (direction === 'down' || direction === 'left') {
        changeMonth('down')
      } else if (direction === 'up' || direction === 'right') {
        changeMonth('up')
      }
    },
    onPinch: (scaleValue) => {
      setScale(scaleValue)
    },
    swipeThreshold: 50,
    pinchScaleRange: { min: 1, max: 1.5 },
  })

  // Arrow-key roving focus across day cells: ←/→ move one day, ↑/↓ move one
  // week. Enter/Space (handled on each cell) opens the focused day.
  const handleGridKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const { key } = e
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown')
      return
    const active = document.activeElement as HTMLElement | null
    const cell = active?.closest('[data-date]') as HTMLElement | null
    if (!cell || !e.currentTarget.contains(cell)) return
    // Stop the window-level handler (which maps ↑/↓ to month change) from also
    // firing while a day cell owns keyboard focus.
    e.preventDefault()
    e.stopPropagation()
    const cells = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-date]'))
    const idx = cells.indexOf(cell)
    if (idx === -1) return
    const delta = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : key === 'ArrowUp' ? -7 : 7
    const target = cells[idx + delta]
    if (!target) return
    // Move the roving tab stop so Tab/Shift+Tab re-enter at the last cell.
    cell.tabIndex = -1
    target.tabIndex = 0
    target.focus()
  }, [])

  const [activeEvent, setActiveEvent] = useState<CalendarEvent | null>(null)
  const [activeLayout, setActiveLayout] = useState<{
    compact: boolean
    monthView: boolean
    dotMode: boolean
    isMobileMonth: boolean
  }>({ compact: false, monthView: false, dotMode: false, isMobileMonth: false })
  const draggedEventRef = useRef<CalendarEvent | null>(null)
  const [scale, setScale] = useState(1)
  const isMobile = useIsMobile()
  const isCompactMobile = useIsCompactMobile()
  const isTallWindow = useIsTallWindow()
  const isWideWindow = useIsWideWindow()
  const isPortraitWindow = useIsPortraitWindow()
  const showAgendaSplit =
    agendaBelowMonthEnabled && ((isTallWindow && isPortraitWindow) || isCompactMobile)
  const [bottomPanelDay, setBottomPanelDay] = useState<string | null>(null)
  const [splitRatio, setSplitRatio] = useState(monthAgendaSplitRatioSetting)
  const [gridRatio, setGridRatio] = useState(monthAgendaGridRatioSetting)
  const gridRatioRef = useRef(gridRatio)
  const splitRatioRef = useRef(splitRatio)
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentDateRef = useRef(currentDate)
  const containerRef = useRef<HTMLDivElement>(null)
  // Track active resize listeners for cleanup on unmount
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  // Journal day modal state (from global store)
  // The journal modal itself is rendered once, globally, in App.tsx — a second
  // copy here sat exactly on top of it and only became visible once the sheet
  // could be dragged away from it.
  const openJournalModal = useCalendarStore((state) => state.openJournalModal)
  const closeJournalModal = useCalendarStore((state) => state.closeJournalModal)

  useEffect(() => {
    currentDateRef.current = currentDate
  }, [currentDate])

  // Keep the open bottom-panel day in sync when currentDate changes elsewhere
  // (e.g. sidebar mini-calendar tap), so the split view doesn't get stuck on a stale day.
  useEffect(() => {
    setBottomPanelDay((prev) => (prev !== null && prev !== currentDate ? currentDate : prev))
  }, [currentDate])

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 8 },
    }),
    // Touch needs a hold delay rather than a distance threshold: distance alone
    // races against the card's own long-press-for-context-menu timer (and the
    // browser's native long-press-to-select-text gesture), and usually loses,
    // which is why holding a card to drag it was acting like a right-click.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    })
  )

  // Clean up resize listeners on unmount
  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.()
    }
  }, [])

  const changeMonth = useCallback(
    (direction: 'up' | 'down') => {
      // Read directly from the store to avoid lagging ref values
      const currentDate = useCalendarStore.getState().currentDate
      if (direction === 'down') {
        setCurrentDate(format(addMonths(parseISO(currentDate), 1), 'yyyy-MM-dd'))
      } else if (direction === 'up') {
        setCurrentDate(format(subMonths(parseISO(currentDate), 1), 'yyyy-MM-dd'))
      }
    },
    [setCurrentDate]
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleWheel = (e: WheelEvent): void => {
      if (e.ctrlKey) {
        // Zoom: Ctrl+scroll on the calendar grid
        e.preventDefault()
        const delta = e.deltaY > 0 ? -0.1 : 0.1
        setScale((s) => Math.min(Math.max(s + delta, 1), 1.5))
        return
      }

      // Month navigation: scroll on the calendar grid (not window, to avoid blocking page scroll)
      if (isOverlayOpen) return
      if (scrollCooldownRef.current) return
      if (Math.abs(e.deltaY) < 20) return

      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }

      const direction = e.deltaY > 0 ? 'down' : 'up'

      scrollCooldownRef.current = setTimeout(() => {
        scrollCooldownRef.current = null
      }, 400)

      scrollTimeoutRef.current = setTimeout(() => {
        changeMonth(direction)
      }, 0)
    }

    container.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      container.removeEventListener('wheel', handleWheel)
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
      if (scrollCooldownRef.current) {
        clearTimeout(scrollCooldownRef.current)
      }
    }
  }, [changeMonth, isOverlayOpen])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      // Ignore if typing in an input, textarea, select, or contentEditable element
      const target = e.target as HTMLElement
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target.isContentEditable
      ) {
        return
      }
      if (isOverlayOpen) return

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
  }, [changeMonth, isOverlayOpen])

  const { markDragStart, markDragEnd } = useDragDuplicateModifier()

  const handleDragStart = (event: DragStartEvent): void => {
    hapticIfEnabled('light')
    // A card's own context menu can still be open (e.g. a long-press-hold that
    // didn't move far enough to count as a drag yet) when a new drag starts —
    // close it instead of leaving it floating over the grid mid-drag.
    useContextMenuStore.getState().closeMenu()
    // Fragment ids are `${eventId}::${day}`; strip the day suffix to find the
    // full underlying event.
    const eventId = String(event.active.id).split('::')[0]
    const draggedEvent = events.find((e) => e.id === eventId)
    draggedEventRef.current = draggedEvent || null
    setActiveEvent(draggedEvent || null)
    markDragStart(event.activatorEvent)
    const data = event.active.data.current as
      | { compact?: boolean; monthView?: boolean; dotMode?: boolean; isMobileMonth?: boolean }
      | undefined
    setActiveLayout({
      compact: !!data?.compact,
      monthView: !!data?.monthView,
      dotMode: !!data?.dotMode,
      isMobileMonth: !!data?.isMobileMonth,
    })
  }

  const handleDragEnd = async (event: DragEndEvent): Promise<void> => {
    const { active, over } = event
    const shouldDuplicate = useDragModifierStore.getState().isDuplicateModifierHeld
    markDragEnd()
    setActiveEvent(null)

    if (!over) return

    const droppableId = String(over.id)
    const dayStr = droppableId

    if (!dayStr) return

    const originalEvent = draggedEventRef.current
    draggedEventRef.current = null
    if (!originalEvent) return
    // Defensive: dnd-kit's useDraggable is disabled on recurring events, but
    // if some other code path triggers a drop on a recurring event, refuse
    // rather than silently moving the whole series.
    if (originalEvent.recurrence || originalEvent.rruleString) return

    // Fragment ids are `${eventId}::${grabbedDay}`. When a multi-day event is
    // dragged by a fragment other than its first day, shift the drop target back
    // by that fragment's offset from the start so the whole span moves as one.
    const [activeId, grabbedDay] = String(active.id).split('::')

    const originalStart = parseISO(originalEvent.start)
    const originalEnd = parseISO(originalEvent.end)
    const durationMs = originalEnd.getTime() - originalStart.getTime()

    let targetDayStr = dayStr
    if (grabbedDay) {
      const offset = differenceInCalendarDays(parseISO(grabbedDay), originalStart)
      targetDayStr = format(addDays(parseISO(dayStr), -offset), 'yyyy-MM-dd')
    }

    const hours = pad2(originalStart.getHours())
    const minutes = pad2(originalStart.getMinutes())
    const newStart = parseISO(`${targetDayStr}T${hours}:${minutes}:00`)
    const newEnd = new Date(newStart.getTime() + durationMs)

    const isTask = originalEvent.type === 'task'

    // For tasks, preserve the time in dueDate if it exists
    let newDueDate = dayStr
    if (isTask && originalEvent.dueDate) {
      const originalDueDate = parseISO(originalEvent.dueDate)
      const hasTime =
        originalEvent.dueDate.includes('T') &&
        !originalEvent.dueDate.endsWith('T00:00:00') &&
        !originalEvent.dueDate.endsWith('T00:00')

      if (hasTime) {
        const timeHours = pad2(originalDueDate.getHours())
        const timeMinutes = pad2(originalDueDate.getMinutes())
        newDueDate = `${dayStr}T${timeHours}:${timeMinutes}:00`
      }
    }

    const updates = {
      start: newStart.toISOString(),
      end: newEnd.toISOString(),
      ...(isTask && { dueDate: newDueDate }),
    }

    if (shouldDuplicate) {
      const newId = duplicateEvent(originalEvent.id, false)
      if (!newId) return
      storeUpdateEvent(newId, updates)
      return
    }

    storeUpdateEvent(activeId, updates)

    await safeCalDAVUpdate(
      caldavUpdateEvent,
      originalEvent.calendarId,
      { ...originalEvent, ...updates },
      updates,
      'Failed to sync dragged event'
    )
  }

  const weekdays = useMemo(() => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const idx = firstDayOfWeek || 0
    return [...days.slice(idx), ...days.slice(0, idx)]
  }, [firstDayOfWeek])

  const date = useMemo(() => parseISO(currentDate), [currentDate])

  const days = useMemo(() => {
    const monthStart = startOfMonth(date)
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: firstDayOfWeek })
    let calendarEnd = endOfWeek(endOfMonth(date), { weekStartsOn: firstDayOfWeek })

    const currentDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd })

    return currentDays
  }, [date, firstDayOfWeek])

  const numWeeks = Math.floor(days.length / 7)

  const weekNumbers = useMemo(() => {
    return Array.from({ length: numWeeks }, (_, i) => getISOWeek(days[i * 7]))
  }, [numWeeks, days])

  const eventsMap = useMemo(() => {
    // Query the full visible grid range (incl. leading/trailing days from the
    // previous/next month) so events that fall on those spillover days render.
    const monthStart = startOfMonth(date)
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: firstDayOfWeek })
    const calendarEnd = endOfWeek(endOfMonth(date), { weekStartsOn: firstDayOfWeek })
    const visibleEvents = getEventsForDateRange(
      format(calendarStart, 'yyyy-MM-dd'),
      format(calendarEnd, 'yyyy-MM-dd')
    )

    const map = new Map<string, CalendarEvent[]>()
    const gridEvents = visibleEvents.filter(
      (event) => event.type !== 'task' && event.type !== 'journal'
    )

    // A multi-day event is split into one fragment per day, and each day cell
    // stacks its own fragments top-to-bottom. Without a row reserved for the
    // whole span, two overlapping multi-day events can swap order between
    // adjacent days and the pill visually breaks apart. So assign every span a
    // lane up front: longest spans on top, earlier start wins a tie.
    const spans = gridEvents
      .map((event) => {
        const startKey = format(parseISO(event.start), 'yyyy-MM-dd')
        const endKey = format(parseISO(event.end), 'yyyy-MM-dd')
        return { event, startKey, endKey }
      })
      .filter(({ startKey, endKey }) => startKey !== endKey)
      .map((span) => ({
        ...span,
        days: eachDayOfInterval({
          start: startOfDay(parseISO(span.event.start)),
          end: startOfDay(parseISO(span.event.end)),
        }).map((d) => format(d, 'yyyy-MM-dd')),
      }))
      .sort((a, b) => {
        if (a.days.length !== b.days.length) return b.days.length - a.days.length
        if (a.startKey !== b.startKey) return a.startKey < b.startKey ? -1 : 1
        return a.event.id < b.event.id ? -1 : 1
      })

    const laneOccupancy: Set<string>[] = []
    const laneOf = new Map<string, number>()
    spans.forEach(({ event, days }) => {
      let lane = 0
      while (lane < laneOccupancy.length && days.some((d) => laneOccupancy[lane].has(d))) lane++
      if (lane === laneOccupancy.length) laneOccupancy.push(new Set())
      days.forEach((d) => laneOccupancy[lane].add(d))
      laneOf.set(event.id, lane)
    })

    gridEvents.forEach((event) => {
      const eventStart = parseISO(event.start)
      const eventEnd = parseISO(event.end)
      const startKey = format(eventStart, 'yyyy-MM-dd')
      const endKey = format(eventEnd, 'yyyy-MM-dd')

      if (startKey === endKey) {
        const eventDate = format(eventStart, 'yyyy-MM-dd')
        const existing = map.get(eventDate) || []
        map.set(eventDate, [...existing, event])
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
            laneIndex: laneOf.get(event.id),
            originalStart: event.start,
            originalEnd: event.end,
          }
          const dayEvents = map.get(dayKey) || []
          map.set(dayKey, [...dayEvents, fragment])
          currentDay = addDays(currentDay, 1)
        }
      }
    })

    map.forEach((events, dateKey) => {
      const sorted = [...events].sort((a, b) => {
        if (a.isFragment && !b.isFragment) return -1
        if (!a.isFragment && b.isFragment) return 1
        if (a.isFragment && b.isFragment) return (a.laneIndex ?? 0) - (b.laneIndex ?? 0)
        return new Date(a.start).getTime() - new Date(b.start).getTime()
      })
      map.set(dateKey, sorted)
    })

    return map
  }, [
    date,
    firstDayOfWeek,
    events,
    rangeExpansionVersion,
    calendars,
    selectedCategoryNames,
    getEventsForDateRange,
  ])

  // Looks tasks up per visible day via the store's shared due-date index
  // instead of re-filtering the entire event array. The old version scanned
  // every stored event on every mutation, so its cost scaled with total
  // history rather than with the 42 cells actually on screen (issue #73).
  const tasksMap = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    const visibleCalendarIds = calendars.filter((c) => c.isVisible).map((c) => c.id)
    const taskCalendarsWithTasks = calendars
      .filter((c) => c.showTasksInViews !== false)
      .map((c) => c.id)
    for (const day of days) {
      const dayKey = format(day, 'yyyy-MM-dd')
      const dayTasks = getTasksDueOn(events, dayKey).filter(
        (event) =>
          visibleCalendarIds.includes(event.calendarId) &&
          taskCalendarsWithTasks.includes(event.calendarId) &&
          !(hideCompletedTasksInMonthView && event.completed) &&
          (selectedCategoryNames.length === 0 ||
            event.categories?.some((c) => selectedCategoryNames.includes(c)))
      )
      if (dayTasks.length > 0) map.set(dayKey, dayTasks)
    }
    return map
  }, [days, events, calendars, hideCompletedTasksInMonthView, selectedCategoryNames])

  // `events` and `rangeExpansionVersion` are both kept as deps for
  // defense-in-depth (see WeekView for the rationale). R4.1/R4.3 review fix.
  const journalDates = useMemo(() => getJournalDates(events), [events, rangeExpansionVersion])

  const handleGridResizeStart = (e: React.MouseEvent): void => {
    e.preventDefault()
    // Clean up any previous resize
    resizeCleanupRef.current?.()
    const startY = e.clientY
    const startRatio = gridRatio
    const containerHeight = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
      .height
    const onMove = (ev: MouseEvent): void => {
      const delta = (ev.clientY - startY) / containerHeight
      const next = Math.min(0.85, Math.max(0.35, startRatio + delta))
      gridRatioRef.current = next
      setGridRatio(next)
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      resizeCleanupRef.current = null
      updateSettings({ monthAgendaGridRatio: gridRatioRef.current })
    }
    resizeCleanupRef.current = onUp
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const handleGridResizeTouchStart = (e: React.TouchEvent): void => {
    e.preventDefault()
    resizeCleanupRef.current?.()
    const startY = e.touches[0].clientY
    const startRatio = gridRatio
    const containerHeight = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
      .height
    const onMove = (ev: TouchEvent): void => {
      const delta = (ev.touches[0].clientY - startY) / containerHeight
      const next = Math.min(0.85, Math.max(0.35, startRatio + delta))
      gridRatioRef.current = next
      setGridRatio(next)
    }
    const onEnd = (): void => {
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      resizeCleanupRef.current = null
      updateSettings({ monthAgendaGridRatio: gridRatioRef.current })
    }
    resizeCleanupRef.current = onEnd
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd)
  }

  const handleResizeStart = (e: React.MouseEvent): void => {
    e.preventDefault()
    // Clean up any previous resize
    resizeCleanupRef.current?.()
    const startX = e.clientX
    const startRatio = splitRatio
    const containerWidth = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
      .width
    const onMove = (ev: MouseEvent): void => {
      const delta = (ev.clientX - startX) / containerWidth
      const next = Math.min(0.85, Math.max(0.25, startRatio + delta))
      splitRatioRef.current = next
      setSplitRatio(next)
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      resizeCleanupRef.current = null
      updateSettings({ monthAgendaSplitRatio: splitRatioRef.current })
    }
    resizeCleanupRef.current = onUp
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const handleResizeTouchStart = (e: React.TouchEvent): void => {
    e.preventDefault()
    resizeCleanupRef.current?.()
    const startX = e.touches[0].clientX
    const startRatio = splitRatio
    const containerWidth = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
      .width
    const onMove = (ev: TouchEvent): void => {
      const delta = (ev.touches[0].clientX - startX) / containerWidth
      const next = Math.min(0.85, Math.max(0.25, startRatio + delta))
      splitRatioRef.current = next
      setSplitRatio(next)
    }
    const onEnd = (): void => {
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      resizeCleanupRef.current = null
      updateSettings({ monthAgendaSplitRatio: splitRatioRef.current })
    }
    resizeCleanupRef.current = onEnd
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd)
  }

  const handleDayClick = (day: Date): void => {
    const dateStr = format(day, 'yyyy-MM-dd')
    if (showAgendaSplit) {
      setCurrentDate(dateStr)
      setBottomPanelDay((prev) => (prev === dateStr ? null : dateStr))
    } else {
      openModal(dateStr)
    }
  }

  const handleDayDoubleClick = (day: Date): void => {
    setCurrentDate(format(day, 'yyyy-MM-dd'))
    setCurrentView('day')
    navigate(VIEW_ROUTES.day, { replace: true })
  }

  const handleDayNumberClick = (day: Date): void => {
    if (showAgendaSplit) {
      const dateStr = format(day, 'yyyy-MM-dd')
      setCurrentDate(dateStr)
      setBottomPanelDay((prev) => (prev === dateStr ? null : dateStr))
      return
    }
    setCurrentDate(format(day, 'yyyy-MM-dd'))
    setCurrentView('day')
    navigate(VIEW_ROUTES.day, { replace: true })
  }

  // Hoisted out of the day-cell JSX: these were rebuilt per render and handed
  // to all 42 memoized DroppableDays, so their memo never held. See #73.
  const handleJournalIndicatorClick = useCallback(
    (day: Date): void => {
      openJournalModal(format(day, 'yyyy-MM-dd'))
    },
    [openJournalModal]
  )

  const handleOpenJournalModal = useCallback(
    (date: string): void => {
      // Force reset: close first, then reopen on next tick (#24)
      closeJournalModal()
      requestAnimationFrame(() => {
        openJournalModal(date, true)
      })
    },
    [closeJournalModal, openJournalModal]
  )

  const handleWeekClick = (weekStart: Date): void => {
    setCurrentDate(format(weekStart, 'yyyy-MM-dd'))
    setCurrentView('week')
    navigate(VIEW_ROUTES.week, { replace: true })
  }

  const rowHeight = Math.round(100 * scale)

  // Month change animation. On a phone the gesture is a horizontal swipe, so
  // the grid travels horizontally to match the finger — the incoming month
  // enters from the side you swiped towards. Pointer/wheel navigation on
  // desktop stays vertical, matching the scroll that drives it.
  // Directional transition when the calendar moves to another month.
  const monthChangeMotion = useDateChangeMotion(currentDate.slice(0, 7))

  // In the month+agenda split the grid gets a fixed share of the height, but
  // its content doesn't: a 6-week month is a whole row taller than a 5-week
  // one, and compressed past weeks change it again. When the share came up
  // short the grid just scrolled (`.grid` is `overflow: auto`), hiding days.
  // So the share becomes a floor-and-ceiling instead: never shorter than the
  // weeks actually need, never so tall the agenda is squeezed out.
  const AGENDA_MIN_SHARE = 0.25
  const splitContainerRef = useRef<HTMLDivElement>(null)
  const gridTopRef = useRef<HTMLDivElement>(null)
  const gridScrollRef = useRef<HTMLDivElement>(null)
  const [gridMinHeight, setGridMinHeight] = useState(0)
  const hasMeasuredRef = useRef(false)
  const rafRef = useRef(0)

  useLayoutEffect(() => {
    if (!showAgendaSplit) {
      setGridMinHeight(0)
      hasMeasuredRef.current = false
      return
    }
    const measure = (): void => {
      const top = gridTopRef.current
      const scroller = gridScrollRef.current
      const container = splitContainerRef.current
      if (!top || !scroller || !container) return
      // What the weeks need has to be read off real layout — the cells size to
      // their content (a row of dots is nothing like a row of event chips), so
      // deriving it from the cell-height setting badly overestimated. Drop the
      // floor and read the overflow in one synchronous pass: `useLayoutEffect`
      // plus the forced reflow means the collapsed state never reaches the
      // screen, and the transition is off so it can't animate through it.
      const restoreTransition = top.style.transition
      const restoreMinHeight = top.style.minHeight
      const restoreSlideX = scroller.style.getPropertyValue('--slide-x')
      const restoreSlideY = scroller.style.getPropertyValue('--slide-y')

      top.style.transition = 'none'
      top.style.minHeight = '0px'
      scroller.style.setProperty('--slide-x', '0px')
      scroller.style.setProperty('--slide-y', '0px')
      void top.offsetHeight
      // Chrome around the scroll area (panel borders, margins) that the grid's
      // own scrollHeight doesn't account for.
      const chrome = top.offsetHeight - scroller.clientHeight
      const needed = scroller.scrollHeight + chrome
      
      top.style.minHeight = restoreMinHeight
      scroller.style.setProperty('--slide-x', restoreSlideX)
      scroller.style.setProperty('--slide-y', restoreSlideY)
      // Put the old height back and commit it *before* re-enabling the
      // transition. The forced reflow above leaves 0px as the element's
      // committed value, so restoring the transition first made the browser
      // animate from a collapsed grid — the divider snapping to the top and
      // easing back down on every month change. Two reflows, one to measure
      // and one to restore, keep the animation running old height → new.
      void top.offsetHeight
      top.style.transition = restoreTransition
      
      // Leave the agenda a usable share even in a 6-week month.
      const cap = container.clientHeight * (1 - AGENDA_MIN_SHARE)
      const next = Math.min(needed, cap)
      
      if (!hasMeasuredRef.current) {
        // First run: no previous height to travel from, so don't defer.
        hasMeasuredRef.current = true
        setGridMinHeight(next)
        return
      }
      // Applying the new height here would land in the same commit as the
      // measurement, before the browser has painted the old one — leaving
      // nothing to transition from, so the change was instant. Waiting a frame
      // lets the old height paint, and the transition then runs from it.
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => setGridMinHeight(next))
    }
    measure()
    const container = splitContainerRef.current
    if (!container) return
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(rafRef.current)
    }
  }, [
    showAgendaSplit,
    currentDate,
    weekNumbers,
    days,
    compressPastWeeks,
    rowHeight,
    eventsMap,
    tasksMap,
  ])

  if (showAgendaSplit) {
    return (
      <>
        <div className={styles.splitContainer} ref={splitContainerRef}>
          <div
            ref={gridTopRef}
            className={styles.gridTop}
            style={{
              flex: `0 0 ${gridRatio * 100}%`,
              minHeight: gridMinHeight || undefined,
              maxHeight: (800 * gridRatio) / 0.6,
            }}
          >
            <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
              <div className={styles.gridPanel} ref={containerRef} {...bind}>
                <div
                  ref={gridScrollRef}
                  className={styles.grid}
                  data-component="calendar-grid"
                  onKeyDown={handleGridKeyDown}
                  style={
                    {
                      '--day-cell-height': `${rowHeight}px`,
                      '--slide-x': monthChangeMotion.initial ? `${monthChangeMotion.initial.x || 0}px` : '0px',
                      '--slide-y': monthChangeMotion.initial ? `${monthChangeMotion.initial.y || 0}px` : '0px',
                      touchAction: 'none',
                    } as React.CSSProperties
                  }
                >
                  <div
                    className={`${styles.header} ${!showWeekNumbers ? styles.headerNoWeekNum : ''}`}
                  >
                    {showWeekNumbers && <div className={styles.weekNumHeader}>W#</div>}
                    {weekdays.map((day) => (
                      <div key={day} className={styles.weekday}>
                        {day}
                      </div>
                    ))}
                  </div>
                  <div className={styles.daysContainer}>
                    {weekNumbers.map((weekNum, weekIdx) => {
                      const weekEnd = days[weekIdx * 7 + 6]
                      const today = startOfDay(new Date())
                      const isPastWeek = compressPastWeeks && isBefore(weekEnd, today)

                      return (
                        <div
                          key={weekIdx}
                          className={`${styles.weekRow} ${!showWeekNumbers ? styles.weekRowNoWeekNum : ''} ${isPastWeek ? styles.compressedWeek : ''}`}
                        >
                            {showWeekNumbers && (
                              <div
                                className={styles.weekNumber}
                                onClick={() => handleWeekClick(days[weekIdx * 7])}
                              >
                                <div
                                  key={weekNum}
                                  className={styles.dayContentSlide}
                                  style={{
                                    width: '100%',
                                    height: '100%',
                                    display: 'flex',
                                    justifyContent: 'center',
                                    alignItems: 'flex-start',
                                    '--slide-x': monthChangeMotion.initial ? `${monthChangeMotion.initial.x || 0}px` : '0px',
                                    '--slide-y': monthChangeMotion.initial ? `${monthChangeMotion.initial.y || 0}px` : '0px',
                                  } as React.CSSProperties}
                                >
                                  {weekNum}
                                </div>
                              </div>
                            )}
                            {days.slice(weekIdx * 7, weekIdx * 7 + 7).map((day, idx) => {
                              const dateKey = format(day, 'yyyy-MM-dd')
                              const dayEvents = eventsMap.get(dateKey) || []
                              const dayTasks = tasksMap.get(dateKey) || []
                              const isCurrentMonth = isSameMonth(day, date)
                              const isTodayDate = isToday(day)
                              const dayOfWeek = getDay(day)
                              const isWeekend = dayOfWeek === 0 || dayOfWeek === 6

                              return (
                                <DroppableDay
                                  key={idx}
                                  dateKey={dateKey}
                                  day={day}
                                  monthChangeMotion={monthChangeMotion}
                                  dayEvents={dayEvents}
                                  dayTasks={dayTasks}
                                  hasJournal={journalDates.has(dateKey)}
                                  journalEnabled={journalEnabled}
                                  isCurrentMonth={isCurrentMonth}
                                  isTodayDate={isTodayDate}
                                  isFocusAnchor={dateKey === currentDate}
                                  isWeekend={isWeekend}
                                  isPastWeek={isPastWeek}
                                  compactRecurringEvents={compactRecurringEvents}
                                  monthViewEventLimit={monthViewEventLimit}
                                  isMobile={isMobile}
                                  isCompactMobile={isCompactMobile}
                                  onDayClick={handleDayClick}
                                  onDayDoubleClick={handleDayDoubleClick}
                                  onDayNumberClick={handleDayNumberClick}
                                  onJournalIndicatorClick={handleJournalIndicatorClick}
                                  onOpenJournalModal={handleOpenJournalModal}
                                  openModal={openModal}
                                />
                              )
                            })}
                          </div>
                        )
                      })}
                  </div>
                </div>
              </div>
              <DragOverlay dropAnimation={null}>
                {activeEvent ? (
                  <EventCard
                    event={activeEvent}
                    compact={activeLayout.compact}
                    monthView={activeLayout.monthView}
                    dotMode={activeLayout.dotMode}
                    isMobileMonth={activeLayout.isMobileMonth}
                    enableResize={false}
                  />
                ) : null}
              </DragOverlay>
            </DndContext>
          </div>
          <div
            className={styles.splitHandleH}
            onMouseDown={handleGridResizeStart}
            onTouchStart={handleGridResizeTouchStart}
          />
          <div className={styles.agendaBottom} style={{ flex: 1 }}>
            {bottomPanelDay ? (
              isWideWindow ? (
                <>
                  <div className={styles.splitDay} style={{ flex: `0 0 ${splitRatio * 100}%` }}>
                    <DayView key={bottomPanelDay} selectedDate={bottomPanelDay} />
                  </div>
                  <div
                    className={styles.splitHandle}
                    onMouseDown={handleResizeStart}
                    onTouchStart={handleResizeTouchStart}
                  />
                  <div className={styles.splitAgenda} style={{ flex: 1 }}>
                    <AgendaView embedded />
                  </div>
                </>
              ) : (
                <DayView
                  key={bottomPanelDay}
                  selectedDate={bottomPanelDay}
                  onBack={isCompactMobile ? () => setBottomPanelDay(null) : undefined}
                />
              )
            ) : (
              <AgendaView embedded />
            )}
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className={styles.gridPanel} ref={containerRef} {...bind}>
          <div
            className={styles.grid}
            data-component="calendar-grid"
            onKeyDown={handleGridKeyDown}
            style={
              { 
                '--day-cell-height': `${rowHeight}px`, 
                '--slide-x': monthChangeMotion.initial ? `${monthChangeMotion.initial.x || 0}px` : '0px',
                '--slide-y': monthChangeMotion.initial ? `${monthChangeMotion.initial.y || 0}px` : '0px',
                touchAction: 'none' 
              } as React.CSSProperties
            }
          >
            <div className={`${styles.header} ${!showWeekNumbers ? styles.headerNoWeekNum : ''}`}>
              {showWeekNumbers && <div className={styles.weekNumHeader}>W#</div>}
              {weekdays.map((day) => (
                <div key={day} className={styles.weekday}>
                  {day}
                </div>
              ))}
            </div>
            <div className={styles.daysContainer}>
              {weekNumbers.map((weekNum, weekIdx) => {
                const weekEnd = days[weekIdx * 7 + 6]
                const today = startOfDay(new Date())
                const isPastWeek = compressPastWeeks && isBefore(weekEnd, today)

                return (
                  <div
                    key={weekIdx}
                    className={`${styles.weekRow} ${!showWeekNumbers ? styles.weekRowNoWeekNum : ''} ${isPastWeek ? styles.compressedWeek : ''}`}
                  >
                      {showWeekNumbers && (
                        <div
                          className={styles.weekNumber}
                          onClick={() => handleWeekClick(days[weekIdx * 7])}
                        >
                          <AnimatePresence>
                            <motion.div
                              key={weekNum}
                              {...monthChangeMotion}
                              style={{
                                width: '100%',
                                height: '100%',
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'flex-start',
                              }}
                            >
                              {weekNum}
                            </motion.div>
                          </AnimatePresence>
                        </div>
                      )}
                      {days.slice(weekIdx * 7, weekIdx * 7 + 7).map((day, idx) => {
                        const dateKey = format(day, 'yyyy-MM-dd')
                        const dayEvents = eventsMap.get(dateKey) || []
                        const dayTasks = tasksMap.get(dateKey) || []
                        const isCurrentMonth = isSameMonth(day, date)
                        const isTodayDate = isToday(day)
                        const dayOfWeek = getDay(day)
                        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6

                        return (
                          <DroppableDay
                            key={idx}
                            dateKey={dateKey}
                            day={day}
                            monthChangeMotion={monthChangeMotion}
                            dayEvents={dayEvents}
                            dayTasks={dayTasks}
                            hasJournal={journalDates.has(dateKey)}
                            journalEnabled={journalEnabled}
                            isCurrentMonth={isCurrentMonth}
                            isTodayDate={isTodayDate}
                            isFocusAnchor={dateKey === currentDate}
                            isWeekend={isWeekend}
                            isPastWeek={isPastWeek}
                            compactRecurringEvents={compactRecurringEvents}
                            monthViewEventLimit={monthViewEventLimit}
                            isMobile={isMobile}
                            isCompactMobile={isCompactMobile}
                            onDayClick={handleDayClick}
                            onDayDoubleClick={handleDayDoubleClick}
                            onDayNumberClick={handleDayNumberClick}
                            onJournalIndicatorClick={handleJournalIndicatorClick}
                            onOpenJournalModal={handleOpenJournalModal}
                            openModal={openModal}
                          />
                        )
                      })}
                    </div>
                  )
                })}
            </div>
          </div>
        </div>
        <DragOverlay dropAnimation={null}>
          {activeEvent ? (
            <EventCard
              event={activeEvent}
              compact={activeLayout.compact}
              monthView={activeLayout.monthView}
              dotMode={activeLayout.dotMode}
              isMobileMonth={activeLayout.isMobileMonth}
              enableResize={false}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </>
  )
}

interface DroppableDayProps {
  monthChangeMotion: DateChangeMotion
  dateKey: string
  day: Date
  dayEvents: CalendarEvent[]
  dayTasks: CalendarEvent[]
  hasJournal: boolean
  journalEnabled: boolean
  isCurrentMonth: boolean
  isTodayDate: boolean
  isFocusAnchor: boolean
  isWeekend: boolean
  isPastWeek: boolean
  compactRecurringEvents: boolean
  monthViewEventLimit: number
  isMobile: boolean
  isCompactMobile: boolean
  onDayClick: (day: Date) => void
  onDayDoubleClick: (day: Date) => void
  onDayNumberClick: (day: Date) => void
  onJournalIndicatorClick: (day: Date) => void
  onOpenJournalModal: (date: string) => void
  openModal: (date?: string, endDate?: string, eventId?: string, mode?: 'event' | 'task') => void
}

const DroppableDay = React.memo(function DroppableDay({
  dateKey,
  day,
  monthChangeMotion,
  dayEvents,
  dayTasks,
  hasJournal,
  journalEnabled,
  isCurrentMonth,
  isTodayDate,
  isFocusAnchor,
  isWeekend,
  isPastWeek,
  compactRecurringEvents,
  monthViewEventLimit,
  isMobile,
  isCompactMobile,
  onDayClick,
  onDayDoubleClick,
  onDayNumberClick,
  onJournalIndicatorClick,
  onOpenJournalModal,
  openModal,
}: DroppableDayProps): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: dateKey })
  // Multi-day fragments carry a lane shared across every day they span, so a
  // fragment's vertical position must be identical in every cell for the pill
  // to read as one continuous band. Any lane a fragment doesn't occupy is
  // filled with a single-day event where one is available, and only falls back
  // to an empty spacer otherwise. A promoted single-day event is forced compact
  // — a full-height card would not fit the lane and would push the band down.
  // Both spacers and promotions happen after the `monthViewEventLimit` slice,
  // so neither consumes a visible slot nor skews the "+N more" count.
  const eventSlots = useMemo(() => {
    const visible = dayEvents.slice(0, monthViewEventLimit)
    const fragmentByLane = new Map<number, CalendarEvent>()
    const singles: CalendarEvent[] = []
    visible.forEach((event) => {
      const lane = event.isFragment ? (event.laneIndex ?? -1) : -1
      if (lane >= 0) fragmentByLane.set(lane, event)
      else singles.push(event)
    })

    const slots: Array<{ spacerKey: string } | { event: CalendarEvent; forceCompact: boolean }> = []
    const maxLane = fragmentByLane.size === 0 ? -1 : Math.max(...fragmentByLane.keys())
    let nextSingle = 0
    for (let lane = 0; lane <= maxLane; lane++) {
      const fragment = fragmentByLane.get(lane)
      if (fragment) slots.push({ event: fragment, forceCompact: true })
      else if (nextSingle < singles.length)
        slots.push({ event: singles[nextSingle++], forceCompact: true })
      else slots.push({ spacerKey: `${dateKey}-spacer-${lane}` })
    }
    singles.slice(nextSingle).forEach((event) => slots.push({ event, forceCompact: false }))
    return slots
  }, [dayEvents, monthViewEventLimit, dateKey])
  const [showPopup, setShowPopup] = useState(false)
  const [popupPosition, setPopupPosition] = useState({ x: 0, y: 0 })
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const moreEventsRef = useRef<HTMLButtonElement>(null)
  // Shared event-card enter transition for the month view. Collapses
  // to 0ms when the user prefers reduced motion (matches the view-
  // transition pattern below).
  const prefersReducedMotion = useReducedMotion()
  const eventCardTransition = {
    duration: prefersReducedMotion ? 0 : 0.18,
    ease: 'easeOut' as const,
  }
  // Reduced-motion handling matches the DayView / WeekDayColumn pattern:
  // skip `initial` entirely and use an opacity-only exit (no scale).
  const cardInitial = prefersReducedMotion ? false : { opacity: 0, scale: 0.95 }
  const cardExit = prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95 }
  // Skip the exit animation when this event is the active drag — the
  // DragOverlay already shows the move visually, and the source exit
  // reads as a ghostly "jump back" to the original position. Multi-day
  // fragment draggables use `${event.id}::${date}` so strip the date
  // suffix to compare against `event.id`.
  const { active } = useDndContext()
  const activeMasterId = active ? active.id.toString().split('::')[0] : null
  const skipExit = (id: string): boolean => activeMasterId === id

  const handleMoreEventsClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (moreEventsRef.current) {
      const rect = moreEventsRef.current.getBoundingClientRect()
      setPopupPosition({ x: rect.left, y: rect.bottom + 4 })
    }
    setShowPopup(true)
  }

  const handlePopupEventClick = (event: CalendarEvent): void => {
    setShowPopup(false)
    openModal(undefined, undefined, event.id)
  }

  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  return (
    <motion.div
      ref={setNodeRef}
      className={`${styles.day} ${!isCurrentMonth ? styles.otherMonth : ''} ${isTodayDate ? styles.today : ''} ${isWeekend ? styles.weekend : ''} ${isOver ? styles.dropTarget : ''}`}
      {...(isTodayDate ? { 'data-today': '' } : {})}
      {...(!isCurrentMonth ? { 'data-other-month': '' } : {})}
      {...(isWeekend ? { 'data-weekend': '' } : {})}
      {...(isOver ? { 'data-drop-target': '' } : {})}
      role="button"
      tabIndex={isFocusAnchor ? 0 : -1}
      aria-label={format(day, 'EEEE, MMMM d, yyyy')}
      data-date={dateKey}
      onClick={() => onDayClick(day)}
      onDoubleClick={() => onDayDoubleClick(day)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onDayClick(day)
        }
      }}
      onContextMenu={handleContextMenu}
    >
      <div
        key={dateKey}
        className={styles.dayContentSlide}
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minWidth: 0,
          height: '100%',
        }}
      >
          <div className={styles.dayHeader}>
            <button
              className={styles.dayNumber}
              onClick={(e) => {
                e.stopPropagation()
                onDayNumberClick(day)
              }}
              aria-label={`Open ${format(day, 'EEEE, MMMM d')} in day view`}
            >
              {format(day, 'd')}
            </button>
            {journalEnabled && hasJournal && (
              <button
                className={styles.journalIndicator}
                title="View journal entries"
                aria-label={`View journal entries for ${format(day, 'MMMM d')}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onJournalIndicatorClick(day)
                }}
              >
                <span className={styles.journalIndicatorDot} />
                <svg
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z" />
                  <path d="M7.5 4.5l2 2" />
                </svg>
              </button>
            )}
          </div>
          {isCompactMobile ? (
            <div className={styles.dotRow}>
              <AnimatePresence initial={false}>
                {dayEvents.slice(0, monthViewEventLimit).map((event) => {
                  const isMultiDay = !isSameDay(parseISO(event.start), parseISO(event.end))
                  const shouldCompact =
                    isPastWeek ||
                    (compactRecurringEvents &&
                      (!!event.rruleString ||
                        !!event.recurrence ||
                        event.isAllDay ||
                        isMultiDay)) ||
                    event.isFragment
                  return (
                    <motion.div
                      key={event.id}
                      variants={eventCardVariants}
                      initial={monthChangeMotion.initial ? false : cardInitial}
                      animate="animate"
                      exit={skipExit(event.id) ? undefined : cardExit}
                      transition={eventCardTransition}
                    >
                      <EventCard
                        event={event}
                        compact={shouldCompact}
                        isMobileMonth={isMobile}
                        dotMode
                        enableResize={false}
                        monthView
                      />
                    </motion.div>
                  )
                })}
                {dayTasks.slice(0, monthViewEventLimit).map((task) => (
                  <motion.div
                    key={task.id}
                    variants={eventCardVariants}
                    initial={cardInitial}
                    animate="animate"
                    exit={skipExit(task.id) ? undefined : cardExit}
                    transition={eventCardTransition}
                  >
                    <EventCard
                      event={task}
                      compact
                      isMobileMonth={isMobile}
                      dotMode
                      enableResize={false}
                      monthView
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
              {(dayEvents.length > monthViewEventLimit ||
                dayTasks.length > monthViewEventLimit) && (
                <button
                  ref={moreEventsRef}
                  className={styles.moreEvents}
                  onClick={handleMoreEventsClick}
                >
                  +
                  {Math.max(0, dayEvents.length - monthViewEventLimit) +
                    Math.max(0, dayTasks.length - monthViewEventLimit)}
                </button>
              )}
            </div>
          ) : (
            <>
              {/*
            IMPORTANT: these wrappers must always render, even when
            dayEvents / dayTasks is empty. If we wrapped them in
            `{dayEvents.length > 0 && ...}`, deleting the LAST event
            on a day would flip the conditional false and the parent
            <div> (with its AnimatePresence) would unmount before
            framer-motion could run the exit animation. The empty
            container collapses to 0 height via flexbox (no visual
            impact). The compact-mobile branch above (line ~996)
            already does this — keeping the pattern consistent.
            The `+more` overflow button stays conditional so empty
            days don't show a stale "+0 more".
          */}
              <div className={styles.events}>
                <AnimatePresence initial={false}>
                  {eventSlots.map((slot) => {
                    if ('spacerKey' in slot) {
                      return <div key={slot.spacerKey} className={styles.eventSpacer} aria-hidden />
                    }
                    const { event } = slot
                    const isMultiDay = !isSameDay(parseISO(event.start), parseISO(event.end))
                    const shouldCompact =
                      slot.forceCompact ||
                      isPastWeek ||
                      (compactRecurringEvents &&
                        (!!event.rruleString ||
                          !!event.recurrence ||
                          event.isAllDay ||
                          isMultiDay)) ||
                      event.isFragment
                    return (
                      <motion.div
                        key={event.id}
                        variants={eventCardVariants}
                        initial={cardInitial}
                        animate="animate"
                        exit={skipExit(event.id) ? undefined : cardExit}
                        transition={eventCardTransition}
                      >
                        <EventCard
                          event={event}
                          compact={shouldCompact}
                          isMobileMonth={isMobile}
                          enableResize={false}
                          monthView
                        />
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
                {dayEvents.length > monthViewEventLimit && (
                  <button
                    ref={moreEventsRef}
                    className={styles.moreEvents}
                    onClick={handleMoreEventsClick}
                  >
                    +{dayEvents.length - monthViewEventLimit} more
                  </button>
                )}
              </div>
              <div className={styles.tasks} data-component="day-tasks">
                <AnimatePresence initial={false}>
                  {dayTasks.slice(0, monthViewEventLimit).map((task) => (
                    <motion.div
                      key={task.id}
                      variants={eventCardVariants}
                      initial={monthChangeMotion.initial ? false : cardInitial}
                      animate="animate"
                      exit={skipExit(task.id) ? undefined : cardExit}
                      transition={eventCardTransition}
                    >
                      <EventCard
                        event={task}
                        compact
                        isMobileMonth={isMobile}
                        enableResize={false}
                        monthView
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
                {dayTasks.length > monthViewEventLimit && (
                  <div className={styles.moreEvents}>
                    +{dayTasks.length - monthViewEventLimit} more
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      {showPopup && (
        <DayEventsPopup
          date={day}
          events={dayEvents}
          position={popupPosition}
          onClose={() => setShowPopup(false)}
          onEventClick={handlePopupEventClick}
        />
      )}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          menuId={`day-${day.getTime()}`}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: 'Create event',
              onClick: () => {
                openModal(format(day, 'yyyy-MM-dd'))
                setContextMenu(null)
              },
            },
            {
              label: 'Create task',
              onClick: () => {
                openModal(format(day, 'yyyy-MM-dd'), undefined, undefined, 'task')
                setContextMenu(null)
              },
            },
            ...(journalEnabled
              ? [
                  {
                    label: 'New journal entry',
                    onClick: () => {
                      onOpenJournalModal(format(day, 'yyyy-MM-dd'))
                      setContextMenu(null)
                    },
                  },
                ]
              : []),
          ]}
        />
      )}
    </motion.div>
  )
})
