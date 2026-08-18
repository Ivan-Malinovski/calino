import type { JSX } from 'react'
import { useMemo, useState, useRef, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'
import { createPortal } from 'react-dom'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, parseISO, startOfDay } from 'date-fns'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useContextMenuStore } from '@/store/contextMenuStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { deleteEventWithUndo } from '@/lib/deleteWithUndo'
import type { CalendarEvent } from '@/types'
import { ContextMenu } from '@/components/common/ContextMenu'
import { EmptyState } from '@/components/common/EmptyState'
import { getEventColor } from '@/lib/eventColor'
import { formatEventTime, toEventInstant } from '@/lib/datetime'
import { LocationLink } from './LocationLink'
import { useDateChangeMotion } from '@/hooks/useDateChangeMotion'
import { useTaskContextMenuItems } from '../hooks/useTaskContextMenuItems'
import styles from './AgendaView.module.css'

interface EventWithDate {
  event: CalendarEvent
  date: Date
}

interface DayGroup {
  type: 'day' | 'skip'
  days: Date[]
  hasEvents: boolean
}

function MonthScrollRestorer({
  currentDate,
  dayGroups,
  virtualizer,
  scrolledMonthRef,
}: {
  currentDate: string
  dayGroups: DayGroup[]
  virtualizer: Virtualizer<HTMLDivElement, Element>
  scrolledMonthRef: React.MutableRefObject<string | null>
}) {
  useEffect(() => {
    const today = startOfDay(new Date())
    const viewDate = parseISO(currentDate)
    const monthStart = startOfMonth(viewDate)
    const monthEnd = endOfMonth(viewDate)
    const viewMonthKey = format(monthStart, 'yyyy-MM')

    if (scrolledMonthRef.current !== viewMonthKey) {
      if (today >= monthStart && today <= monthEnd) {
        const todayKey = format(today, 'yyyy-MM-dd')
        const index = dayGroups.findIndex(
          (g) => g.type === 'day' && format(g.days[0], 'yyyy-MM-dd') === todayKey
        )
        if (index !== -1) {
          // Delaying by one frame ensures the DOM has updated its scrollHeight
          // for the new month, avoiding scroll clamping by the browser.
          requestAnimationFrame(() => {
            virtualizer.scrollToIndex(index, { align: 'start', behavior: 'auto' })
            scrolledMonthRef.current = viewMonthKey
          })
        }
      } else {
        requestAnimationFrame(() => {
          virtualizer.scrollToIndex(0, { align: 'start', behavior: 'auto' })
          scrolledMonthRef.current = viewMonthKey
        })
      }
    }
  }, [currentDate, dayGroups, virtualizer, scrolledMonthRef])

  return null
}

