import type { JSX } from 'react'
import { useMemo, useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
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
import { config } from '@/config'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { AddCalendarModal } from './AddCalendarModal'
import styles from './Sidebar.module.css'

const CALENDAR_COLORS = [
  '#4285F4',
  '#EA4335',
  '#34A853',
  '#FBBC05',
  '#FF6D01',
  '#46BDC6',
  '#7B1FA2',
  '#C2185B',
  '#00796B',
  '#F57C00',
  '#455A64',
  '#5D4037',
]

function getNextColor(currentColor: string): string {
  const idx = CALENDAR_COLORS.indexOf(currentColor)
  return CALENDAR_COLORS[(idx + 1) % CALENDAR_COLORS.length]
}

export function Sidebar(): JSX.Element {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [showYearDropdown, setShowYearDropdown] = useState(false)
  const [showMonthDropdown, setShowMonthDropdown] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const currentDate = useCalendarStore((state) => state.currentDate)
  const setCurrentDate = useCalendarStore((state) => state.setCurrentDate)
  const calendars = useCalendarStore((state) => state.calendars)
  const toggleCalendarVisibility = useCalendarStore((state) => state.toggleCalendarVisibility)
  const updateCalendar = useCalendarStore((state) => state.updateCalendar)
  const firstDayOfWeek = useSettingsStore((state) => state.firstDayOfWeek)
  const showAddCalendar = useCalendarStore((state) => state.showAddCalendar)
  const setShowAddCalendar = useCalendarStore((state) => state.setShowAddCalendar)

  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 11 }, (_, i) => currentYear - 5 + i)
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]

  const handleMonthClick = (): void => {
    setShowMonthDropdown(!showMonthDropdown)
  }

  const handleMonthSelect = (monthIndex: number): void => {
    const newDate = new Date(date.getFullYear(), monthIndex, 1)
    setCurrentDate(format(newDate, 'yyyy-MM-dd'))
    setShowMonthDropdown(false)
  }

  const handleYearClick = (): void => {
    setShowYearDropdown(!showYearDropdown)
  }

  const handleYearSelect = (year: number): void => {
    const newDate = new Date(date.getFullYear(), date.getMonth(), 1)
    newDate.setFullYear(year)
    setCurrentDate(format(newDate, 'yyyy-MM-dd'))
    setShowYearDropdown(false)
  }

  const handleClickOutside = (e: MouseEvent): void => {
    if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
      setShowYearDropdown(false)
      setShowMonthDropdown(false)
    }
  }

  useEffect(() => {
    if (showYearDropdown || showMonthDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showYearDropdown, showMonthDropdown])

  const handleStartRename = (id: string, name: string): void => {
    setEditingId(id)
    setEditName(name)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  const handleFinishRename = (): void => {
    if (editingId && editName.trim()) {
      updateCalendar(editingId, { name: editName.trim() })
    }
    setEditingId(null)
    setEditName('')
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      handleFinishRename()
    } else if (e.key === 'Escape') {
      setEditingId(null)
      setEditName('')
    }
  }

  const handleColorClick = (calendarId: string, currentColor: string): void => {
    const nextColor = getNextColor(currentColor)
    updateCalendar(calendarId, { color: nextColor })
  }

  const date = parseISO(currentDate)

  const miniCalendarDays = useMemo(() => {
    const parsedDate = parseISO(currentDate)
    const monthStart = startOfMonth(parsedDate)
    const monthEnd = endOfMonth(parsedDate)
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: firstDayOfWeek })
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: firstDayOfWeek })
    return eachDayOfInterval({ start: calendarStart, end: calendarEnd })
  }, [currentDate, firstDayOfWeek])

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
          <div style={{ position: 'relative' }} ref={dropdownRef}>
            <span className={styles.miniMonth}>
              <button onClick={handleMonthClick} className={styles.miniMonthButton}>
                {format(date, 'MMMM')}
              </button>
              {showMonthDropdown && (
                <div className={styles.yearDropdown}>
                  {months.map((month, index) => (
                    <button
                      key={month}
                      onClick={() => handleMonthSelect(index)}
                      className={`${styles.yearOption} ${
                        index === date.getMonth() ? styles.yearOptionSelected : ''
                      }`}
                    >
                      {month}
                    </button>
                  ))}
                </div>
              )}
              <button onClick={handleYearClick} className={styles.miniMonthButton}>
                {format(date, 'yyyy')}
              </button>
              {showYearDropdown && (
                <div className={`${styles.yearDropdown} ${styles.yearDropdownRight}`}>
                  {years.map((year) => (
                    <button
                      key={year}
                      onClick={() => handleYearSelect(year)}
                      className={`${styles.yearOption} ${
                        year === date.getFullYear() ? styles.yearOptionSelected : ''
                      }`}
                    >
                      {year}
                    </button>
                  ))}
                </div>
              )}
            </span>
          </div>
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
        <div className={styles.sectionTitleRow}>
          <span className={styles.sectionTitle}>My Calendars</span>
          <button
            className={styles.addCalendarButton}
            onClick={() => setShowAddCalendar(true)}
            title="Add calendar"
          >
            <PlusIcon />
          </button>
        </div>
        {calendars.map((calendar) => (
          <label key={calendar.id} className={styles.calendarItem}>
            <input
              type="checkbox"
              checked={calendar.isVisible}
              onChange={() => toggleCalendarVisibility(calendar.id)}
              className={styles.checkbox}
            />
            <button
              className={styles.colorDot}
              style={{ backgroundColor: calendar.color }}
              onClick={() => handleColorClick(calendar.id, calendar.color)}
              title="Click to change color"
            />
            {editingId === calendar.id ? (
              <input
                ref={inputRef}
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={handleFinishRename}
                onKeyDown={handleKeyDown}
                className={styles.renameInput}
              />
            ) : (
              <span
                className={styles.calendarName}
                onDoubleClick={() => handleStartRename(calendar.id, calendar.name)}
              >
                {calendar.name}
              </span>
            )}
          </label>
        ))}
      </div>

      <div className={styles.footer}>
        <Link to="/privacy" className={styles.footerLink}>
          Privacy
        </Link>
        <a
          href={`https://github.com/${config.githubRepo}`}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.footerLink}
        >
          GitHub
        </a>
      </div>

      <AddCalendarModal isOpen={showAddCalendar} onClose={() => setShowAddCalendar(false)} />
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

function PlusIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M7 3V11M3 7H11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
