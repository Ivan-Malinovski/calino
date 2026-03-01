import type { JSX } from 'react'
import { useMemo } from 'react'
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
} from 'date-fns'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { EventCard } from './EventCard'
import type { CalendarEvent } from '@/types'
import styles from './WeekView.module.css'

const HOURS = eachHourOfInterval({
  start: startOfDay(new Date()),
  end: endOfDay(new Date()),
})

export function WeekView(): JSX.Element {
  const currentDate = useCalendarStore((state) => state.currentDate)
  const events = useCalendarStore((state) => state.events)
  const calendars = useCalendarStore((state) => state.calendars)
  const getEventsForDateRange = useCalendarStore((state) => state.getEventsForDateRange)
  const openModal = useCalendarStore((state) => state.openModal)
  const firstDayOfWeek = useSettingsStore((state) => state.firstDayOfWeek)

  const date = parseISO(currentDate)

  const weekDays = useMemo(() => {
    const weekStart = startOfWeek(date, { weekStartsOn: firstDayOfWeek })
    const weekEnd = endOfWeek(date, { weekStartsOn: firstDayOfWeek })
    return eachDayOfInterval({ start: weekStart, end: weekEnd })
  }, [date, firstDayOfWeek])

  const eventsMap = useMemo(() => {
    const weekStart = startOfWeek(date, { weekStartsOn: firstDayOfWeek })
    const weekEnd = endOfWeek(date, { weekStartsOn: firstDayOfWeek })
    const events = getEventsForDateRange(
      format(weekStart, 'yyyy-MM-dd'),
      format(weekEnd, 'yyyy-MM-dd')
    )

    const map = new Map<string, CalendarEvent[]>()
    events.forEach((event) => {
      const dateKey = format(parseISO(event.start), 'yyyy-MM-dd')
      const existing = map.get(dateKey) || []
      map.set(dateKey, [...existing, event])
    })
    return map
  }, [date, firstDayOfWeek, events, calendars, getEventsForDateRange])

  const handleCellClick = (day: Date, hour: Date): void => {
    const hourStr = format(hour, 'HH:mm')
    openModal(`${format(day, 'yyyy-MM-dd')}T${hourStr}`)
  }

  const getEventsForHour = (day: Date, hour: Date): CalendarEvent[] => {
    const dateKey = format(day, 'yyyy-MM-dd')
    const dayEvents = eventsMap.get(dateKey) || []
    const hourStart = hour.getHours()

    return dayEvents.filter((event) => {
      const eventHour = parseISO(event.start).getHours()
      return eventHour === hourStart
    })
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.timeGutter}></div>
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
      <div className={styles.body}>
        {HOURS.map((hour) => (
          <div key={hour.toISOString()} className={styles.hourRow}>
            <div className={styles.timeLabel}>{format(hour, 'h a')}</div>
            {weekDays.map((day) => (
              <div
                key={day.toISOString()}
                className={styles.cell}
                onClick={() => handleCellClick(day, hour)}
              >
                {getEventsForHour(day, hour).map((event) => (
                  <EventCard key={event.id} event={event} />
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