export function AgendaView({ embedded = false }: { embedded?: boolean } = {}): JSX.Element {
  const containerClass = `${styles.container} ${embedded ? styles.embedded : ''}`
  const currentDate = useCalendarStore((state) => state.currentDate)
  const calendars = useCalendarStore((state) => state.calendars)
  const categories = useCalendarStore((state) => state.categories)
  const getEventsForDateRange = useCalendarStore((state) => state.getEventsForDateRange)
  const openModal = useCalendarStore((state) => state.openModal)
  const openPreview = useCalendarStore((state) => state.openPreview)
  const previewEventId = useCalendarStore((state) => state.previewEventId)
  const closePreview = useCalendarStore((state) => state.closePreview)
  const events = useCalendarStore((state) => state.events)
  const timeFormat = useSettingsStore((state) => state.timeFormat)
  const deleteEvent = useCalendarStore((state) => state.deleteEvent)
  // Shared with the tasks list and the sidebar so ticking a task off behaves
  // the same wherever it is done — including the recurring-occurrence path.
  const { toggleComplete } = useTaskContextMenuItems(null)
  const addEvent = useCalendarStore((state) => state.addEvent)
  const { deleteEvent: deleteCalDAVEvent, createEvent: createCalDAVEvent } = useCalDAV()
  const closeMenu = useContextMenuStore((state) => state.closeMenu)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; day: Date } | null>(null)
  const [eventContextMenu, setEventContextMenu] = useState<{
    x: number
    y: number
    event: CalendarEvent
  } | null>(null)

  const fadePastDaysInAgenda = useSettingsStore((state) => state.fadePastDaysInAgenda)
  const useCategoryColors = useSettingsStore((state) => state.useCategoryColors)

  const getEventBarColor = (event: CalendarEvent): string =>
    getEventColor(event, { categories, calendars, useCategoryColors })

  const date = parseISO(currentDate)
  const monthKey = currentDate.slice(0, 7)
  const monthChangeMotion = useDateChangeMotion(monthKey)

  const isCurrentMonthView = useMemo(() => {
    const today = startOfDay(new Date())
    const monthStart = startOfMonth(date)
    const monthEnd = endOfMonth(date)
    return today >= monthStart && today <= monthEnd
  }, [date])

  const handleEventClick = (e: React.MouseEvent, event: CalendarEvent): void => {
    if (e.button === 2) return
    e.stopPropagation()
    if (previewEventId === event.id) {
      closePreview()
      openModal(undefined, undefined, event.id, event.type === 'task' ? 'task' : 'event')
      return
    }
    openPreview(event.id, { x: e.clientX, y: e.clientY })
  }

  const handleContextMenu = (e: React.MouseEvent, day: Date): void => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, day })
  }

  const handleEventContextMenu = (e: React.MouseEvent, event: CalendarEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setEventContextMenu({ x: e.clientX, y: e.clientY, event })
  }

  const { eventsByDate, dayGroups } = useMemo(() => {
    const monthStart = startOfMonth(date)
    const monthEnd = endOfMonth(date)
    const daysList = eachDayOfInterval({ start: monthStart, end: monthEnd })
    const events = getEventsForDateRange(
      format(monthStart, 'yyyy-MM-dd'),
      format(monthEnd, 'yyyy-MM-dd')
    )

    const eventMap = new Map<string, EventWithDate[]>()
    events.forEach((event) => {
      if (event.type === 'journal') return
      // When embedded, skip all tasks (shown in DayView header)
      if (embedded && event.type === 'task') return
      // Undated tasks have a technical start value from their VTODO import;
      // only tasks with an explicit due date belong on the agenda.
      if (event.type === 'task' && !event.dueDate) return
      const eventDate = format(toEventInstant(event.start, event.timezone), 'yyyy-MM-dd')
      // R4.6: push onto a stable array instead of spreading into a new
      // one. The previous `eventMap.set(k, [...existing, item])` was
      // O(k.length) per event, so for a day with N events it was O(N²)
      // total just to build the map. With push it's O(N).
      let arr = eventMap.get(eventDate)
      if (!arr) {
        arr = []
        eventMap.set(eventDate, arr)
      }
      arr.push({ event, date: toEventInstant(event.start, event.timezone) })

      if (!event.isAllDay) {
        const eventEndDate = format(toEventInstant(event.end, event.timezone), 'yyyy-MM-dd')
        if (eventEndDate !== eventDate) {
          let endArr = eventMap.get(eventEndDate)
          if (!endArr) {
            endArr = []
            eventMap.set(eventEndDate, endArr)
          }
          endArr.push({ event, date: toEventInstant(event.end, event.timezone) })
        }
      }
    })

    // R4.7: sort each day's events once here rather than in the render body.
    // The render used to do `[...dayEvents].sort(...)` for every day-group on
    // every render; the order only depends on the data, so it belongs in the
    // memo. Semantics are unchanged: all-day events first, then by start time.
    eventMap.forEach((arr) => {
      arr.sort((a, b) => {
        if (a.event.isAllDay && !b.event.isAllDay) return -1
        if (!a.event.isAllDay && b.event.isAllDay) return 1
        return (
          toEventInstant(a.event.start, a.event.timezone).getTime() -
          toEventInstant(b.event.start, b.event.timezone).getTime()
        )
      })
    })

    const todayKey = format(new Date(), 'yyyy-MM-dd')

    const groups: DayGroup[] = []
    let i = 0
    while (i < daysList.length) {
      const day = daysList[i]
      const dateKey = format(day, 'yyyy-MM-dd')
      const dayEvents = eventMap.get(dateKey) || []
      const hasEvents = dayEvents.length > 0
      const isToday = dateKey === todayKey

      if (hasEvents || isToday) {
        groups.push({ type: 'day', days: [day], hasEvents })
        i++
      } else {
        const run: Date[] = [day]
        let j = i + 1
        while (j < daysList.length) {
          const nextDay = daysList[j]
          const nextKey = format(nextDay, 'yyyy-MM-dd')
          if ((eventMap.get(nextKey)?.length ?? 0) > 0) break
          if (nextKey === todayKey) break
          run.push(nextDay)
          j++
        }
        if (run.length === 1) {
          groups.push({ type: 'day', days: run, hasEvents: false })
        } else {
          groups.push({ type: 'skip', days: run, hasEvents: false })
        }
        i = j
      }
    }

    return { eventsByDate: eventMap, dayGroups: groups }
  }, [date, events, getEventsForDateRange, embedded])

  const handleCreateEvent = (day: Date): void => {
    openModal(format(day, 'yyyy-MM-dd'))
  }

  const handleCreateTask = (day: Date): void => {
    openModal(format(day, 'yyyy-MM-dd'), undefined, undefined, 'task')
  }

  const [isScrolled, setIsScrolled] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrolledMonthRef = useRef<string | null>(null)

  const handleScroll = (): void => {
    if (containerRef.current) {
      setIsScrolled(containerRef.current.scrollTop > 0)
    }
  }

  // R3.11 — top-level empty state when the entire month has no events
  // (or all events have been filtered out by category/calendar). Render
  // a single EmptyState instead of N day headers, each saying "no events".
  const allGroupsEmpty = dayGroups.every((g) => !g.hasEvents)

  // R4.7: windowed rows. A month with many events used to mount every
  // day-group at once; now only the visible slice is in the DOM. Row heights
  // vary wildly (a 12-event day vs. a one-line skip row), so heights come from
  // `measureElement` rather than being computed — same pattern as JournalView.
  // `embedded` is virtualized too: the split view still scrolls in this same
  // container (`.container` keeps `overflow: auto` with a bounded height in
  // both modes), only its chrome/padding differs.
  const virtualizer = useVirtualizer({
    count: allGroupsEmpty ? 0 : dayGroups.length,
    getScrollElement: () => containerRef.current,
    // Dynamic estimation prevents scroll stuttering when scrolling backwards
    // from a jumped-to index (like Today), as the virtualizer doesn't have
    // to aggressively adjust scroll offsets for unmeasured rows.
    estimateSize: (index) => {
      const group = dayGroups[index]
      if (group.type === 'skip') return 32
      if (!group.hasEvents) return 46

      const dateKey = format(group.days[0], 'yyyy-MM-dd')
      const sortedEvents = eventsByDate.get(dateKey) || []

      let h = 46
      for (let i = 0; i < sortedEvents.length; i++) {
        const hasLocation = !!sortedEvents[i].event.location
        h += hasLocation ? 62 : 44
      }
      return h
    },
    overscan: 4,
  })

  useEffect(() => {
    const onJumpToToday = () => {
      const today = startOfDay(new Date())
      const todayKey = format(today, 'yyyy-MM-dd')
      const index = dayGroups.findIndex(
        (g) => g.type === 'day' && format(g.days[0], 'yyyy-MM-dd') === todayKey
      )
      if (index !== -1) {
        virtualizer.scrollToIndex(index, { align: 'start', behavior: 'auto' })
        scrolledMonthRef.current = format(startOfMonth(today), 'yyyy-MM')
      }
    }
    window.addEventListener('calino:jumpToToday', onJumpToToday)
    return () => window.removeEventListener('calino:jumpToToday', onJumpToToday)
  }, [dayGroups, virtualizer])

  const renderSkipRow = (group: DayGroup): JSX.Element => {
    const first = group.days[0]
    const last = group.days[group.days.length - 1]
    const freeDays = group.days.length - 1
    const label = `${format(first, 'EEE MMM d')} – ${format(last, 'EEE MMM d')} · ${freeDays} day${freeDays === 1 ? '' : 's'} free`

    return (
      <div className={styles.agendaSkip} key={`skip-${format(first, 'yyyy-MM-dd')}`}>
        <div className={styles.agendaSkipLine} />
        <span className={styles.agendaSkipLabel}>{label}</span>
        <div className={styles.agendaSkipLine} />
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={`${containerClass} ${isScrolled ? styles.containerShadow : ''}`}
      onScroll={handleScroll}
    >
      {/* Keyed by month, not by `currentDate`: in the month+agenda split a day
          tap also sets the date, and re-running the transition on every tap
          would be noise. */}
      <AnimatePresence mode="wait">
        <motion.div key={monthKey} className={styles.monthPane} {...monthChangeMotion}>
          <MonthScrollRestorer
            currentDate={currentDate}
            dayGroups={dayGroups}
            virtualizer={virtualizer}
            scrolledMonthRef={scrolledMonthRef}
          />
          {allGroupsEmpty ? (
            <EmptyState
              title="Nothing scheduled this month"
              description="Your agenda is clear. Add an event to get started."
              action={
                <button
                  className={styles.agendaAdd}
                  onClick={() => handleCreateEvent(new Date())}
                  data-component="agenda-empty-add"
                >
                  + Create event
                </button>
              }
            />
          ) : (
            // flexShrink: 0 — .monthPane is a flex column, and this spacer's height
            // is the virtual list's total size, not something to compress.
            <div
              style={{
                position: 'relative',
                flexShrink: 0,
                height: `${virtualizer.getTotalSize()}px`,
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const group = dayGroups[virtualRow.index]
                const firstKey = format(group.days[0], 'yyyy-MM-dd')

                const row = ((): JSX.Element => {
                  if (group.type === 'skip') {
                    return renderSkipRow(group)
                  }

                  const day = group.days[0]
                  const dateKey = firstKey
                  const sortedEvents = eventsByDate.get(dateKey) || []
                  const isEmpty = !group.hasEvents
                  const isToday = dateKey === format(new Date(), 'yyyy-MM-dd')

                  return (
                    <div
                      key={dateKey}
                      data-date={dateKey}
                      onContextMenu={(e) => handleContextMenu(e, day)}
                    >
                      <div
                        className={`${styles.agendaDayHeader} ${isEmpty ? styles.isEmpty : ''} ${isToday ? styles.isToday : ''}`}
                      >
                        <div className={styles.agendaDayLabel}>
                          <span className={styles.agendaDow}>{format(day, 'EEEE')}</span>
                          <span className={styles.agendaDate}>{format(day, 'MMM d, yyyy')}</span>
                        </div>
                        {!isEmpty && (
                          <button
                            className={styles.agendaAdd}
                            onClick={() => handleCreateEvent(day)}
                          >
                            + Add
                          </button>
                        )}
                      </div>

                      {!isEmpty && (
                        <>
                          {sortedEvents.map(({ event }) => {
                            if (event.type === 'task') {
                              return (
                                <div
                                  key={event.id}
                                  className={`${styles.agendaTask} ${
                                    event.completed ? styles.agendaTaskCompleted : ''
                                  }`}
                                  role="button"
                                  tabIndex={0}
                                  onClick={(e) => handleEventClick(e, event)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault()
                                      handleEventClick(e as unknown as React.MouseEvent, event)
                                    }
                                  }}
                                  onContextMenu={(e) => handleEventContextMenu(e, event)}
                                >
                                  <div className={styles.agendaTaskBar} />
                                  <div className={styles.agendaTaskBody}>
                                    <div className={styles.agendaTaskMain}>
                                      <span className={styles.agendaTaskTime}>
                                        {event.start.includes('T00:00')
                                          ? 'Due'
                                          : formatEventTime(event.start, event.timezone, timeFormat)}
                                      </span>
                                      <button
                                        type="button"
                                        className={styles.agendaTaskIcon}
                                        role="checkbox"
                                        aria-checked={!!event.completed}
                                        aria-label={
                                          event.completed
                                            ? `Mark "${event.title}" as incomplete`
                                            : `Mark "${event.title}" as complete`
                                        }
                                        onClick={(e) => {
                                          // The whole card opens the task; the
                                          // check has to claim its own click.
                                          e.stopPropagation()
                                          void toggleComplete(event)
                                        }}
                                      >
                                        {event.completed ? '✓' : '○'}
                                      </button>
                                      <span className={styles.agendaTaskTitle}>{event.title}</span>
                                    </div>
                                    {event.location && (
                                      <div className={styles.agendaEventSub}>{event.location}</div>
                                    )}
                                  </div>
                                </div>
                              )
                            }

                            return (
                              <div
                                key={event.id}
                                className={styles.agendaEvent}
                                role="button"
                                tabIndex={0}
                                onClick={(e) => handleEventClick(e, event)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    handleEventClick(e as unknown as React.MouseEvent, event)
                                  }
                                }}
                                onContextMenu={(e) => handleEventContextMenu(e, event)}
                              >
                                <div
                                  className={styles.agendaEventBar}
                                  style={{ background: getEventBarColor(event) }}
                                />
                                <div className={styles.agendaEventBody}>
                                  <div className={styles.agendaEventMain}>
                                    <span className={styles.agendaEventTime}>
                                      {event.isAllDay
                                        ? 'All day'
                                        : formatEventTime(event.start, event.timezone, timeFormat)}
                                    </span>
                                    <span className={styles.agendaEventTitle}>{event.title}</span>
                                  </div>
                                  {event.location && (
                                    <div className={styles.agendaEventSub}>
                                      <LocationLink
                                        location={event.location}
                                        className={styles.agendaLocationLink}
                                      />
                                    </div>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                          <div className={styles.agendaDivider} />
                        </>
                      )}

                      {isEmpty && <div className={styles.agendaDivider} />}
                    </div>
                  )
                })()

                const isPast = (() => {
                  if (fadePastDaysInAgenda === 'never') return false
                  const isDayPast = group.days[group.days.length - 1] < startOfDay(new Date())
                  if (!isDayPast) return false
                  if (fadePastDaysInAgenda === 'all') return true
                  return isCurrentMonthView
                })()

                return (
                  <div
                    key={group.type === 'skip' ? `skip-${firstKey}` : firstKey}
                    ref={virtualizer.measureElement}
                    data-index={virtualRow.index}
                    className={isPast ? styles.isPast : ''}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    {row}
                  </div>
                )
              })}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          menuId="agenda-context"
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: 'Create event',
              onClick: () => {
                handleCreateEvent(contextMenu.day)
                setContextMenu(null)
              },
            },
            {
              label: 'Create task',
              onClick: () => {
                handleCreateTask(contextMenu.day)
                setContextMenu(null)
              },
            },
          ]}
        />
      )}
      {eventContextMenu &&
        createPortal(
          <ContextMenu
            x={eventContextMenu.x}
            y={eventContextMenu.y}
            menuId={`agenda-event-${eventContextMenu.event.id}`}
            onClose={() => {
              closeMenu()
              setEventContextMenu(null)
            }}
            items={[
              {
                label: 'Edit',
                onClick: () => {
                  openModal(
                    undefined,
                    undefined,
                    eventContextMenu.event.id,
                    eventContextMenu.event.type === 'task' ? 'task' : 'event'
                  )
                  setEventContextMenu(null)
                },
              },
              {
                label: 'Delete',
                onClick: () => {
                  deleteEventWithUndo({
                    event: eventContextMenu.event,
                    deleteEvent,
                    addEvent,
                    createCalDAVEvent,
                    deleteCalDAVEvent,
                    onAfterDelete: () => setEventContextMenu(null),
                  })
                },
                danger: true,
              },
            ]}
          />,
          document.body
        )}
    </div>
  )
}
