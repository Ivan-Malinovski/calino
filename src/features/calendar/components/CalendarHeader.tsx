import type { JSX } from 'react'
import { format, addMonths, addWeeks, addDays, parseISO, startOfWeek, endOfWeek } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { useCalendarStore } from '@/store/calendarStore'
import { ViewSwitcher } from './ViewSwitcher'
import { Search } from '@/features/search'
import styles from './CalendarHeader.module.css'

interface CalendarHeaderProps {
  onQuickAdd?: () => void
}

export function CalendarHeader({ onQuickAdd }: CalendarHeaderProps): JSX.Element {
  const navigate = useNavigate()
  const currentDate = useCalendarStore((state) => state.currentDate)
  const currentView = useCalendarStore((state) => state.currentView)
  const setCurrentDate = useCalendarStore((state) => state.setCurrentDate)
  const openModal = useCalendarStore((state) => state.openModal)

  const date = parseISO(currentDate)

  const getTitle = (): string => {
    switch (currentView) {
      case 'month':
        return format(date, 'MMMM yyyy')
      case 'week': {
        const weekStart = startOfWeek(date)
        const weekEnd = endOfWeek(date)
        if (format(weekStart, 'MMM') === format(weekEnd, 'MMM')) {
          return `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'd, yyyy')}`
        }
        return `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d, yyyy')}`
      }
      case 'day':
        return format(date, 'EEEE, MMMM d, yyyy')
      case 'agenda':
        return format(date, 'MMMM yyyy')
      default:
        return format(date, 'MMMM yyyy')
    }
  }

  const handleNavigate = (direction: 'prev' | 'next'): void => {
    let newDate: Date
    switch (currentView) {
      case 'month':
        newDate = direction === 'prev' ? addMonths(date, -1) : addMonths(date, 1)
        break
      case 'week':
        newDate = direction === 'prev' ? addWeeks(date, -1) : addWeeks(date, 1)
        break
      case 'day':
        newDate = direction === 'prev' ? addDays(date, -1) : addDays(date, 1)
        break
      case 'agenda':
        newDate = direction === 'prev' ? addMonths(date, -1) : addMonths(date, 1)
        break
      default:
        newDate = date
    }
    setCurrentDate(format(newDate, 'yyyy-MM-dd'))
  }

  const handleToday = (): void => {
    setCurrentDate(format(new Date(), 'yyyy-MM-dd'))
  }

  return (
    <div className={styles.header}>
      <div className={styles.left}>
        <h1 className={styles.title}>{getTitle()}</h1>
        <div className={styles.nav}>
          <button className={styles.navButton} onClick={() => handleNavigate('prev')}>
            <ChevronLeft />
          </button>
          <button className={styles.todayButton} onClick={handleToday}>
            Today
          </button>
          <button className={styles.navButton} onClick={() => handleNavigate('next')}>
            <ChevronRight />
          </button>
        </div>
      </div>
      <div className={styles.right}>
        <Search
          onSelectEvent={(eventId) => {
            useCalendarStore.getState().setSelectedEventId(eventId)
            openModal()
          }}
        />
        <ViewSwitcher />
        <button className={styles.createButton} onClick={onQuickAdd}>
          Quick Add
        </button>
        <button className={styles.createButton} onClick={() => openModal()}>
          + Create
        </button>
        <button className={styles.createButton} onClick={() => navigate('/settings')}>
          <SettingsIcon />
        </button>
      </div>
    </div>
  )
}

function ChevronLeft(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12.5 15L7.5 10L12.5 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ChevronRight(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M7.5 5L12.5 10L7.5 15"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SettingsIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10" cy="10" r="2" stroke="currentColor" strokeWidth="2" />
      <path
        d="M10 1v2M10 17v2M1 10h2M17 10h2M3.93 3.93l1.41 1.41M14.66 14.66l1.41 1.41M3.93 16.07l1.41-1.41M14.66 5.34l1.41-1.41"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
