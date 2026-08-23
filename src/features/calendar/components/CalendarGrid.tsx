import type { JSX } from 'react'
import React, { useMemo, useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react'
import { useNavigate } from 'react-router'
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
  addDays,
  differenceInCalendarDays,
} from 'date-fns'
import { pad2, toEventInstant, toZoneWallClock } from '@/lib/datetime'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { getWeekdayLabels } from './weekdayLabels'
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
import {
  useMonthEventCapacity,
  fitMonthCell,
  type MonthCellCapacity,
  type MonthRowKind,
} from '@/hooks/useMonthEventCapacity'
import { useDragModifierStore } from '@/store/dragModifierStore'
import { useContextMenuStore } from '@/store/contextMenuStore'
import { useRovingGrid } from '@/hooks/useRovingGrid'
import { AgendaView } from './AgendaView'
import { DayView } from './DayView'
import type { CalendarEvent, ViewType } from '@/types'
import { getJournalDates, getTasksForDay } from '@/store/calendarStore'
import { hasDueTime } from '@/lib/events'
import { consumesVerticalScroll } from '@/lib/scrollChaining'
import styles from './CalendarGrid.module.css'
import { duplicateEventWithSync } from '@/lib/duplicateWithSync'
import { assignSpanLanes, compareDayEvents, makeDayFragments } from '../lib/multiDayFragments'
import { filterTasksByCollapsedAncestors } from '@/lib/taskTree'
import { useTaskCollapse } from '../hooks/useTaskCollapse'

// Module-level so `useRovingGrid`'s `handleKeyDown` stays referentially stable.
// ←/→ move one day, ↑/↓ move one week in the flattened cell list.
const gridDelta = (key: string): number | null =>
  key === 'ArrowLeft'
    ? -1
    : key === 'ArrowRight'
      ? 1
      : key === 'ArrowUp'
        ? -7
        : key === 'ArrowDown'
          ? 7
          : null

const DEFAULT_MONTH_AGENDA_GRID_RATIO = 0.4

// Shared by the button and span forms of the journal indicator (see the
// compact-mobile branch in DroppableDay).
const journalIndicatorIcon = (
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
)

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

/**
 * How long after a scroll that the content consumed to keep ignoring the wheel
 * for navigation. Covers the momentum tail of a trackpad flick, which keeps
 * firing events for a while after the scroller has hit its end.
 */
