import type { JSX } from 'react'
import { useState, useCallback, useEffect } from 'react'
import { format, addMonths, addWeeks, addDays, parseISO, startOfWeek, endOfWeek } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { ViewSwitcher } from './ViewSwitcher'
import { ThemeToggle } from './ThemeToggle'
import { useGestures } from '@/hooks/useGestures'
import styles from './CalendarHeader.module.css'

interface CalendarHeaderProps {
  onToggleSidebar?: () => void
  onOpenCommandPalette?: () => void
}

export function CalendarHeader({
  onToggleSidebar,
  onOpenCommandPalette,
}: CalendarHeaderProps): JSX.Element {
  const navigate = useNavigate()
  const currentDate = useCalendarStore((state) => state.currentDate)
  const currentView = useCalendarStore((state) => state.currentView)
  const setCurrentDate = useCalendarStore((state) => state.setCurrentDate)
  const firstDayOfWeek = useSettingsStore((state) => state.firstDayOfWeek)

  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  )

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  const date = parseISO(currentDate)

  const getTitle = (): string => {
    switch (currentView) {
      case 'month':
        return format(date, 'MMMM')
      case 'week': {
        const weekStart = startOfWeek(date, { weekStartsOn: firstDayOfWeek })
        const weekEnd = endOfWeek(date, { weekStartsOn: firstDayOfWeek })
        if (format(weekStart, 'MMM') === format(weekEnd, 'MMM')) {
          return `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'd')}`
        }
        return `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d')}`
      }
      case 'day':
        return format(date, 'EEE, MMMM d')
      case 'agenda':
        return format(date, 'MMMM')
      case 'todo':
        return 'Tasks'
      default:
        return format(date, 'MMMM')
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
      case 'todo':
        newDate = date
        break
      default:
        newDate = date
    }
    setCurrentDate(format(newDate, 'yyyy-MM-dd'))
  }

  const handleToday = (): void => {
    setCurrentDate(format(new Date(), 'yyyy-MM-dd'))
  }

  const handleSwipe = useCallback(
    (direction: 'left' | 'right' | 'up' | 'down') => {
      const dir = direction === 'left' ? 'next' : direction === 'right' ? 'prev' : null
      if (!dir) return

      let newDate: Date
      switch (currentView) {
        case 'month':
          newDate = dir === 'prev' ? addMonths(date, -1) : addMonths(date, 1)
          break
        case 'week':
          newDate = dir === 'prev' ? addWeeks(date, -1) : addWeeks(date, 1)
          break
        case 'day':
          newDate = dir === 'prev' ? addDays(date, -1) : addDays(date, 1)
          break
        case 'agenda':
          newDate = dir === 'prev' ? addMonths(date, -1) : addMonths(date, 1)
          break
        case 'todo':
          newDate = date
          break
        default:
          newDate = date
      }
      setCurrentDate(format(newDate, 'yyyy-MM-dd'))
    },
    [currentView, date, setCurrentDate]
  )

  const { bind } = useGestures({
    onSwipe: handleSwipe,
    swipeThreshold: 50,
  })

  return (
    <div className={styles.header} {...bind}>
      <div className={styles.left}>
        <button className={styles.hamburger} onClick={onToggleSidebar} aria-label="Toggle menu">
          <MenuIcon />
        </button>
        <h1 className={styles.title}>{getTitle()}</h1>
        {!isMobile && (
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
        )}
      </div>
      <div className={styles.right}>
        <button
          className={`${styles.searchButton} ${styles.searchButtonMobile}`}
          onClick={onOpenCommandPalette}
          aria-label="Search or commands"
        >
          <SearchIcon />
        </button>
        <ViewSwitcher className={isMobile ? styles.mobileViewSwitcher : undefined} />
        {!isMobile && (
          <>
            <ThemeToggle className={`${styles.createButton} ${styles.themeToggle}`} />
            <button className={styles.createButton} onClick={() => navigate('/settings')}>
              <SettingsIcon />
            </button>
          </>
        )}
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

function MenuIcon(): JSX.Element {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3 12H21M3 6H21M3 18H21"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SearchIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2" />
      <path d="M21 21L16.65 16.65" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function SettingsIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 15a3 3 0 100-6 3 3 0 000 6z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
