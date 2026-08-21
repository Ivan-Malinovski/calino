import type { JSX } from 'react'
import React, { useMemo, useState, useCallback, useRef, useLayoutEffect, useEffect } from 'react'
import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  MouseSensor,
  TouchSensor,
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
import { pad2, toLocalDateString, toEventInstant } from '@/lib/datetime'
import { hasDueTime } from '@/lib/events'
import type { CalendarEvent } from '@/types'
import { useCalendarStore, getTasksForDay } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { safeCalDAVUpdate } from '@/lib/caldavHelpers'
import { EventCard } from './EventCard'
import WeekDayColumn from './WeekDayColumn'
import { ContextMenu } from '@/components/common/ContextMenu'
import { useGestures } from '@/hooks/useGestures'
import { useIsMobile } from '@/hooks/useIsMobile'
import { usePinchScale } from '@/hooks/usePinchScale'
import { useRovingGrid } from '@/hooks/useRovingGrid'
import { useContextMenuStore } from '@/store/contextMenuStore'
import { useWindowHeight } from '@/hooks/useWindowHeight'
import { useDragDuplicateModifier } from '@/hooks/useDragDuplicateModifier'
import { useDragModifierStore } from '@/store/dragModifierStore'
import { hapticIfEnabled } from '@/lib/haptics'
import { HOURS } from '@/lib/hours'
import { getTimezoneAbbr, getSecondaryHourLabel } from '@/lib/timezoneHelper'
import { CurrentTimeIndicator } from './CurrentTimeIndicator'
import { DropPreviewBand } from './DropPreviewBand'
import {
  MINUTE_SNAP_INTERVAL,
  snapMinuteOfDay,
  computeDropPreview,
  isSameDropPreview,
  type DropPreview,
} from '../lib/dragSnap'
import { SWIPE_SCROLLER_ATTR } from '../swipePaging'
import styles from './WeekView.module.css'
import { duplicateEventWithSync } from '@/lib/duplicateWithSync'
import { assignSpanLanes, compareDayEvents, makeDayFragments } from '../lib/multiDayFragments'

const BASE_HOUR_HEIGHT = 60
/** Narrowest the mobile day columns compress to, as a fraction of their normal
 *  28vw. Around 0.6 fits five days on a phone; much below that and event
 *  titles stop being readable, which defeats the point of seeing more days. */
const MIN_DAY_SCALE = 0.6
/** `HH:mm` for each of the 24 hour slots — stable, so cells can key off strings. */
const HOUR_KEYS = HOURS.map((hour) => format(hour, 'HH:mm'))

/** Shared empty array so days with no events keep a stable prop reference. */
const EMPTY_EVENTS: CalendarEvent[] = []

/** How many all-day items a mobile day header shows before collapsing the rest
 *  behind a `+N` chip. Two keeps the timeline the dominant thing on screen —
 *  a busy day used to be able to push the grid off the bottom entirely. */
const MOBILE_HEADER_ITEM_LIMIT = 2

// Module-level so `useRovingGrid`'s `handleKeyDown` stays referentially stable
// (an inline arrow would rebuild it — and everything downstream of it — every
// render). ←/→ move one day column (±24 slots), ↑/↓ one hour slot.
const gridDelta = (key: string): number | null =>
  key === 'ArrowLeft'
    ? -24
    : key === 'ArrowRight'
      ? 24
      : key === 'ArrowUp'
        ? -1
        : key === 'ArrowDown'
          ? 1
          : null

/** Hours per day column — the stride of the day-major flattening that
 *  `gridDelta` walks. */
const HOURS_PER_DAY = HOUR_KEYS.length

// ↑/↓ step the flat cell list by ±1, which at a column's ends would slide into
// the neighbouring day (23:00 + ↓ lands on the next day's 00:00, and the
// mirror image for 00:00 + ↑). Days are contiguous blocks of `HOURS_PER_DAY`
// cells, so a vertical move is only legal while both ends sit in the same
// block. ←/→ (±24) always land on the same hour of another day, so they are
// left alone.
const isGridMoveAllowed = (fromIndex: number, toIndex: number): boolean =>
  Math.abs(toIndex - fromIndex) !== 1 ||
  Math.floor(fromIndex / HOURS_PER_DAY) === Math.floor(toIndex / HOURS_PER_DAY)

interface DroppableCellProps {
  dateKey: string
  hourKey: string
  isFocusAnchor: boolean
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void
}