const SCROLL_CHAIN_QUIET_MS = 500

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
  const setCurrentDate = useCalendarStore((state) => state.setCurrentDate)
  const setCurrentView = useCalendarStore((state) => state.setCurrentView)
  const isOverlayOpen = useCalendarStore((state) => state.isOverlayOpen)
  const navigate = useNavigate()
  const firstDayOfWeek = useSettingsStore((state) => state.firstDayOfWeek)
  const language = useSettingsStore((state) => state.language)
  const compactRecurringEvents = useSettingsStore((state) => state.compactRecurringEvents ?? false)
  const compressPastWeeks = useSettingsStore((state) => state.compressPastWeeks ?? false)
  const monthViewEventLimit = useSettingsStore((state) => state.monthViewEventLimit ?? 0)
  const showWeekNumbers = useSettingsStore((state) => state.showWeekNumbers)
  const hideCompletedTasksInMonthView = useSettingsStore(
    (state) => state.hideCompletedTasksInMonthView ?? true
  )
  const journalEnabled = useSettingsStore((state) => state.journalEnabled)
  const agendaBelowMonthEnabled = useSettingsStore((state) => state.agendaBelowMonthEnabled)
  const monthAgendaGridRatioSetting = useSettingsStore((state) => state.monthAgendaGridRatio)
  const monthAgendaSplitRatioSetting = useSettingsStore((state) => state.monthAgendaSplitRatio)
  const updateSettings = useSettingsStore((state) => state.updateSettings)

  const { updateEvent: caldavUpdateEvent, createEvent: createCalDAVEvent } = useCalDAV()

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
  // week (handled by useRovingGrid, which also owns the roving tab stop). The
  // cell itself keeps its own Enter/Space handler that opens the focused day.
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
  const taskCollapse = useTaskCollapse(events)
  const showAgendaSplit =
    agendaBelowMonthEnabled && ((isTallWindow && isPortraitWindow) || isCompactMobile)
  // #79: `compressPastWeeks` shrinks a week row to make room by trading away
  // event-card detail. On compact mobile there is no detail to trade — the
  // cells are rows of dots — so compressing buys nothing and just leaves past
  // weeks cramped and unevenly sized. Row height only; `isPastWeek` still
  // drives card compactness at the render sites.
  const compressWeekRows = compressPastWeeks && !isCompactMobile
  const [bottomPanelDay, setBottomPanelDay] = useState<string | null>(null)
  const [splitRatio, setSplitRatio] = useState(monthAgendaSplitRatioSetting)
  const [gridRatio, setGridRatio] = useState(monthAgendaGridRatioSetting)
  // Month-view drag-to-create (desktop, all-day range across empty day
  // cells). Mirrors DayView/WeekView's mouse-driven create gesture but
  // produces a date-only range instead of a timed span. `dragEnd` is
  // mirrored in a ref so the window-level cleanup listeners (added while a
  // drag is in flight) read the latest value without being re-subscribed.
  const [createDragStart, setCreateDragStart] = useState<string | null>(null)
  const [createDragEnd, setCreateDragEnd] = useState<string | null>(null)
  const createDragStartRef = useRef<string | null>(null)
  const createDragEndRef = useRef<string | null>(null)
  const gridRatioRef = useRef(gridRatio)
  const lastGridTapRef = useRef(0)
  const splitRatioRef = useRef(splitRatio)
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastConsumedScrollRef = useRef(0)
  const currentDateRef = useRef(currentDate)
  const containerRef = useRef<HTMLDivElement>(null)
  // The scrolling month grid. Shared by the standalone view, the split view's
  // top half, and the roving-focus/keyboard and auto-capacity hooks that read
  // cells off it.
  const gridScrollRef = useRef<HTMLDivElement>(null)

  // Arrow-key roving focus across day cells: ←/→ move one day, ↑/↓ move one
  // week (handled by useRovingGrid, which also owns the roving tab stop). The
  // cell itself keeps its own Enter/Space handler that opens the focused day.
  const { handleKeyDown: handleGridKeyDown } = useRovingGrid(
    gridScrollRef,
    '[data-date]',
    gridDelta
  )

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

      const direction = e.deltaY > 0 ? 'down' : 'up'

      // A short window is the whole reason this check exists: the grid then
      // overflows its scroller, and every scroll to reach the bottom row also
      // flipped the month out from under the user. Reading the calendar takes
      // precedence — navigate only once the content has nowhere left to go
      // this way.
      if (consumesVerticalScroll(e.target, direction)) {
        lastConsumedScrollRef.current = Date.now()
        return
      }
      // Momentum from that scroll keeps firing after the edge is reached, so a
      // flick down to the last row would land on the next month regardless.
      // Ignore the tail; a deliberate second gesture still navigates.
      if (Date.now() - lastConsumedScrollRef.current < SCROLL_CHAIN_QUIET_MS) return

      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }

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

    // Phase 2 (C3) — baseline in the device frame so the drop target is the
    // instant the user sees; updateEvent re-frames it for TZID events.
    const originalStart = toEventInstant(originalEvent.start, originalEvent.timezone)
    const originalEnd = toEventInstant(originalEvent.end, originalEvent.timezone)
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
      const originalDueDate = toEventInstant(originalEvent.dueDate, originalEvent.timezone)
      const hasTime =
        originalEvent.dueDate.includes('T') &&
        !originalEvent.dueDate.endsWith('T00:00:00') &&
        !originalEvent.dueDate.endsWith('T00:00')

      if (hasTime) {
        const timeHours = pad2(originalDueDate.getHours())
        const timeMinutes = pad2(originalDueDate.getMinutes())
        // TZID tasks store their due time as the zone's wall clock.
        newDueDate = originalEvent.timezone
          ? toZoneWallClock(
              new Date(`${dayStr}T${timeHours}:${timeMinutes}:00`).toISOString(),
              originalEvent.timezone
            )
          : `${dayStr}T${timeHours}:${timeMinutes}:00`
      }
    }

    const updates = {
      start: newStart.toISOString(),
      end: newEnd.toISOString(),
      ...(isTask && { dueDate: newDueDate }),
    }

    if (shouldDuplicate) {
      duplicateEventWithSync({
        eventId: originalEvent.id,
        addCopySuffix: false,
        updates: updates,
        createCalDAVEvent,
      })
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

  const weekdays = useMemo(
    () => getWeekdayLabels(firstDayOfWeek || 0),
    [firstDayOfWeek, language]
  )

  const date = useMemo(() => parseISO(currentDate), [currentDate])

  const days = useMemo(() => {
    const monthStart = startOfMonth(date)
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: firstDayOfWeek })
    const calendarEnd = endOfWeek(endOfMonth(date), { weekStartsOn: firstDayOfWeek })

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
    // reserves the same lane for every fragment in a span.
    const laneOf = assignSpanLanes(gridEvents)

    gridEvents.forEach((event) => {
      const fragments = makeDayFragments(event, laneOf.get(event.id))
      fragments.forEach((fragment) => {
        const eventDate = format(toEventInstant(fragment.start, fragment.timezone), 'yyyy-MM-dd')
        const existing = map.get(eventDate) || []
        map.set(eventDate, [...existing, fragment])
      })
    })

    map.forEach((events, dateKey) => {
      map.set(dateKey, [...events].sort(compareDayEvents))
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
    for (const day of days) {
      const dayKey = format(day, 'yyyy-MM-dd')
      const dayTasks = getTasksForDay(events, dayKey).filter(
        (event) =>
          calendars.some((calendar) => calendar.isVisible && calendar.id === event.calendarId) &&
          calendars.some(
            (calendar) => calendar.showTasksInViews !== false && calendar.id === event.calendarId
          ) &&
          !(hideCompletedTasksInMonthView && event.completed) &&
          (selectedCategoryNames.length === 0 ||
            event.categories?.some((c) => selectedCategoryNames.includes(c)))
      )
      if (dayTasks.length > 0) map.set(dayKey, dayTasks)
    }
    return map
  }, [days, events, calendars, hideCompletedTasksInMonthView, selectedCategoryNames])

  const visibleTasksMap = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const [dayKey, dayTasks] of tasksMap) {
      const visibleTasks = filterTasksByCollapsedAncestors(
        dayTasks,
        events,
        taskCollapse.collapsedTaskIds
      )
      if (visibleTasks.length > 0) map.set(dayKey, visibleTasks)
    }
    return map
  }, [tasksMap, events, taskCollapse.collapsedTaskIds])

  // `events` and `rangeExpansionVersion` are both kept as deps for
  // defense-in-depth (see WeekView for the rationale). R4.1/R4.3 review fix.
  const journalDates = useMemo(
    () => getJournalDates(events, new Set(calendars.filter((c) => c.isVisible).map((c) => c.id))),
    [events, calendars, rangeExpansionVersion]
  )

  // Drive the drag straight to the DOM instead of through state. `gridRatio`
  // only feeds two inline styles on `gridTop`, but setting it re-renders the
  // whole grid — 42 cells and their event cards — on every pointer sample. On
  // compact mobile that was enough to make the divider stutter, while the same
  // height change on a month switch stayed smooth because it happens once.
  // Committing to React state is deferred to drag end, where one re-render is
  // free; `applyGridRatio` must keep producing the same values as the JSX.
  const applyGridRatio = (ratio: number): void => {
    const top = gridTopRef.current
    if (!top) return
    top.style.flex = `0 0 ${ratio * 100}%`
    top.style.maxHeight = `${(800 * ratio) / 0.6}px`
    // The measured content floor is useful for the initial layout, but it
    // must not win over a live drag. Otherwise dragging the divider upward
    // stops at the old floor and makes a second adjustment appear broken.
    top.style.minHeight = '0px'
  }

  // A re-render from anywhere else mid-drag (a store update, the height
  // measurement) rewrites both inline styles from the stale `gridRatio` and
  // snaps the divider back. Re-assert the live value after every commit while
  // a drag is in flight.
  const isDraggingGridRef = useRef(false)
  useLayoutEffect(() => {
    if (isDraggingGridRef.current) applyGridRatio(gridRatioRef.current)
  })

  const resetGridRatio = (): void => {
    isDraggingGridRef.current = false
    gridRatioRef.current = DEFAULT_MONTH_AGENDA_GRID_RATIO
    applyGridRatio(DEFAULT_MONTH_AGENDA_GRID_RATIO)
    setGridRatio(DEFAULT_MONTH_AGENDA_GRID_RATIO)
    updateSettings({ monthAgendaGridRatio: DEFAULT_MONTH_AGENDA_GRID_RATIO })
  }

  const handleGridResizeDoubleClick = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    resetGridRatio()
  }

  const handleGridResizeStart = (e: React.MouseEvent): void => {
    e.preventDefault()
    // Clean up any previous resize
    resizeCleanupRef.current?.()
    const startY = e.clientY
    const startRatio = gridRatioRef.current
    const containerHeight = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
      .height
    isDraggingGridRef.current = true
    const onMove = (ev: MouseEvent): void => {
      const delta = (ev.clientY - startY) / containerHeight
      const next = Math.min(0.85, Math.max(0.35, startRatio + delta))
      gridRatioRef.current = next
      applyGridRatio(next)
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      isDraggingGridRef.current = false
      resizeCleanupRef.current = null
      setGridRatio(gridRatioRef.current)
      updateSettings({ monthAgendaGridRatio: gridRatioRef.current })
    }
    resizeCleanupRef.current = onUp
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const handleGridResizeTouchStart = (e: React.TouchEvent): void => {
    // No `preventDefault()` here — React registers touch handlers passively, so
    // it never worked. `.splitHandleH { touch-action: none }` does the job.
    const now = Date.now()
    if (now - lastGridTapRef.current < 350) {
      lastGridTapRef.current = 0
      resetGridRatio()
      return
    }
    lastGridTapRef.current = now
    resizeCleanupRef.current?.()
    const startY = e.touches[0].clientY
    const startRatio = gridRatioRef.current
    const containerHeight = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
      .height
    isDraggingGridRef.current = true
    const onMove = (ev: TouchEvent): void => {
      // A moved touch is a drag, not the first half of a double-tap.
      lastGridTapRef.current = 0
      const delta = (ev.touches[0].clientY - startY) / containerHeight
      const next = Math.min(0.85, Math.max(0.35, startRatio + delta))
      gridRatioRef.current = next
      applyGridRatio(next)
    }
    const onEnd = (): void => {
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      // A cancelled touch never fires `touchend`, so without this the move
      // listener stays attached and the divider keeps tracking the finger.
      document.removeEventListener('touchcancel', onEnd)
      isDraggingGridRef.current = false
      resizeCleanupRef.current = null
      setGridRatio(gridRatioRef.current)
      updateSettings({ monthAgendaGridRatio: gridRatioRef.current })
    }
    resizeCleanupRef.current = onEnd
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd)
    document.addEventListener('touchcancel', onEnd)
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
      // A cancelled touch never fires `touchend`, so without this the move
      // listener stays attached and the divider keeps tracking the finger.
      document.removeEventListener('touchcancel', onEnd)
      resizeCleanupRef.current = null
      updateSettings({ monthAgendaSplitRatio: splitRatioRef.current })
    }
    resizeCleanupRef.current = onEnd
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd)
    document.addEventListener('touchcancel', onEnd)
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

  const handleDayClick = (day: Date): void => {
    // #79: on compact mobile a day cell is a single target. Tapping anywhere in
    // it — the number, empty space, or an event dot (whose own click is
    // disabled there, so the tap bubbles to here) — does what the number
    // already did. Wider viewports keep tap-to-create; on compact mobile that
    // lives on the long-press menu.
    if (isCompactMobile) {
      handleDayNumberClick(day)
      return
    }
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

  // Inclusive [min, max] bounds of the in-progress drag-to-create, used to
  // highlight the spanned day cells. Empty unless a drag is active.
  const createRange = useMemo(() => {
    if (!createDragStart || !createDragEnd) return null
    return createDragStart <= createDragEnd
      ? { min: createDragStart, max: createDragEnd }
      : { min: createDragEnd, max: createDragStart }
  }, [createDragStart, createDragEnd])

  // Begin a create-drag when the left mouse button goes down on empty day-cell
  // area. We deliberately ignore presses that start on an event card (so the
  // dnd-kit move keeps working), a button (day number / +more / journal), or
  // compact mobile (where tap-to-create lives on the long-press menu and touch
  // drives swipe navigation). These are plain functions, not `useCallback`:
  // they're only ever handed to the `daysContainer` div's own props (never to
  // the memoized `DroppableDay`), so memoizing them would buy nothing and
  // would trip the React Compiler's manual-memoization lint.
  const handleCreateDragStart = (e: React.MouseEvent<HTMLElement>): void => {
    if (isCompactMobile) return
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('[data-component="event-card"]')) return
    if (target.closest('button')) return
    const dateKey = (target.closest('[data-date]') as HTMLElement | null)?.dataset.date
    if (!dateKey) return
    createDragStartRef.current = dateKey
    createDragEndRef.current = dateKey
    setCreateDragStart(dateKey)
    setCreateDragEnd(dateKey)
  }

  // Track the day under the pointer. `elementFromPoint` resolves the cell even
  // when hovering an event card or the day-number button, because both are
  // descendants of the `[data-date]` cell.
  const handleCreateDragMove = (e: React.MouseEvent<HTMLElement>): void => {
    if (!createDragStartRef.current) return
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
    const cell = el?.closest('[data-date]') as HTMLElement | null
    const dateKey = cell?.dataset.date
    if (dateKey && dateKey !== createDragEndRef.current) {
      createDragEndRef.current = dateKey
      setCreateDragEnd(dateKey)
    }
  }

  // The window listener is the ONLY commit path. Container-level mouseup /
  // mouseleave handlers were wrong here: a held-button drag that leaves
  // `daysContainer` (up past the weekday header, down past the last row,
  // sideways past the week-number gutter) fires `mouseleave` and would commit
  // the range at that boundary, even though the user is still dragging. Going
  // through the window instead means the release is caught wherever it lands —
  // over the header, another app, or not at all when the OS cancels the
  // gesture. Window blur is treated as a cancel (no accidental create when
  // focus is lost mid-press). The commit/cancel logic is inlined here so the
  // effect only depends on `createDragStart` and `openModal` — both stable for
  // its lifetime — and doesn't re-subscribe on every pointer move.
  useEffect(() => {
    if (!createDragStart) return
    const onUp = (): void => {
      const start = createDragStartRef.current
      const end = createDragEndRef.current
      createDragStartRef.current = null
      createDragEndRef.current = null
      setCreateDragStart(null)
      setCreateDragEnd(null)
      if (start && end && start !== end) {
        openModal(start < end ? start : end, start < end ? end : start)
      }
    }
    const onCancel = (): void => {
      createDragStartRef.current = null
      createDragEndRef.current = null
      setCreateDragStart(null)
      setCreateDragEnd(null)
    }
    window.addEventListener('mouseup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('blur', onCancel)
    return () => {
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('blur', onCancel)
    }
  }, [createDragStart, openModal])

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

  // `monthViewEventLimit === 0` is the "Auto" setting: how many events a day
  // shows follows the cell's height instead of a fixed count. Two views opt
  // out. The month+agenda split sizes the grid to its own content, so a
  // capacity read off that height would chase itself; compact mobile draws
  // dots, not rows, so there is no row height to divide by.
  const monthLimitIsAuto = monthViewEventLimit === 0
  const autoLimitEnabled = monthLimitIsAuto && !showAgendaSplit && !isCompactMobile
  const compressedWeekCount = useMemo(() => {
    if (!compressWeekRows) return 0
    const today = startOfDay(new Date())
    return weekNumbers.reduce(
      (count, _weekNum, weekIdx) => (isBefore(days[weekIdx * 7 + 6], today) ? count + 1 : count),
      0
    )
  }, [compressWeekRows, weekNumbers, days])

  // The week-number column used to hold every row at the zoomed 100px floor,
  // even when the available viewport was shorter. That made the month grow
  // beyond its scroller on medium-height windows. Keep the zoom value as an
  // upper bound, but lower the floor to the row share the current grid can
  // actually accommodate. The compressed rows use half the full-row share,
  // matching their flex weight; their day cells still retain the 50px content
  // minimum used by the compressed styling.
  const [adaptiveRowFloor, setAdaptiveRowFloor] = useState(rowHeight)
  const measureAdaptiveRowFloor = useCallback((): void => {
    const grid = gridScrollRef.current
    if (!grid || weekNumbers.length === 0) return
    const header = grid.querySelector<HTMLElement>('[data-component="calendar-grid-header"]')
    const available = grid.clientHeight - (header?.offsetHeight ?? 0)
    if (available <= 0) return

    const compressed = Math.min(compressedWeekCount, weekNumbers.length)
    const weight = weekNumbers.length - compressed + compressed * 0.5
    const fullRowShare = available / weight
    const floorShare = compressed > 0 ? fullRowShare * 0.5 : fullRowShare
    const next = Math.max(0, Math.floor(Math.min(rowHeight, floorShare)))

    setAdaptiveRowFloor((previous) => (previous === next ? previous : next))
  }, [compressedWeekCount, rowHeight, weekNumbers.length])

  useLayoutEffect(() => {
    measureAdaptiveRowFloor()
    const grid = gridScrollRef.current
    if (!grid || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(measureAdaptiveRowFloor)
    observer.observe(grid)
    return () => observer.disconnect()
  }, [measureAdaptiveRowFloor])

  const autoCapacity = useMonthEventCapacity({
    enabled: autoLimitEnabled,
    gridRef: gridScrollRef,
    headerSelector: '[data-component="calendar-grid-header"]',
    weekCount: weekNumbers.length,
    compressedWeekCount,
    // Keep automatic event capacity aligned with the adaptive row floor. The
    // floor is lowered on short windows, so Auto can reduce the number of
    // cards before the grid needs to fall back to scrolling.
    rowHeightFloor: showWeekNumbers ? adaptiveRowFloor : 0,
  })
  // Auto is on but nothing has been measured yet (first paint, or a hidden
  // grid): fall back to the old default rather than rendering every event.
  const fixedEventLimit = monthLimitIsAuto ? 3 : monthViewEventLimit

  // Month change animation. On a phone the gesture is a horizontal swipe, so
  // the grid travels horizontally to match the finger — the incoming month
  // enters from the side you swiped towards. Pointer/wheel navigation on
  // desktop stays vertical, matching the scroll that drives it.
  // Directional transition when the calendar moves to another month.
  const monthChangeMotion = useDateChangeMotion(currentDate.slice(0, 7))

  // In the month+agenda split the grid gets a share of the height, but its
  // content doesn't: a 6-week month is a whole row taller than a 5-week one,
  // and compressed past weeks change it again. Measure the content so the
  // initial layout can avoid unnecessary clipping, while keeping the chosen
  // divider position authoritative. If the user makes the grid smaller than
  // its content, the grid's own overflow scrolls instead of moving the
  // divider back to a remembered minimum.
  const AGENDA_MIN_SHARE = 0.25
  const splitContainerRef = useRef<HTMLDivElement>(null)
  const gridTopRef = useRef<HTMLDivElement>(null)
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
      const requested = container.clientHeight * gridRatioRef.current
      const next = Math.min(needed, cap, requested)

      if (!hasMeasuredRef.current) {
        // First run: no previous height to travel from, so don't defer.
        // Apply immediately to the DOM to prevent a FOUC/mount animation
        // that stutters the AgendaView's initial smooth-scroll.
        hasMeasuredRef.current = true
        top.style.transition = 'none'
        top.style.minHeight = `${next}px`
        setGridMinHeight(next)

        // Restore CSS transition after the initial paint
        requestAnimationFrame(() => {
          top.style.transition = ''
        })
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
    compressWeekRows,
    rowHeight,
    eventsMap,
    visibleTasksMap,
    gridRatio,
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
                      '--month-row-min-height': `${showWeekNumbers ? adaptiveRowFloor : 0}px`,
                      '--slide-x': monthChangeMotion.initial
                        ? `${monthChangeMotion.initial.x || 0}px`
                        : '0px',
                      '--slide-y': monthChangeMotion.initial
                        ? `${monthChangeMotion.initial.y || 0}px`
                        : '0px',
                      '--slide-duration': `${monthChangeMotion.transition.duration}s`,
                      touchAction: 'none',
                    } as React.CSSProperties
                  }
                >
                  <div
                    className={`${styles.header} ${!showWeekNumbers ? styles.headerNoWeekNum : ''}`}
                    data-component="calendar-grid-header"
                  >
                    {showWeekNumbers && <div className={styles.weekNumHeader}>W#</div>}
                    {weekdays.map((day) => (
                      <div key={day} className={styles.weekday}>
                        {day}
                      </div>
                    ))}
                  </div>
                  <div
                    className={styles.daysContainer}
                    onMouseDown={handleCreateDragStart}
                    onMouseMove={handleCreateDragMove}
                  >
                    {weekNumbers.map((weekNum, weekIdx) => {
                      const weekEnd = days[weekIdx * 7 + 6]
                      const today = startOfDay(new Date())
                      const isPastWeek = compressPastWeeks && isBefore(weekEnd, today)

                      return (
                        <div
                          key={weekIdx}
                          className={`${styles.weekRow} ${!showWeekNumbers ? styles.weekRowNoWeekNum : ''} ${compressWeekRows && isPastWeek ? styles.compressedWeek : ''}`}
                        >
                          {showWeekNumbers && (
                            <div
                              className={styles.weekNumber}
                              onClick={() => handleWeekClick(days[weekIdx * 7])}
                            >
                              <div
                                key={weekNum}
                                className={
                                  monthChangeMotion.initial ? styles.dayContentSlide : undefined
                                }
                                style={
                                  {
                                    width: '100%',
                                    height: '28px',
                                    display: 'flex',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    '--slide-x': monthChangeMotion.initial
                                      ? `${monthChangeMotion.initial.x || 0}px`
                                      : '0px',
                                    '--slide-y': monthChangeMotion.initial
                                      ? `${monthChangeMotion.initial.y || 0}px`
                                      : '0px',
                                    '--slide-duration': `${monthChangeMotion.transition.duration}s`,
                                  } as React.CSSProperties
                                }
                              >
                                {weekNum}
                              </div>
                            </div>
                          )}
                          {days.slice(weekIdx * 7, weekIdx * 7 + 7).map((day, idx) => {
                            const dateKey = format(day, 'yyyy-MM-dd')
                            const dayEvents = eventsMap.get(dateKey) || []
                            const dayTasks = visibleTasksMap.get(dateKey) || []
                            const isCurrentMonth = isSameMonth(day, date)
                            const isTodayDate = isToday(day)
                            const dayOfWeek = getDay(day)
                            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6

                            return (
                              <DroppableDay
                                key={idx}
                                dateKey={dateKey}
                                day={day}
                                isWeekStart={idx === 0}
                                monthChangeMotion={monthChangeMotion}
                                dayEvents={dayEvents}
                                dayTasks={dayTasks}
                                popupTaskItems={tasksMap.get(dateKey) || []}
                                hasJournal={journalDates.has(dateKey)}
                                journalEnabled={journalEnabled}
                                isCurrentMonth={isCurrentMonth}
                                isTodayDate={isTodayDate}
                                isFocusAnchor={dateKey === currentDate}
                                isWeekend={isWeekend}
                                isPastWeek={isPastWeek}
                                compactRecurringEvents={compactRecurringEvents}
                                monthViewEventLimit={fixedEventLimit}
                                monthCapacity={null}
                                isMobile={isMobile}
                                isCompactMobile={isCompactMobile}
                                taskHasSubtasks={taskCollapse.hasSubtasks}
                                taskIsCollapsed={taskCollapse.isCollapsed}
                                taskDescendantCount={taskCollapse.descendantCount}
                                onToggleTaskSubtasks={taskCollapse.toggleTask}
                                collapsedTaskIds={taskCollapse.collapsedTaskIds}
                                onDayClick={handleDayClick}
                                onDayDoubleClick={handleDayDoubleClick}
                                onDayNumberClick={handleDayNumberClick}
                                onJournalIndicatorClick={handleJournalIndicatorClick}
                                onOpenJournalModal={handleOpenJournalModal}
                                openModal={openModal}
                                selectionState={
                                  createRange &&
                                  dateKey >= createRange.min &&
                                  dateKey <= createRange.max
                                    ? dateKey === createRange.min
                                      ? 'start'
                                      : dateKey === createRange.max
                                        ? 'end'
                                        : 'between'
                                    : null
                                }
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
            data-no-pull-refresh
            data-resize-handle
            aria-label="Resize calendar and agenda. Double-click to reset"
            title="Drag to resize · Double-click to reset"
            onMouseDown={handleGridResizeStart}
            onTouchStart={handleGridResizeTouchStart}
            onDoubleClick={handleGridResizeDoubleClick}
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
                    data-no-pull-refresh
                    data-resize-handle
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
        <div
          className={`${styles.gridPanel} ${styles.gridPanelStandalone}`}
          ref={containerRef}
          {...bind}
        >
          <div
            ref={gridScrollRef}
            className={styles.grid}
            data-component="calendar-grid"
            onKeyDown={handleGridKeyDown}
            style={
              {
                '--day-cell-height': `${rowHeight}px`,
                '--month-row-min-height': `${showWeekNumbers ? adaptiveRowFloor : 0}px`,
                '--slide-x': monthChangeMotion.initial
                  ? `${monthChangeMotion.initial.x || 0}px`
                  : '0px',
                '--slide-y': monthChangeMotion.initial
                  ? `${monthChangeMotion.initial.y || 0}px`
                  : '0px',
                '--slide-duration': `${monthChangeMotion.transition.duration}s`,
                touchAction: 'none',
              } as React.CSSProperties
            }
          >
            <div
              className={`${styles.header} ${!showWeekNumbers ? styles.headerNoWeekNum : ''}`}
              data-component="calendar-grid-header"
            >
              {showWeekNumbers && <div className={styles.weekNumHeader}>W#</div>}
              {weekdays.map((day) => (
                <div key={day} className={styles.weekday}>
                  {day}
                </div>
              ))}
            </div>
            <div
              className={styles.daysContainer}
              onMouseDown={handleCreateDragStart}
              onMouseMove={handleCreateDragMove}
            >
              {weekNumbers.map((weekNum, weekIdx) => {
                const weekEnd = days[weekIdx * 7 + 6]
                const today = startOfDay(new Date())
                const isPastWeek = compressPastWeeks && isBefore(weekEnd, today)

                return (
                  <div
                    key={weekIdx}
                    className={`${styles.weekRow} ${!showWeekNumbers ? styles.weekRowNoWeekNum : ''} ${compressWeekRows && isPastWeek ? styles.compressedWeek : ''}`}
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
                              height: '28px',
                              display: 'flex',
                              justifyContent: 'center',
                              alignItems: 'center',
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
                      const dayTasks = visibleTasksMap.get(dateKey) || []
                      const isCurrentMonth = isSameMonth(day, date)
                      const isTodayDate = isToday(day)
                      const dayOfWeek = getDay(day)
                      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6

                      return (
                        <DroppableDay
                          key={idx}
                          dateKey={dateKey}
                          day={day}
                          isWeekStart={idx === 0}
                          monthChangeMotion={monthChangeMotion}
                          dayEvents={dayEvents}
                          dayTasks={dayTasks}
                          popupTaskItems={tasksMap.get(dateKey) || []}
                          hasJournal={journalDates.has(dateKey)}
                          journalEnabled={journalEnabled}
                          isCurrentMonth={isCurrentMonth}
                          isTodayDate={isTodayDate}
                          isFocusAnchor={dateKey === currentDate}
                          isWeekend={isWeekend}
                          isPastWeek={isPastWeek}
                          compactRecurringEvents={compactRecurringEvents}
                          monthViewEventLimit={fixedEventLimit}
                          monthCapacity={
                            compressWeekRows && isPastWeek
                              ? (autoCapacity?.compressed ?? null)
                              : (autoCapacity?.full ?? null)
                          }
                          isMobile={isMobile}
                          isCompactMobile={isCompactMobile}
                          taskHasSubtasks={taskCollapse.hasSubtasks}
                          taskIsCollapsed={taskCollapse.isCollapsed}
                          taskDescendantCount={taskCollapse.descendantCount}
                          onToggleTaskSubtasks={taskCollapse.toggleTask}
                          collapsedTaskIds={taskCollapse.collapsedTaskIds}
                          onDayClick={handleDayClick}
                          onDayDoubleClick={handleDayDoubleClick}
                          onDayNumberClick={handleDayNumberClick}
                          onJournalIndicatorClick={handleJournalIndicatorClick}
                          onOpenJournalModal={handleOpenJournalModal}
                          openModal={openModal}
                          selectionState={
                            createRange && dateKey >= createRange.min && dateKey <= createRange.max
                              ? dateKey === createRange.min
                                ? 'start'
                                : dateKey === createRange.max
                                  ? 'end'
                                  : 'between'
                              : null
                          }
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

/**
 * Which of the month view's row shapes an item will render as — the same
 * decision the render below makes, taken early so the cell can cost the item
 * at the height that shape measures. A task with a due time carries a second
 * line and is nearly twice the height of one without.
 */
function monthRowKind(
  item: CalendarEvent,
  isPastWeek: boolean,
  compactRecurringEvents: boolean,
  isCompactMobile: boolean
): MonthRowKind {
  if (isCompactMobile) return 'dot'
  if (item.type === 'task') return hasDueTime(item) ? 'taskWithTime' : 'task'
  const isMultiDay = !isSameDay(
    toEventInstant(item.start, item.timezone),
    toEventInstant(item.end, item.timezone)
  )
  const compact =
    isPastWeek ||
    !!item.isFragment ||
    (compactRecurringEvents &&
      (!!item.rruleString || !!item.recurrence || item.isAllDay || isMultiDay))
  return compact ? 'compactEvent' : 'event'
}

interface DroppableDayProps {
  monthChangeMotion: DateChangeMotion
  dateKey: string
  day: Date
  isWeekStart: boolean
  dayEvents: CalendarEvent[]
  dayTasks: CalendarEvent[]
  popupTaskItems: CalendarEvent[]
  hasJournal: boolean
  journalEnabled: boolean
  isCurrentMonth: boolean
  isTodayDate: boolean
  isFocusAnchor: boolean
  isWeekend: boolean
  isPastWeek: boolean
  compactRecurringEvents: boolean
  monthViewEventLimit: number
  /** Rows the cell measures out to in "Auto" mode; null means use the setting. */
  monthCapacity: MonthCellCapacity | null
  isMobile: boolean
  isCompactMobile: boolean
  taskHasSubtasks: (taskId: string) => boolean
  taskIsCollapsed: (taskId: string) => boolean
  taskDescendantCount: (taskId: string) => number
  onToggleTaskSubtasks: (taskId: string) => void
  collapsedTaskIds: ReadonlySet<string>
  onDayClick: (day: Date) => void
  onDayDoubleClick: (day: Date) => void
  onDayNumberClick: (day: Date) => void
  onJournalIndicatorClick: (day: Date) => void
  onOpenJournalModal: (date: string) => void
  openModal: (date?: string, endDate?: string, eventId?: string, mode?: 'event' | 'task') => void
  /**
   * Month-view drag-to-create feedback. `'start'` / `'end'` / `'between'`
   * mark the cell as part of the in-progress all-day range; `null` means no
   * selection. A primitive so `React.memo` only re-renders cells whose
   * membership actually changed during the drag.
   */
  selectionState: 'start' | 'end' | 'between' | null
}

const DroppableDay = React.memo(function DroppableDay({
  dateKey,
  day,
  isWeekStart,
  monthChangeMotion,
  dayEvents,
  dayTasks,
  popupTaskItems,
  hasJournal,
  journalEnabled,
  isCurrentMonth,
  isTodayDate,
  isFocusAnchor,
  isWeekend,
  isPastWeek,
  compactRecurringEvents,
  monthViewEventLimit,
  monthCapacity,
  isMobile,
  isCompactMobile,
  taskHasSubtasks,
  taskIsCollapsed,
  taskDescendantCount,
  onToggleTaskSubtasks,
  collapsedTaskIds,
  onDayClick,
  onDayDoubleClick,
  onDayNumberClick,
  onJournalIndicatorClick,
  onOpenJournalModal,
  openModal,
  selectionState,
}: DroppableDayProps): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: dateKey })
  // In "Auto" mode the cell's height, not a setting, decides how much shows.
  // What fits depends on *which* items the day holds, not just how many: a
  // compact pill or a task is about half the height of a full event card, so
  // each item is costed at the height it will actually render at. The lane
  // promotion below can only shrink a card further (a promoted single is
  // forced compact), so costing it full-height errs towards a spare gap rather
  // than an overflowing cell.
  const { eventLimit, taskLimit } = useMemo(() => {
    if (!monthCapacity) return { eventLimit: monthViewEventLimit, taskLimit: monthViewEventLimit }
    const height = monthCapacity.itemHeights
    const eventHeights = dayEvents.map(
      (event) => height[monthRowKind(event, isPastWeek, compactRecurringEvents, isCompactMobile)]
    )
    const taskHeights = dayTasks.map(
      (task) => height[monthRowKind(task, isPastWeek, compactRecurringEvents, isCompactMobile)]
    )
    return fitMonthCell(monthCapacity.contentHeight, eventHeights, taskHeights)
  }, [
    monthCapacity,
    monthViewEventLimit,
    dayEvents,
    dayTasks,
    isPastWeek,
    isCompactMobile,
    compactRecurringEvents,
  ])
  const hiddenCount =
    Math.max(0, dayEvents.length - eventLimit) + Math.max(0, dayTasks.length - taskLimit)
  const popupItems = useMemo(() => {
    const visiblePopupTasks = filterTasksByCollapsedAncestors(
      popupTaskItems,
      popupTaskItems,
      collapsedTaskIds
    )
    return visiblePopupTasks.length > 0 ? [...dayEvents, ...visiblePopupTasks] : dayEvents
  }, [collapsedTaskIds, dayEvents, popupTaskItems])
  // Multi-day fragments carry a lane shared across every day they span, so a
  // fragment's vertical position must be identical in every cell for the pill
  // to read as one continuous band. Any lane a fragment doesn't occupy is
  // filled with a single-day event where one is available, and only falls back
  // to an empty spacer otherwise. A promoted single-day event is forced compact
  // — a full-height card would not fit the lane and would push the band down.
  // Both spacers and promotions happen after the `monthViewEventLimit` slice,
  // so neither consumes a visible slot nor skews the "+N more" count.
  const eventSlots = useMemo(() => {
    const visible = dayEvents.slice(0, eventLimit)
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
  }, [dayEvents, eventLimit, dateKey])
  // Compact-mobile counterpart to `eventSlots`: the same truncation, split into
  // a multi-day bar row and a single-day dot row at the render site.
  const visibleDayEvents = useMemo(() => dayEvents.slice(0, eventLimit), [dayEvents, eventLimit])
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
    openModal(undefined, undefined, event.id, event.type === 'task' ? 'task' : 'event')
  }

  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  return (
    <motion.div
      ref={setNodeRef}
      className={`${styles.day} ${!isCurrentMonth ? styles.otherMonth : ''} ${isTodayDate ? styles.today : ''} ${isWeekend ? styles.weekend : ''} ${isOver ? styles.dropTarget : ''} ${selectionState ? styles.createSelecting : ''}`}
      {...(isTodayDate ? { 'data-today': '' } : {})}
      {...(!isCurrentMonth ? { 'data-other-month': '' } : {})}
      {...(isWeekend ? { 'data-weekend': '' } : {})}
      {...(isOver ? { 'data-drop-target': '' } : {})}
      {...(selectionState ? { 'data-create-selection': selectionState } : {})}
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
        className={monthChangeMotion.initial ? styles.dayContentSlide : undefined}
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
          {journalEnabled &&
            hasJournal &&
            // #79: on compact mobile this is an indicator, not a control —
            // same call as the event dots. A span (rather than a button with
            // its click removed) keeps it out of the tab order and off the
            // a11y tree as a control, and lets the tap reach the day cell.
            (isCompactMobile ? (
              <span
                className={styles.journalIndicator}
                role="img"
                aria-label={`Has journal entries for ${format(day, 'MMMM d')}`}
              >
                <span className={styles.journalIndicatorDot} />
                {journalIndicatorIcon}
              </span>
            ) : (
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
                {journalIndicatorIcon}
              </button>
            ))}
        </div>
        {isCompactMobile ? (
          <>
            {/*
                #79: multi-day bars get their own row above the single-day
                dots. Grouping by kind conveys the distinction by position,
                which reads at a glance in a way a few px of width never did.

                The `monthViewEventLimit` slice still happens once across all
                of dayEvents, before the partition — so which events survive
                truncation, and the `+N` math below, are unchanged. Only where
                the survivors get drawn is different.

                Like the wrappers in the non-compact branch, this row always
                renders: gating it on the bar count would unmount the
                AnimatePresence before the last bar's exit animation could run.
              */}
            <div className={styles.barRow}>
              <AnimatePresence initial={false}>
                {visibleDayEvents
                  .filter((event) => event.isFragment)
                  .map((event) => (
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
                        compact
                        isMobileMonth={isMobile}
                        dotMode
                        enableResize={false}
                        monthView
                        clickDisabled
                        hideFragmentTitle={
                          event.isFragment && !event.isFirstFragment && !isWeekStart
                        }
                      />
                    </motion.div>
                  ))}
              </AnimatePresence>
            </div>
            <div className={styles.dotRow}>
              <AnimatePresence initial={false}>
                {visibleDayEvents
                  .filter((event) => !event.isFragment)
                  .map((event) => {
                    const isMultiDay = !isSameDay(
                      toEventInstant(event.start, event.timezone),
                      toEventInstant(event.end, event.timezone)
                    )
                    const shouldCompact =
                      isPastWeek ||
                      (compactRecurringEvents &&
                        (!!event.rruleString || !!event.recurrence || event.isAllDay || isMultiDay))
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
                          clickDisabled
                        />
                      </motion.div>
                    )
                  })}
                {dayTasks.slice(0, taskLimit).map((task) => (
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
                      clickDisabled
                      taskHasSubtasks={taskHasSubtasks(task.id)}
                      taskSubtasksCollapsed={collapsedTaskIds.has(task.id)}
                      taskSubtaskCount={taskDescendantCount(task.id)}
                      onToggleTaskSubtasks={() => onToggleTaskSubtasks(task.id)}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
              {hiddenCount > 0 && (
                <button
                  ref={moreEventsRef}
                  className={styles.moreEvents}
                  onClick={handleMoreEventsClick}
                >
                  +{hiddenCount}
                </button>
              )}
            </div>
          </>
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
                  const isMultiDay = !isSameDay(
                    toEventInstant(event.start, event.timezone),
                    toEventInstant(event.end, event.timezone)
                  )
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
                      // What the capacity hook measures a row of this shape
                      // by. Tagged with what actually rendered, not with the
                      // prediction, so a promoted single (forced compact to
                      // hold a lane) is never sampled as a full card.
                      data-row-kind={shouldCompact ? 'compactEvent' : 'event'}
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
                        hideFragmentTitle={
                          event.isFragment && !event.isFirstFragment && !isWeekStart
                        }
                      />
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>
            <div className={styles.tasks} data-component="day-tasks">
              <AnimatePresence initial={false}>
                {dayTasks.slice(0, taskLimit).map((task) => (
                  <motion.div
                    key={task.id}
                    data-row-kind={hasDueTime(task) ? 'taskWithTime' : 'task'}
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
                      taskHasSubtasks={taskHasSubtasks(task.id)}
                      taskSubtasksCollapsed={collapsedTaskIds.has(task.id)}
                      taskSubtaskCount={taskDescendantCount(task.id)}
                      onToggleTaskSubtasks={() => onToggleTaskSubtasks(task.id)}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
              {/* One rollup line for the whole cell, not one per container:
                  events and tasks are two stacks inside a single day, and a
                  cell that overflowed both used to show "+1 more" twice. It
                  lives at the bottom of the tasks stack — the last thing in
                  the cell — and counts what both stacks hid. */}
              {hiddenCount > 0 && (
                <button
                  ref={moreEventsRef}
                  className={styles.moreEvents}
                  onClick={handleMoreEventsClick}
                >
                  +{hiddenCount} more
                </button>
              )}
            </div>
          </>
        )}
      </div>
      {showPopup && (
        <DayEventsPopup
          date={day}
          // The rollup counts hidden tasks as well as hidden events, so the
          // popup it opens has to be able to show them.
          events={popupItems}
          position={popupPosition}
          onClose={() => setShowPopup(false)}
          onEventClick={handlePopupEventClick}
          taskHasSubtasks={taskHasSubtasks}
          taskIsCollapsed={taskIsCollapsed}
          taskDescendantCount={taskDescendantCount}
          onToggleTaskSubtasks={onToggleTaskSubtasks}
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
