import type { JSX } from 'react'
import { useMemo, useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  parseISO,
  startOfDay,
} from 'date-fns'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useContextMenuStore } from '@/store/contextMenuStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { deleteEventWithUndo } from '@/lib/deleteWithUndo'
import type { CalendarEvent } from '@/types'
import { ContextMenu } from '@/components/common/ContextMenu'
import { EmptyState } from '@/components/common/EmptyState'
import { getEventColor } from '@/lib/eventColor'
import { formatTime } from '@/lib/datetime'
import { LocationLink } from './LocationLink'
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
  const addEvent = useCalendarStore((state) => state.addEvent)
  const { deleteEvent: deleteCalDAVEvent, createEvent: createCalDAVEvent } = useCalDAV()
  const closeMenu = useContextMenuStore((state) => state.closeMenu)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; day: Date } | null>(null)
  const [eventContextMenu, setEventContextMenu] = useState<{ x: number; y: number; event: CalendarEvent } | null>(null)

  const useCategoryColors = useSettingsStore((state) => state.useCategoryColors)

  const getEventBarColor = (event: CalendarEvent): string =>
    getEventColor(event, { categories, calendars, useCategoryColors })

  const date = parseISO(currentDate)

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
      const eventDate = format(parseISO(event.start), 'yyyy-MM-dd')
      // R4.6: push onto a stable array instead of spreading into a new
      // one. The previous `eventMap.set(k, [...existing, item])` was
      // O(k.length) per event, so for a day with N events it was O(N²)
      // total just to build the map. With push it's O(N).
      let arr = eventMap.get(eventDate)
      if (!arr) {
        arr = []
        eventMap.set(eventDate, arr)
      }
      arr.push({ event, date: parseISO(event.start) })

      if (!event.isAllDay) {
        const eventEndDate = format(parseISO(event.end), 'yyyy-MM-dd')
        if (eventEndDate !== eventDate) {
          let endArr = eventMap.get(eventEndDate)
          if (!endArr) {
            endArr = []
            eventMap.set(eventEndDate, endArr)
          }
          endArr.push({ event, date: parseISO(event.end) })
        }
      }
    })

    const groups: DayGroup[] = []
    let i = 0
    while (i < daysList.length) {
      const day = daysList[i]
      const dateKey = format(day, 'yyyy-MM-dd')
      const dayEvents = eventMap.get(dateKey) || []
      const hasEvents = dayEvents.length > 0

      if (hasEvents) {
        groups.push({ type: 'day', days: [day], hasEvents: true })
        i++
      } else {
        const run: Date[] = [day]
        let j = i + 1
        while (j < daysList.length) {
          const nextDay = daysList[j]
          const nextKey = format(nextDay, 'yyyy-MM-dd')
          if (eventMap.get(nextKey)?.length ?? 0 > 0) break
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
  const hasScrolledRef = useRef(false)

  const handleScroll = (): void => {
    if (containerRef.current) {
      setIsScrolled(containerRef.current.scrollTop > 0)
    }
  }

  useEffect(() => {
    if (containerRef.current && !hasScrolledRef.current) {
      const today = startOfDay(new Date())
      const viewDate = parseISO(currentDate)
      const monthStart = startOfMonth(viewDate)
      const monthEnd = endOfMonth(viewDate)

      if (today >= monthStart && today <= monthEnd) {
        const todayElement = containerRef.current.querySelector(
          `[data-date="${format(today, 'yyyy-MM-dd')}"]`
        )
        if (todayElement) {
          todayElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
          hasScrolledRef.current = true
        }
      }
    }
  }, [currentDate, dayGroups])

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

  // R3.11 — top-level empty state when the entire month has no events
  // (or all events have been filtered out by category/calendar). Render
  // a single EmptyState instead of N day headers, each saying "no events".
  const allGroupsEmpty = dayGroups.every((g) => !g.hasEvents)

  return (
    <div
      ref={containerRef}
      className={`${containerClass} ${isScrolled ? styles.containerShadow : ''}`}
      onScroll={handleScroll}
    >
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
      ) : dayGroups.map((group) => {
        if (group.type === 'skip') {
          return renderSkipRow(group)
        }

        const day = group.days[0]
        const dateKey = format(day, 'yyyy-MM-dd')
        const dayEvents = eventsByDate.get(dateKey) || []
        const isEmpty = !group.hasEvents

        const sortedEvents = [...dayEvents].sort((a, b) => {
          if (a.event.isAllDay && !b.event.isAllDay) return -1
          if (!a.event.isAllDay && b.event.isAllDay) return 1
          return parseISO(a.event.start).getTime() - parseISO(b.event.start).getTime()
        })

        return (
          <div key={dateKey} data-date={dateKey} onContextMenu={(e) => handleContextMenu(e, day)}>
            <div className={`${styles.agendaDayHeader} ${isEmpty ? styles.isEmpty : ''}`}>
              <div className={styles.agendaDayLabel}>
                <span className={styles.agendaDow}>{format(day, 'EEEE')}</span>
                <span className={styles.agendaDate}>{format(day, 'MMM d, yyyy')}</span>
              </div>
              {!isEmpty && (
                <button className={styles.agendaAdd} onClick={() => handleCreateEvent(day)}>
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
                              {event.start.includes('T00:00') ? 'Due' : formatTime(event.start, timeFormat)}
                            </span>
                            <span className={styles.agendaTaskIcon}>
                              {event.completed ? '✓' : '○'}
                            </span>
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
                      <div className={styles.agendaEventBar} style={{ background: getEventBarColor(event) }} />
                      <div className={styles.agendaEventBody}>
                        <div className={styles.agendaEventMain}>
                          <span className={styles.agendaEventTime}>
                            {event.isAllDay
                              ? 'All day'
                              : formatTime(event.start, timeFormat)
                            }
                          </span>
                          <span className={styles.agendaEventTitle}>{event.title}</span>
                        </div>
                        {event.location && (
                          <div className={styles.agendaEventSub}>
                            <LocationLink location={event.location} className={styles.agendaLocationLink} />
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
      })}
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
                  openModal(undefined, undefined, eventContextMenu.event.id, eventContextMenu.event.type === 'task' ? 'task' : 'event')
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
