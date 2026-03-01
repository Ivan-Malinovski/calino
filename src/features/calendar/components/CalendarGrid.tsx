import type { JSX } from 'react'
import { useMemo } from 'react'
import { AnimatePresence } from 'framer-motion'
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  eachWeekOfInterval,
  isSameMonth,
  isToday,
  parseISO,
  getISOWeek,
} from 'date-fns'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { EventCard } from './EventCard'
import type { CalendarEvent } from '@/types'
import styles from './CalendarGrid.module.css'

export function CalendarGrid(): JSX.Element {
  const currentDate = useCalendarStore((state) => state.currentDate)
  const events = useCalendarStore((state) => state.events)
  const calendars = useCalendarStore((state) => state.calendars)
  const getEventsForDateRange = useCalendarStore((state) => state.getEventsForDateRange)
  const openModal = useCalendarStore((state) => state.openModal)
  const firstDayOfWeek = useSettingsStore((state) => state.firstDayOfWeek)

  const weekdays = useMemo(() => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const idx = firstDayOfWeek || 0
    return [...days.slice(idx), ...days.slice(0, idx)]
  }, [firstDayOfWeek])

  const date = parseISO(currentDate)

  const days = useMemo(() => {
    const monthStart = startOfMonth(date)
    const monthEnd = endOfMonth(date)
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: firstDayOfWeek })
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: firstDayOfWeek })

    return eachDayOfInterval({ start: calendarStart, end: calendarEnd })
  }, [date, firstDayOfWeek])

  const weeks = useMemo(() => {
    const monthStart = startOfMonth(date)
    const monthEnd = endOfMonth(date)
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: firstDayOfWeek })
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: firstDayOfWeek })

    return eachWeekOfInterval({
      start: calendarStart,
      end: calendarEnd,
      weekStartsOn: firstDayOfWeek || 0,
    })
  }, [date, firstDayOfWeek])

  const weekNumbers = useMemo(() => {
    return weeks.map((weekStart) => getISOWeek(weekStart))
  }, [weeks])

  const eventsMap = useMemo(() => {
    const monthStart = startOfMonth(date)
    const monthEnd = endOfMonth(date)
    const events = getEventsForDateRange(
      format(monthStart, 'yyyy-MM-dd'),
      format(monthEnd, 'yyyy-MM-dd')
    )

    const map = new Map<string, CalendarEvent[]>()
    events.forEach((event) => {
      const eventDate = format(parseISO(event.start), 'yyyy-MM-dd')
      const existing = map.get(eventDate) || []
      map.set(eventDate, [...existing, event])
    })
    return map
  }, [date, events, calendars, getEventsForDateRange])

  const handleDayClick = (day: Date): void => {
    openModal(format(day, 'yyyy-MM-dd'))
  }

  const daysWithWeeks = useMemo(() => {
    const result: { day: Date; weekNum: number }[] = []
    let currentWeekStart = days[0]
    let weekIndex = 0

    days.forEach((day) => {
      const dayWeekStart = startOfWeek(day, { weekStartsOn: firstDayOfWeek || 0 })
      if (dayWeekStart.getTime() !== currentWeekStart.getTime()) {
        currentWeekStart = dayWeekStart
        weekIndex++
      }
      result.push({
        day,
        weekNum: weekNumbers[weekIndex],
      })
    })
    return result
  }, [days, weekNumbers, firstDayOfWeek])

  return (
    <div className={styles.grid}>
      <div className={styles.header}>
        <div className={styles.weekNumHeader}>W#</div>
        {weekdays.map((day) => (
          <div key={day} className={styles.weekday}>
            {day}
          </div>
        ))}
      </div>
      <div className={styles.daysContainer}>
        {weekNumbers.map((weekNum, weekIdx) => (
          <div key={weekIdx} className={styles.weekRow}>
            <div className={styles.weekNumber}>{weekNum}</div>
            {daysWithWeeks
              .filter((d) => d.weekNum === weekNum)
              .map(({ day }) => {
                const dateKey = format(day, 'yyyy-MM-dd')
                const dayEvents = eventsMap.get(dateKey) || []
                const isCurrentMonth = isSameMonth(day, date)
                const isTodayDate = isToday(day)

                return (
                  <div
                    key={dateKey}
                    className={`${styles.day} ${!isCurrentMonth ? styles.otherMonth : ''} ${isTodayDate ? styles.today : ''}`}
                    onClick={() => handleDayClick(day)}
                  >
                    <div className={styles.dayHeader}>
                      <span className={styles.dayNumber}>{format(day, 'd')}</span>
                    </div>
                    <div className={styles.events}>
                      <AnimatePresence>
                        {dayEvents.slice(0, 3).map((event) => (
                          <EventCard key={event.id} event={event} />
                        ))}
                      </AnimatePresence>
                      {dayEvents.length > 3 && (
                        <div className={styles.moreEvents}>+{dayEvents.length - 3} more</div>
                      )}
                    </div>
                  </div>
                )
              })}
          </div>
        ))}
      </div>
    </div>
  )
}