// The cell is only a drop *target* — the highlight showing where the event will
// land is drawn by DropPreviewBand, which knows the exact quarter hour.
//
// The day/hour this cell represents travels via data attributes rather than
// closures, so the parent can hand every one of the 7x24 cells the SAME two
// handler references. Previously each cell got a freshly built arrow function
// per render, which meant this React.memo never once prevented a re-render
// (and re-ran useDroppable's registration for all 168 cells) whenever WeekView
// rendered — during drags, that was every frame. See #73.
//
// `isFocusAnchor` (roving tab stop) and `tabIndex` are per-cell values, so the
// memo holds only for the empty cell.
const DroppableCell = React.memo(function DroppableCell({
  dateKey,
  hourKey,
  isFocusAnchor,
  onClick,
  onMouseDown,
  onKeyDown,
}: DroppableCellProps): JSX.Element {
  const { setNodeRef } = useDroppable({ id: `${dateKey}-${hourKey}` })
  // Screen-reader name for the focused slot: without it the roving tab stop
  // lands on an unnamed "blank". Derived from the same data attributes the
  // handlers read, so the memo still holds.
  const ariaLabel = `${format(parseISO(dateKey), 'EEEE, MMMM d, yyyy')} ${hourKey}`

  return (
    <div
      ref={setNodeRef}
      className={styles.cell}
      data-date={dateKey}
      data-hour={hourKey}
      role="button"
      aria-label={ariaLabel}
      tabIndex={isFocusAnchor ? 0 : -1}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onKeyDown={onKeyDown}
    />
  )
})

interface DayHeaderProps {
  day: Date
  isTodayDay: boolean
  isWeekStart: boolean
  allDayEvents: CalendarEvent[]
  activeIsTimed: boolean
}

