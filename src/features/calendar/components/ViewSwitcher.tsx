import type { JSX } from 'react'
import { useState, useEffect, useRef } from 'react'
import clsx from 'clsx'
import { useCalendarStore } from '@/store/calendarStore'
import type { ViewType } from '@/types'
import styles from './ViewSwitcher.module.css'

const VIEWS: { value: ViewType; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
  { value: 'agenda', label: 'Agenda' },
]

interface ViewSwitcherProps {
  className?: string
}

export function ViewSwitcher({ className }: ViewSwitcherProps): JSX.Element {
  const currentView = useCalendarStore((state) => state.currentView)
  const setCurrentView = useCalendarStore((state) => state.setCurrentView)
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  )
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false)
      }
    }
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isDropdownOpen])

  if (isMobile) {
    return (
      <div className={clsx(styles.dropdown, className)} ref={dropdownRef}>
        <button
          className={styles.dropdownButton}
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
        >
          {VIEWS.find((v) => v.value === currentView)?.label}
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            className={clsx(styles.dropdownArrow, isDropdownOpen && styles.dropdownArrowOpen)}
          >
            <path
              d="M3 4.5L6 7.5L9 4.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {isDropdownOpen && (
          <div className={styles.dropdownMenu}>
            {VIEWS.map((view) => (
              <button
                key={view.value}
                className={clsx(styles.dropdownItem, currentView === view.value && styles.active)}
                onClick={() => {
                  setCurrentView(view.value)
                  setIsDropdownOpen(false)
                }}
              >
                {view.label}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={clsx(styles.container, className)}>
      {VIEWS.map((view) => (
        <button
          key={view.value}
          className={clsx(styles.button, currentView === view.value && styles.active)}
          onClick={() => setCurrentView(view.value)}
        >
          {view.label}
        </button>
      ))}
    </div>
  )
}
