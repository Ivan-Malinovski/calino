import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  addMonths,
  subMonths,
} from 'date-fns'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import styles from './Sidebar.module.css'

export function Sidebar(): JSX.Element {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const currentDate = useCalendarStore((state) => state.currentDate)
  const setCurrentDate = useCalendarStore((state) => state.setCurrentDate)
  const calendars = useCalendarStore((state) => state.calendars)
  const toggleCalendarVisibility = useCalendarStore((state) => state.toggleCalendarVisibility)
  const firstDayOfWeek = useSettingsStore((state) => state.firstDayOfWeek)

  const date = parseISO(currentDate)

  const miniCalendarDays = useMemo(() => {
    const monthStart = startOfMonth(date)
    const monthEnd = endOfMonth(date)
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: firstDayOfWeek })
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: firstDayOfWeek })
    return eachDayOfInterval({ start: calendarStart, end: calendarEnd })
  }, [date, firstDayOfWeek])

  const weekdays = useMemo(() => {
    const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
    const idx = firstDayOfWeek || 0
    return [...days.slice(idx), ...days.slice(0, idx)]
  }, [firstDayOfWeek])

  const handlePrevMonth = (): void => {
    setCurrentDate(format(subMonths(date, 1), 'yyyy-MM-dd'))
  }

  const handleNextMonth = (): void => {
    setCurrentDate(format(addMonths(date, 1), 'yyyy-MM-dd'))
  }

  const handleDayClick = (day: Date): void => {
    setCurrentDate(format(day, 'yyyy-MM-dd'))
  }

  const handleToday = (): void => {
    setCurrentDate(format(new Date(), 'yyyy-MM-dd'))
  }

  if (isCollapsed) {
    return (
      <div className={styles.collapsed}>
        <button
          className={styles.expandButton}
          onClick={() => setIsCollapsed(false)}
          title="Expand sidebar"
        >
          <ChevronRight />
        </button>
      </div>
    )
  }

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.title}>Calendars</span>
        <button
          className={styles.collapseButton}
          onClick={() => setIsCollapsed(true)}
          title="Collapse sidebar"
        >
          <ChevronLeft />
        </button>
      </div>

      <div className={styles.miniCalendar}>
        <div className={styles.miniHeader}>
          <button onClick={handlePrevMonth} className={styles.miniNavBtn}>
            <ChevronLeft />
          </button>
          <span className={styles.miniMonth}>{format(date, 'MMMM yyyy')}</span>
          <button onClick={handleNextMonth} className={styles.miniNavBtn}>
            <ChevronRight />
          </button>
        </div>
        <div className={styles.miniWeekdays}>
          {weekdays.map((day, idx) => (
            <span key={idx} className={styles.miniWeekday}>
              {day}
            </span>
          ))}
        </div>
        <div className={styles.miniDays}>
          {miniCalendarDays.map((day) => {
            const isCurrentMonth = isSameMonth(day, date)
            const isSelected = isSameDay(day, date)
            const isTodayDate = isToday(day)
            return (
              <button
                key={day.toISOString()}
                className={`${styles.miniDay} ${!isCurrentMonth ? styles.otherMonth : ''} ${
                  isSelected ? styles.selected : ''
                } ${isTodayDate ? styles.today : ''}`}
                onClick={() => handleDayClick(day)}
              >
                {format(day, 'd')}
              </button>
            )
          })}
        </div>
        <button className={styles.todayBtn} onClick={handleToday}>
          Today
        </button>
      </div>

      <div className={styles.calendars}>
        <span className={styles.sectionTitle}>My Calendars</span>
        {calendars.map((calendar) => (
          <label key={calendar.id} className={styles.calendarItem}>
            <input
              type="checkbox"
              checked={calendar.isVisible}
              onChange={() => toggleCalendarVisibility(calendar.id)}
              className={styles.checkbox}
            />
            <span className={styles.colorDot} style={{ backgroundColor: calendar.color }} />
            <span className={styles.calendarName}>{calendar.name}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

function ChevronLeft(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M10 12L6 8L10 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ChevronRight(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M6 4L10 8L6 12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function parseISO(dateString: string): Date {
  return new Date(dateString)
}