// Each day header doubles as an all-day drop target: dragging a timed event
// onto it turns the event into an all-day event (the inverse of dragging a pill
// down into the grid).
const DayHeader = React.memo(function DayHeader({
  day,
  isTodayDay,
  isWeekStart,
  allDayEvents,
  activeIsTimed,
}: DayHeaderProps): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: `allday::${format(day, 'yyyy-MM-dd')}` })

  const dayKey = format(day, 'yyyy-MM-dd')
  const fragmentByLane = new Map<number, CalendarEvent>()
  const singleDayEvents: CalendarEvent[] = []
  allDayEvents.forEach((event) => {
    if (event.isFragment) fragmentByLane.set(event.laneIndex ?? 0, event)
    else singleDayEvents.push(event)
  })

  const slots: Array<{ event: CalendarEvent } | { spacerKey: string }> = []
  const maxLane = fragmentByLane.size === 0 ? -1 : Math.max(...fragmentByLane.keys())
  for (let lane = 0; lane <= maxLane; lane++) {
    const fragment = fragmentByLane.get(lane)
    slots.push(fragment ? { event: fragment } : { spacerKey: `${dayKey}-spacer-${lane}` })
  }
  singleDayEvents.forEach((event) => slots.push({ event }))

  return (
    <div
      ref={setNodeRef}
      className={`${styles.dayHeader} ${isTodayDay ? styles.today : ''} ${allDayEvents.length > 0 ? styles.hasAllDayEvents : ''} ${isOver && activeIsTimed ? styles.dayHeaderDropActive : ''}`}
    >
      <div className={styles.dayName}>{format(day, 'EEE')}</div>
      <div className={styles.dayNumber}>{format(day, 'd')}</div>
      {allDayEvents.length > 0 && (
        <div className={styles.allDayEventsInHeader}>
          {slots.map((slot) =>
            'spacerKey' in slot ? (
              <div key={slot.spacerKey} className={styles.eventSpacer} aria-hidden />
            ) : (
              <EventCard
                key={slot.event.isFragment ? `${slot.event.id}-${dayKey}` : slot.event.id}
                event={slot.event}
                compact
                monthView
                enableResize={false}
                hideFragmentTitle={
                  slot.event.isFragment && !slot.event.isFirstFragment && !isWeekStart
                }
              />
            )
          )}
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
  const secondaryTimezoneEnabled = useSettingsStore((state) => state.secondaryTimezoneEnabled)
  const secondaryTimezone = useSettingsStore((state) => state.secondaryTimezone)
  const secondaryTimezoneLabel = useSettingsStore((state) => state.secondaryTimezoneLabel)
  const timezone = useSettingsStore((state) => state.timezone)
  const openMenuId = useContextMenuStore((state) => state.openMenuId)
  const openMenu = useContextMenuStore((state) => state.openMenu)
  const closeMenu = useContextMenuStore((state) => state.closeMenu)

  const isDualTz = secondaryTimezoneEnabled && !!secondaryTimezone

  const { updateEvent: caldavUpdateEvent, createEvent: createCalDAVEvent } = useCalDAV()

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
  const [dayScale, setDayScale] = useState(1)
  const windowHeight = useWindowHeight()
  const stretchFactor = windowHeight > 1570 ? windowHeight / 1570 : 1
  const effectiveScale = scale * stretchFactor
  const containerRef = useRef<HTMLDivElement>(null)
  const headerScrollRef = useRef<HTMLDivElement>(null)
  const bodyScrollRef = useRef<HTMLDivElement>(null)
  const mobileScrollRef = useRef<HTMLDivElement>(null)
  const daysContainerRef = useRef<HTMLDivElement>(null)
  const hourHeight = BASE_HOUR_HEIGHT * effectiveScale

  // Roving-tabindex arrow navigation across the 7×24 hour-slot grid: ←/→ move
  // between day columns, ↑/↓ between hour slots (matching the month view's
  // ←/→ + ↑/↓ model). Enter/Space on a focused cell opens the quick-create
  // modal (same handler as a click). Edge-of-grid arrows trigger the pager
  // below, so focus never silently sticks.
  const gridBodyRef = useRef<HTMLDivElement>(null)
  const {
    handleKeyDown: handleGridKeyDown,
    focusAnchor,
    setFocusAnchor,
  } = useRovingGrid(gridBodyRef, '[data-hour]', gridDelta, isGridMoveAllowed)
  // Both refs point at the same element (the days container): `daysContainerRef`
  // for drag-to-create geometry, `gridBodyRef` for roving focus.
  const daysAndGridRef = useCallback((el: HTMLDivElement | null) => {
    daysContainerRef.current = el
    gridBodyRef.current = el
  }, [])
  const edgeArrowRef = useRef<{ key: 'ArrowLeft' | 'ArrowRight'; hour: string } | null>(null)

  const handleGridEdgeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      const key = e.key
      if (key !== 'ArrowLeft' && key !== 'ArrowRight') return
      const atEdge = e.currentTarget.dataset.rovingAtEdge
      if (atEdge !== key) return
      e.preventDefault()
      e.stopPropagation()
      const active = document.activeElement as HTMLElement | null
      const hour = active?.closest('[data-hour]')?.getAttribute('data-hour') ?? '00:00'
      edgeArrowRef.current = { key, hour }
      const direction: 'prev' | 'next' = key === 'ArrowLeft' ? 'prev' : 'next'
      const date = parseISO(currentDate)
      setCurrentDate(
        toLocalDateString(
          dayCount === 7
            ? addWeeks(date, direction === 'next' ? 1 : -1)
            : addDays(date, direction === 'next' ? dayCount : -dayCount)
        )
      )
    },
    [currentDate, setCurrentDate, dayCount]
  )

  const handleGridKeyDownWithEdge = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      handleGridKeyDown(e)
      handleGridEdgeKeyDown(e)
    },
    [handleGridKeyDown, handleGridEdgeKeyDown]
  )

  // The roving tab stop has ONE owner: the hook's `focusAnchor` state once the
  // user has moved, the `currentDate`-anchored default before that. Cells read
  // `isFocusAnchor` from this comparison (see the render sites), so a re-render
  // can never resurrect a second `tabindex=0` behind React's back.
  const anchorDate = focusAnchor?.getAttribute('data-date') ?? null
  const anchorHour = focusAnchor?.dataset.hour ?? null
  const isCellFocusAnchor = useCallback(
    (dayKey: string, hourKey: string): boolean =>
      anchorDate === null
        ? dayKey === currentDate && hourKey === '00:00'
        : anchorDate === dayKey && anchorHour === hourKey,
    [anchorDate, anchorHour, currentDate]
  )

  // When the visible week changes (header pager or edge paging), drop the
  // hook's anchor so the default re-engages on the new week. Declared before
  // the edge-paging effect below so the restore wins when both fire.
  useEffect(() => {
    setFocusAnchor(null)
  }, [currentDate, setFocusAnchor])

  useEffect(() => {
    if (!edgeArrowRef.current) return
    // The day columns have re-rendered for the new week. Land focus on the
    // edge day of the newly visible week (first column after paging right,
    // last column after paging left) at the hour the user was on.
    const { key, hour } = edgeArrowRef.current
    edgeArrowRef.current = null
    const body = gridBodyRef.current
    if (!body) return
    const cells = Array.from(body.querySelectorAll<HTMLElement>('[data-hour]'))
    if (cells.length === 0) return
    const edgeDate =
      key === 'ArrowRight'
        ? cells[0].getAttribute('data-date')
        : cells[cells.length - 1].getAttribute('data-date')
    const target = cells.find(
      (cell) => cell.getAttribute('data-date') === edgeDate && cell.dataset.hour === hour
    )
    if (target) {
      target.focus()
      setFocusAnchor(target)
    }
  }, [currentDate, setFocusAnchor])

  useEffect(() => {
    if (openMenuId !== null && openMenuId !== 'weekview' && contextMenu) {
      setContextMenu(null)
    }
  }, [openMenuId])

  const isMobile = useIsMobile()

  // Day keys whose header is showing every all-day item rather than the first
  // MOBILE_HEADER_ITEM_LIMIT. Expanding in place beats navigating away: the
  // user is mid-scan of the week and a view switch loses that context.
  const [expandedHeaderDays, setExpandedHeaderDays] = useState<ReadonlySet<string>>(() => new Set())

  const toggleHeaderDay = useCallback((dayKey: string) => {
    setExpandedHeaderDays((prev) => {
      const next = new Set(prev)
      if (!next.delete(dayKey)) next.add(dayKey)
      return next
    })
  }, [])

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

      // Local, not UTC: `currentDate` is a local yyyy-MM-dd and `parseISO` gave
      // us local midnight, so a UTC slice reads back the previous day east of
      // UTC — paging a week forward from the 12th landed on the 18th, and in
      // DayView the ±1 day cancelled out entirely. Same trap as #116.
      //
      // Untested, and deliberately so rather than by oversight: this callback
      // could not be made to fire under any harness we tried (mouse drag,
      // synthetic touch, and real CDP touch, at both mobile and desktop
      // widths), so how a user reaches it is unclear — the App-level pager in
      // App.tsx handles the swipes we could actually drive. Fixed on
      // correctness grounds; `setCurrentDate` takes a local date everywhere
      // else it is called.
      setCurrentDate(toLocalDateString(newDate))
    },
    [currentDate, setCurrentDate, dayCount]
  )

  const handlePinch = useCallback((scaleValue: number) => {
    setScale(scaleValue)
  }, [])

  // On mobile a pinch compresses the days horizontally so more of the week
  // fits, rather than scaling the hour height. Vertical zoom stays a desktop
  // gesture (ctrl+wheel): on a phone the useful axis is how many days you can
  // see, and driving both from one pinch would make neither controllable.
  //
  // Bound with its own touch listeners rather than through useGestures, whose
  // pinch never fires on touch — see usePinchScale's doc comment.
  const dayScaleAtPinchStart = useRef(1)
  const handlePinchStart = useCallback(() => {
    dayScaleAtPinchStart.current = dayScale
  }, [dayScale])
  const handleDayPinch = useCallback((ratio: number) => {
    setDayScale(Math.min(1, Math.max(MIN_DAY_SCALE, dayScaleAtPinchStart.current * ratio)))
  }, [])
  usePinchScale(mobileScrollRef, {
    onPinchStart: handlePinchStart,
    onPinch: handleDayPinch,
    enabled: isMobile,
  })

  const { bind } = useGestures({
    onSwipe: handleSwipe,
    onPinch: handlePinch,
    swipeThreshold: 50,
    pinchScaleRange: { min: 1, max: 1.5 },
  })

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

  // Prefer the droppable directly under the pointer (so dropping on the thin
  // day-header strip registers), falling back to rect overlap for the hour grid.
  const collisionDetection: CollisionDetection = useCallback((args) => {
    const pointerCollisions = pointerWithin(args)
    return pointerCollisions.length > 0 ? pointerCollisions : rectIntersection(args)
  }, [])

  // Live preview of where the dragged event will land, refreshed on drag move.
  // The card itself follows the pointer freely; only this band snaps.
  const handleDragMove = (event: DragMoveEvent): void => {
    const durationMinutes =
      activeEvent && !activeEvent.isAllDay
        ? (parseISO(activeEvent.end).getTime() - parseISO(activeEvent.start).getTime()) / 60_000
        : 60
    const next = computeDropPreview(
      event.active,
      event.over,
      event.delta.y,
      hourHeight,
      durationMinutes
    )
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

  const localTzAbbr = useMemo(
    () => getTimezoneAbbr(date, timezone || Intl.DateTimeFormat().resolvedOptions().timeZone),
    [date, timezone]
  )
  const secondaryTzAbbr = useMemo(
    () =>
      secondaryTimezoneLabel || (secondaryTimezone ? getTimezoneAbbr(date, secondaryTimezone) : ''),
    [date, secondaryTimezone, secondaryTimezoneLabel]
  )

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
    const allDayEvents = weekEvents.filter(
      (event) => event.type !== 'task' && event.type !== 'journal' && event.isAllDay
    )
    const allDayLaneOf = assignSpanLanes(allDayEvents)

    for (const event of weekEvents) {
      if (event.type !== 'task' && event.type !== 'journal' && event.isAllDay) {
        makeDayFragments(event, allDayLaneOf.get(event.id)).forEach((fragment) => {
          const dayKey = format(toEventInstant(fragment.start, fragment.timezone), 'yyyy-MM-dd')
          allDay.set(dayKey, [...(allDay.get(dayKey) || []), fragment])
        })
      } else if (event.type !== 'task' && !event.isAllDay) {
        // Tasks (all-day or timed) are never placed in the time grid — they
        // render as compact cards in the per-day task footer, matching month
        // view. Only real timed events reach this branch.
        const fragments = makeDayFragments(event)
        if (fragments.length === 1) {
          const dayKey = format(toEventInstant(event.start, event.timezone), 'yyyy-MM-dd')
          timed.set(dayKey, [...(timed.get(dayKey) || []), event])
        } else {
          fragments.forEach((fragment) => {
            const dayKey = format(toEventInstant(fragment.start, fragment.timezone), 'yyyy-MM-dd')
            timedFragments.set(dayKey, [...(timedFragments.get(dayKey) || []), fragment])
          })
        }
      }
    }

    allDay.forEach((dayEvents, dayKey) => {
      allDay.set(dayKey, [...dayEvents].sort(compareDayEvents))
    })

    return { allDayEventsMap: allDay, eventsMap: timed, timedFragmentsMap: timedFragments }
    // `events` and `calendars` are kept as deps alongside
    // `rangeExpansionVersion` for defense-in-depth: the version bump
    // and the array replacement don't always land in the same Zustand
    // notify cycle, and direct setState callers (e.g. history store)
    // could in theory miss the bump. The linter flags these as
    // 'unnecessary dependencies' but the e2e undo/redo test would
    // catch a regression if either were removed. R4.1/R4.3 review fix.
  }, [rangeStart, rangeEnd, calendars, getEventsForDateRange, events, rangeExpansionVersion])

  // Per-visible-day lookups into the store's shared due-date index, rather
  // than a full scan of every stored event on every mutation. See #73.
  //
  // `timedTasksMap` pre-applies the hasDueTime filter that the day columns
  // need, so each column can be handed an array reference that only changes
  // when its contents actually do — filtering at the call site minted a fresh
  // array per render and defeated WeekDayColumn's memo.
  const { tasksMap, timedTasksMap } = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    const timedMap = new Map<string, CalendarEvent[]>()
    const visibleCalendarIds = calendars.filter((c) => c.isVisible).map((c) => c.id)
    for (const day of weekDays) {
      const dayKey = format(day, 'yyyy-MM-dd')
      const dayTasks = getTasksForDay(events, dayKey).filter((event) =>
        visibleCalendarIds.includes(event.calendarId)
      )
      if (dayTasks.length > 0) {
        map.set(dayKey, dayTasks)
        const timed = dayTasks.filter((t) => hasDueTime(t))
        if (timed.length > 0) timedMap.set(dayKey, timed)
      }
    }
    return { tasksMap: map, timedTasksMap: timedMap }
  }, [weekDays, events, calendars, rangeExpansionVersion])

  // Everything that belongs above the timeline rather than in it: all-day
  // events plus untimed tasks (see hasDueTime — a task with no due time, or
  // one due at exactly midnight, has no row to sit on). Mobile renders these
  // in the day header; desktop keeps all-day events in the header and untimed
  // tasks in the aligned footer below (#120).
  const mobileHeaderItemsMap = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const day of weekDays) {
      const dayKey = format(day, 'yyyy-MM-dd')
      const items = [
        ...(allDayEventsMap.get(dayKey) ?? EMPTY_EVENTS),
        ...(tasksMap.get(dayKey) ?? EMPTY_EVENTS).filter((t) => !hasDueTime(t)),
      ].sort(compareDayEvents)
      if (items.length > 0) map.set(dayKey, items)
    }
    return map
  }, [weekDays, allDayEventsMap, tasksMap])

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
        const scrollTop =
          fraction * bodyRef.current.scrollHeight - bodyRef.current.clientHeight * 0.3
        bodyRef.current.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' })
      } else {
        const sortedAllEvents: CalendarEvent[] = []
        eventsMap.forEach((dayEvents) => {
          sortedAllEvents.push(...dayEvents)
        })

        if (sortedAllEvents.length === 0) return

        sortedAllEvents.sort(
          (a, b) =>
            toEventInstant(a.start, a.timezone).getTime() -
            toEventInstant(b.start, b.timezone).getTime()
        )
        const firstEvent = sortedAllEvents[0]
        const eventStart = toEventInstant(firstEvent.start, firstEvent.timezone)
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

  // Both read their slot off the cell's data attributes, so a single handler
  // identity serves all 168 cells and DroppableCell's memo actually holds.
  const handleCellClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): void => {
      const { date, hour } = e.currentTarget.dataset
      if (!date || !hour) return
      openModal(`${date}T${hour}`)
    },
    [openModal]
  )

  // Enter/Space on a focused empty slot starts the same quick-create as a
  // click. (A focused event card handles its own Enter via EventCard.) Stable
  // like handleCellClick so DroppableCell's memo holds.
  const handleCellKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      e.stopPropagation()
      handleCellClick(e as unknown as React.MouseEvent<HTMLDivElement>)
    },
    [handleCellClick]
  )

  const handleDragStartFromCell = useCallback((e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    const { date, hour } = e.currentTarget.dataset
    if (!date || !hour) return
    e.preventDefault()
    const startTime = `${date}T${hour}`
    setIsDraggingToCreate(true)
    setDragStart(startTime)
    setDragEnd(startTime)
  }, [])

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

  const { markDragStart, markDragEnd } = useDragDuplicateModifier()

  const handleDragStart = (event: DragStartEvent): void => {
    hapticIfEnabled('light')
    // A card's own context menu can still be open (e.g. a long-press-hold that
    // didn't move far enough to count as a drag yet) when a new drag starts —
    // close it instead of leaving it floating over the grid mid-drag.
    useContextMenuStore.getState().closeMenu()
    const [eventId] = String(event.active.id).split('::')
    const draggedEvent = events.find((e) => e.id === eventId)
    setActiveEvent(draggedEvent || null)
    markDragStart(event.activatorEvent)
  }

  const handleDragEnd = async (event: DragEndEvent): Promise<void> => {
    const { active, over, delta } = event
    const [activeId] = String(active.id).split('::')
    const shouldDuplicate = useDragModifierStore.getState().isDuplicateModifierHeld
    markDragEnd()
    // Defer clearing active event to avoid scroll jump
    setTimeout(() => setActiveEvent(null), 0)
    setDropPreview(null)

    if (!over) return

    const droppableId = String(over.id)

    // Dropped on a day header → convert a timed event into an all-day event.
    if (droppableId.startsWith('allday::')) {
      const dayStr = droppableId.slice('allday::'.length)
      const originalEvent = events.find((e) => e.id === activeId)
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
      if (shouldDuplicate) {
        duplicateEventWithSync({
          eventId: originalEvent.id,
          addCopySuffix: false,
          updates: allDayUpdates,
          createCalDAVEvent,
        })
        return
      }
      storeUpdateEvent(activeId, allDayUpdates)
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

    const originalEvent = events.find((e) => e.id === activeId)
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
      // Phase 2 (C3) — baseline in the device frame so the drop target is
      // the instant the user sees; updateEvent re-frames it for TZID events.
      const originalStart = toEventInstant(originalEvent.start, originalEvent.timezone)
      const originalEnd = toEventInstant(originalEvent.end, originalEvent.timezone)
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

  const weekNumber = useMemo(() => {
    const weekStart = startOfWeek(date, { weekStartsOn: firstDayOfWeek || 0 })
    return getISOWeek(weekStart)
  }, [date, firstDayOfWeek])

  const renderMobileContent = () => (
    <div
      ref={mobileScrollRef}
      className={styles.mobileContainer}
      data-component="week-mobile-scroll"
      {...{ [SWIPE_SCROLLER_ATTR]: true }}
    >
      <div className={styles.mobileHeader} data-component="week-mobile-header">
        <div className={styles.weekNumberHeader}>
          {isDualTz ? (
            <div className={styles.timeZoneHeaders}>
              <span>{localTzAbbr}</span>
              <span>{secondaryTzAbbr}</span>
            </div>
          ) : (
            `W${weekNumber}`
          )}
        </div>
        <div className={styles.headerDays}>
          {weekDays.map((day, idx) => {
            const dayKey = format(day, 'yyyy-MM-dd')
            const headerItems = mobileHeaderItemsMap.get(dayKey) ?? EMPTY_EVENTS
            const isExpanded = expandedHeaderDays.has(dayKey)
            // Collapsing only pays for itself when the chip hides more than it
            const canToggle = headerItems.length > MOBILE_HEADER_ITEM_LIMIT
            const visibleItems =
              isExpanded || !canToggle
                ? headerItems
                : headerItems.slice(0, MOBILE_HEADER_ITEM_LIMIT)
            const hiddenCount = headerItems.length - visibleItems.length
            const dayLabel = format(day, 'EEEE d MMMM')
            return (
              <div
                key={day.toISOString()}
                className={`${styles.dayHeader} ${isToday(day) ? styles.today : ''} ${
                  headerItems.length > 0 ? styles.hasAllDayEvents : ''
                }`}
                data-component="week-mobile-day-header"
              >
                <div className={styles.dayName}>{format(day, 'EEE')}</div>
                <div className={styles.dayNumber}>{format(day, 'd')}</div>
                {/* All-day events and untimed tasks live here rather than in a
                    separate footer, so they sit in the same DOM column as the
                    day and inherit its width — the footer was laid out against
                    the viewport while these columns scroll horizontally, which
                    put items under the wrong day and squeezed titles to
                    nothing (#120). */}
                {headerItems.length > 0 && (
                  <div className={styles.allDayEventsInHeader}>
                    {visibleItems.map((item) => (
                      <EventCard
                        key={item.isFragment ? `${item.id}-${dayKey}` : item.id}
                        event={item}
                        compact
                        monthView
                        enableResize={false}
                        hideFragmentTitle={item.isFragment && !item.isFirstFragment && idx !== 0}
                      />
                    ))}
                    {/* Sits at the bottom of the stack, where the items it
                        stands for would be — under the date it read as a badge
                        on the day number instead. Sized like one item row: the
                        24px WCAG AA target is the bar that applies to a tap
                        this cheap to undo, and 44px cost more space than the
                        rows it was hiding. */}
                    {canToggle && (
                      <button
                        type="button"
                        className={styles.headerMoreItems}
                        aria-expanded={isExpanded}
                        aria-label={
                          isExpanded
                            ? `Show fewer all-day items on ${dayLabel}`
                            : `Show ${hiddenCount} more all-day items on ${dayLabel}`
                        }
                        onClick={() => toggleHeaderDay(dayKey)}
                      >
                        {isExpanded ? 'Less' : `+${hiddenCount} more`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div className={styles.mobileBody} data-component="week-mobile-body">
        <div className={styles.timeColumn} data-component="week-mobile-time-column">
          {HOURS.map((hour) => {
            const primaryTime = format(hour, timeFormat === '24h' ? 'HH:mm' : 'h a')
            if (isDualTz && secondaryTimezone) {
              const secLabel = getSecondaryHourLabel(
                hour.getHours(),
                date,
                secondaryTimezone,
                timeFormat
              )
              return (
                <div key={hour.toISOString()} className={styles.timeCell}>
                  <div className={styles.timeRow}>
                    <span className={styles.primaryTime}>{primaryTime}</span>
                    <span className={styles.secondaryTime}>
                      {secLabel.time}
                      {secLabel.dayDelta && (
                        <span className={styles.dayDelta}>{secLabel.dayDelta}</span>
                      )}
                    </span>
                  </div>
                </div>
              )
            }
            return (
              <div key={hour.toISOString()} className={styles.timeCell}>
                {primaryTime}
              </div>
            )
          })}
        </div>
        <div
          ref={daysAndGridRef}
          className={styles.daysContainer}
          data-component="week-grid"
          onKeyDown={handleGridKeyDownWithEdge}
        >
          {selectionOverlay}
          {weekDays.map((day) => {
            const dayKey = format(day, 'yyyy-MM-dd')
            return (
              <div
                key={day.toISOString()}
                className={`${styles.dayColumn} ${isToday(day) ? styles.todayColumn : ''}`}
                data-component="week-mobile-day-column"
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
                  {HOUR_KEYS.map((hourKey) => (
                    <DroppableCell
                      key={`${dayKey}-${hourKey}`}
                      dateKey={dayKey}
                      hourKey={hourKey}
                      isFocusAnchor={isCellFocusAnchor(dayKey, hourKey)}
                      onClick={handleCellClick}
                      onMouseDown={handleDragStartFromCell}
                      onKeyDown={handleCellKeyDown}
                    />
                  ))}
                </div>
                <div className={styles.eventsOverlay}>
                  {dropPreview?.dateKey === dayKey && (
                    <DropPreviewBand preview={dropPreview} timeFormat={timeFormat} />
                  )}
                  <WeekDayColumn
                    events={eventsMap.get(dayKey) ?? EMPTY_EVENTS}
                    fragments={timedFragmentsMap.get(dayKey) ?? EMPTY_EVENTS}
                    timedTasks={timedTasksMap.get(dayKey) ?? EMPTY_EVENTS}
                    calendars={calendars}
                    hourHeight={hourHeight}
                    openModal={openModal}
                  />
                  {isToday(day) && (
                    <CurrentTimeIndicator
                      hourHeight={hourHeight}
                      timeFormat={timeFormat}
                      showLabel={false}
                    />
                  )}
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
          <div className={styles.weekNumberHeader}>
            {isDualTz ? (
              <div className={styles.timeZoneHeaders}>
                <span>{localTzAbbr}</span>
                <span>{secondaryTzAbbr}</span>
              </div>
            ) : dayCount === 7 ? (
              `W${weekNumber}`
            ) : (
              ''
            )}
          </div>
          <div className={styles.headerDays}>
            {weekDays.map((day, idx) => (
              <DayHeader
                key={day.toISOString()}
                day={day}
                isTodayDay={isToday(day)}
                isWeekStart={idx === 0}
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
            {HOURS.map((hour) => {
              const primaryTime = format(hour, timeFormat === '24h' ? 'HH:mm' : 'h a')
              if (isDualTz && secondaryTimezone) {
                const secLabel = getSecondaryHourLabel(
                  hour.getHours(),
                  date,
                  secondaryTimezone,
                  timeFormat
                )
                return (
                  <div key={hour.toISOString()} className={styles.timeCell}>
                    <div className={styles.timeRow}>
                      <span className={styles.primaryTime}>{primaryTime}</span>
                      <span className={styles.secondaryTime}>
                        {secLabel.time}
                        {secLabel.dayDelta && (
                          <span className={styles.dayDelta}>{secLabel.dayDelta}</span>
                        )}
                      </span>
                    </div>
                  </div>
                )
              }
              return (
                <div key={hour.toISOString()} className={styles.timeCell}>
                  {primaryTime}
                </div>
              )
            })}
          </div>
          <div
            ref={daysAndGridRef}
            className={styles.daysContainer}
            data-component="week-grid"
            onKeyDown={handleGridKeyDownWithEdge}
          >
            {selectionOverlay}
            {weekDays.map((day) => {
              const dayKey = format(day, 'yyyy-MM-dd')
              return (
                <div
                  key={day.toISOString()}
                  className={styles.dayColumn}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    openMenu('weekview')
                    const rect = e.currentTarget.getBoundingClientRect()
                    const y = e.clientY - rect.top
                    const hourClicked = Math.max(
                      0,
                      Math.min(23, Math.floor((y / rect.height) * 24))
                    )
                    setContextMenu({ x: e.clientX, y: e.clientY, day, hour: hourClicked })
                  }}
                >
                  <div className={styles.hourCells}>
                    {HOUR_KEYS.map((hourKey) => (
                      <DroppableCell
                        key={`${dayKey}-${hourKey}`}
                        dateKey={dayKey}
                        hourKey={hourKey}
                        isFocusAnchor={isCellFocusAnchor(dayKey, hourKey)}
                        onClick={handleCellClick}
                        onMouseDown={handleDragStartFromCell}
                        onKeyDown={handleCellKeyDown}
                      />
                    ))}
                  </div>
                  <div className={styles.eventsOverlay}>
                    {dropPreview?.dateKey === dayKey && (
                      <DropPreviewBand preview={dropPreview} timeFormat={timeFormat} />
                    )}
                    <WeekDayColumn
                      events={eventsMap.get(dayKey) ?? EMPTY_EVENTS}
                      fragments={timedFragmentsMap.get(dayKey) ?? EMPTY_EVENTS}
                      timedTasks={timedTasksMap.get(dayKey) ?? EMPTY_EVENTS}
                      calendars={calendars}
                      hourHeight={hourHeight}
                      openModal={openModal}
                    />
                    {isToday(day) && (
                      <CurrentTimeIndicator
                        hourHeight={hourHeight}
                        timeFormat={timeFormat}
                        showLabel={false}
                      />
                    )}
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
        style={
          {
            '--hour-height': `${60 * effectiveScale}px`,
            '--day-count': weekDays.length,
            '--day-scale': dayScale,
            // The dual gutter needs room for two labels. On phones the day
            // columns are already only 28vw, so it gets a tighter budget than
            // on desktop rather than eating a quarter of the screen.
            '--time-gutter-width': isDualTz ? (isMobile ? '72px' : '90px') : '45px',
          } as React.CSSProperties
        }
        {...bind}
      >
        {isMobile ? renderMobileContent() : renderDesktopContent()}
        {/* Desktop only. Its grid template assumes the day columns are `1fr`
            of the container, which holds for the desktop body but not for the
            mobile strip's fixed-width, horizontally scrolled columns — on
            mobile these items render in the day header instead (#120). */}
        {!isMobile &&
          (() => {
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
                      <EventCard
                        key={task.id}
                        event={task}
                        compact
                        monthView
                        enableResize={false}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )
          })()}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeEvent ? <EventCard event={activeEvent} isDragging /> : null}
      </DragOverlay>
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
                  contextMenu.hour !== undefined ? `T${pad2(contextMenu.hour)}:00` : ''
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
