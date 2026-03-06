import type { JSX } from 'react'
import { useMemo, useState, useRef, useEffect } from 'react'
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  parseISO,
  isToday,
  startOfDay,
} from 'date-fns'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import type { CalendarEvent } from '@/types'
import styles from './AgendaView.module.css'

interface EventWithDate {
  event: CalendarEvent
  date: Date
}

export function AgendaView(): JSX.Element {
  const currentDate = useCalendarStore((state) => state.currentDate)
  const events = useCalendarStore((state) => state.events)
  const calendars = useCalendarStore((state) => state.calendars)
  const getEventsForDateRange = useCalendarStore((state) => state.getEventsForDateRange)
  const openModal = useCalendarStore((state) => state.openModal)
  const timeFormat = useSettingsStore((state) => state.timeFormat)

  const date = parseISO(currentDate)

  const { eventsByDate, days } = useMemo(() => {
    const monthStart = startOfMonth(date)
    const monthEnd = endOfMonth(date)
    const daysList = eachDayOfInterval({ start: monthStart, end: monthEnd })
    const events = getEventsForDateRange(
      format(monthStart, 'yyyy-MM-dd'),
      format(monthEnd, 'yyyy-MM-dd')
    )

    const eventMap = new Map<string, EventWithDate[]>()
    events.forEach((event) => {
      const eventDate = format(parseISO(event.start), 'yyyy-MM-dd')
      const existing = eventMap.get(eventDate) || []
      eventMap.set(eventDate, [...existing, { event, date: parseISO(event.start) }])

      if (!event.isAllDay) {
        const eventEndDate = format(parseISO(event.end), 'yyyy-MM-dd')
        if (eventEndDate !== eventDate) {
          const endExisting = eventMap.get(eventEndDate) || []
          eventMap.set(eventEndDate, [...endExisting, { event, date: parseISO(event.end) }])
        }
      }
    })

    return { eventsByDate: eventMap, days: daysList }
  }, [date, events, calendars, getEventsForDateRange])

  const handleCreateEvent = (day: Date): void => {
    openModal(format(day, 'yyyy-MM-dd'))
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
  }, [currentDate, days])

  return (
    <div
      ref={containerRef}
      className={`${styles.container} ${isScrolled ? styles.containerShadow : ''}`}
      onScroll={handleScroll}
    >
      {days.map((day) => {
        const dateKey = format(day, 'yyyy-MM-dd')
        const dayEvents = eventsByDate.get(dateKey) || []
        const isCurrentDay = isToday(day)

        const sortedEvents = [...dayEvents].sort((a, b) => {
          if (a.event.isAllDay && !b.event.isAllDay) return -1
          if (!a.event.isAllDay && b.event.isAllDay) return 1
          return parseISO(a.event.start).getTime() - parseISO(b.event.start).getTime()
        })

        return (
          <div key={dateKey} className={styles.dayGroup} data-date={dateKey}>
            <div className={`${styles.dayHeader} ${isCurrentDay ? styles.today : ''}`}>
              <div className={styles.dayInfo}>
                <span className={styles.dayName}>{format(day, 'EEEE')}</span>
                <span className={styles.dayDate}>{format(day, 'MMMM d, yyyy')}</span>
              </div>
              <button className={styles.addButton} onClick={() => handleCreateEvent(day)}>
                + Add
              </button>
            </div>
            <div className={styles.events}>
              {sortedEvents.length === 0 ? (
                <div className={styles.empty}>No events</div>
              ) : (
                sortedEvents.map(({ event }) => (
                  <div
                    key={event.id}
                    className={`${styles.eventItem} ${event.type === 'task' ? styles.taskItem : ''}`}
                  >
                    <div className={styles.eventTime}>
                      {event.type === 'task'
                        ? 'Due'
                        : event.isAllDay
                          ? 'All day'
                          : format(
                              parseISO(event.start),
                              timeFormat === '24h' ? 'HH:mm' : 'h:mm a'
                            )}
                    </div>
                    <div className={styles.eventDetails}>
                      <div className={styles.eventTitle}>
                        {event.type === 'task' && (
                          <span className={styles.taskIcon}>{event.completed ? '✓' : '○'}</span>
                        )}
                        {event.title}
                      </div>
                      {event.location && (
                        <div className={styles.eventLocation}>{event.location}</div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
