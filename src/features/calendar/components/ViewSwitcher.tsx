import type { JSX } from 'react'
import { useState, useRef, useEffect } from 'react'
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

export function ViewSwitcher(): JSX.Element {
  const currentView = useCalendarStore((state) => state.currentView)
  const setCurrentView = useCalendarStore((state) => state.setCurrentView)
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const currentLabel = VIEWS.find((v) => v.value === currentView)?.label || 'Month'

  return (
    <div className={styles.container} ref={containerRef}>
      <button className={styles.dropdownButton} onClick={() => setIsOpen(!isOpen)}>
        {currentLabel}
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          className={`${styles.arrow} ${isOpen ? styles.arrowOpen : ''}`}
        >
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {isOpen && (
        <div className={styles.dropdownMenu}>
          {VIEWS.map((view) => (
            <button
              key={view.value}
              className={clsx(styles.dropdownItem, currentView === view.value && styles.active)}
              onClick={() => {
                setCurrentView(view.value)
                setIsOpen(false)
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
