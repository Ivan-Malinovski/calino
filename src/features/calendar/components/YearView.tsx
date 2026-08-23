import type { JSX } from 'react'
import { Fragment, useMemo, type MouseEvent } from 'react'
import { useNavigate } from 'react-router'
import {
  format,
  parseISO,
  startOfYear,
  endOfYear,
  eachMonthOfInterval,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isToday,
  getISOWeek,
  getDay,
  addDays,
} from 'date-fns'
import { useTranslation } from 'react-i18next'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import type { ViewType } from '@/types'
import { toEventInstant, formatDisplayDate } from '@/lib/datetime'
import { getNarrowWeekdayLabels } from './weekdayLabels'
import styles from './YearView.module.css'

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

export function YearView(): JSX.Element {
  const { t } = useTranslation('calendar')
  const currentDate = useCalendarStore((state) => state.currentDate)
  const events = useCalendarStore((state) => state.events)
  const setCurrentDate = useCalendarStore((state) => state.setCurrentDate)
  const setCurrentView = useCalendarStore((state) => state.setCurrentView)
  const getEventsForDateRange = useCalendarStore((state) => state.getEventsForDateRange)
  const firstDayOfWeek = useSettingsStore((state) => state.firstDayOfWeek)
  const showWeekNumbers = useSettingsStore((state) => state.showWeekNumbers)
  const navigate = useNavigate()

  const date = useMemo(() => parseISO(currentDate), [currentDate])

  const months = useMemo(
    () => eachMonthOfInterval({ start: startOfYear(date), end: endOfYear(date) }),
    [date]
  )

  const weekdayInitials = useMemo(
    () => getNarrowWeekdayLabels(firstDayOfWeek || 0),
    [firstDayOfWeek]
  )

  const eventDayKeys = useMemo(() => {
    const yearStart = startOfYear(date)
    const yearEnd = endOfYear(date)
    const yearEvents = getEventsForDateRange(
      format(yearStart, 'yyyy-MM-dd'),
      format(yearEnd, 'yyyy-MM-dd')
    )
    const keys = new Set<string>()
    yearEvents.forEach((event) => {
      try {
        keys.add(format(toEventInstant(event.start, event.timezone), 'yyyy-MM-dd'))
      } catch {
        // ignore malformed dates
      }
    })
    return keys
  }, [date, events, getEventsForDateRange])

  const handleMonthClick = (monthStart: Date): void => {
    setCurrentDate(format(monthStart, 'yyyy-MM-dd'))
    setCurrentView('month')
    navigate(VIEW_ROUTES.month, { replace: true })
  }

  const handleDayClick = (day: Date, e: MouseEvent): void => {
    e.stopPropagation()
    setCurrentDate(format(day, 'yyyy-MM-dd'))
    setCurrentView('day')
    navigate(VIEW_ROUTES.day, { replace: true })
  }

  const handleWeekClick = (weekStart: Date, e: MouseEvent): void => {
    e.stopPropagation()
    setCurrentDate(format(weekStart, 'yyyy-MM-dd'))
    setCurrentView('week')
    navigate(VIEW_ROUTES.week, { replace: true })
  }

  return (
    <div className={styles.container}>
      <div className={styles.grid}>
        {months.map((m) => {
          const days = eachDayOfInterval({
            start: startOfWeek(startOfMonth(m), { weekStartsOn: firstDayOfWeek }),
            end: endOfWeek(endOfMonth(m), { weekStartsOn: firstDayOfWeek }),
          })

          const weeks: Date[][] = []
          for (let i = 0; i < days.length; i += 7) {
            weeks.push(days.slice(i, i + 7))
          }

          return (
            <div
              key={m.toISOString()}
              className={styles.month}
              role="button"
              tabIndex={0}
              onClick={() => handleMonthClick(m)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleMonthClick(m)
                }
              }}
            >
              <div className={styles.monthHeader}>{formatDisplayDate(m, 'MMMM')}</div>
              <div className={`${styles.weekdayRow} ${showWeekNumbers ? styles.withWeekNum : ''}`}>
                {showWeekNumbers && <span className={styles.weekdayInitial} aria-hidden="true" />}
                {weekdayInitials.map((w, i) => (
                  <span key={i} className={styles.weekdayInitial}>
                    {w}
                  </span>
                ))}
              </div>
              <div className={`${styles.dayGrid} ${showWeekNumbers ? styles.withWeekNum : ''}`}>
                {weeks.map((week) => {
                  // Derive the ISO week number from the row's Thursday — the ISO-8601
                  // anchor day — so the number is correct regardless of whether the
                  // visual week starts on Monday or Sunday.
                  const thursday = addDays(week[0], (4 - getDay(week[0]) + 7) % 7)

                  return (
                    <Fragment key={week[0].toISOString()}>
                      {showWeekNumbers && (
                        <button
                          className={styles.weekNum}
                          title={t('views.year.weekNumber', { number: getISOWeek(thursday) })}
                          onClick={(e) => handleWeekClick(week[0], e)}
                        >
                          {getISOWeek(thursday)}
                        </button>
                      )}
                      {week.map((day) => {
                        const dayKey = format(day, 'yyyy-MM-dd')
                        const isOutside = !isSameMonth(day, m)

                        if (isOutside) {
                          return (
                            <span key={dayKey} className={styles.emptyDay} aria-hidden="true" />
                          )
                        }

                        const isTodayDate = isToday(day)
                        const hasEvents = eventDayKeys.has(dayKey)

                        return (
                          <button
                            key={dayKey}
                            className={`${styles.day} ${isTodayDate ? styles.today : ''}`}
                            onClick={(e) => handleDayClick(day, e)}
                          >
                            {format(day, 'd')}
                            {hasEvents && <span className={styles.eventDot} />}
                          </button>
                        )
                      })}
                    </Fragment>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
