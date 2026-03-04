import type { JSX } from 'react'
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

  return (
    <div className={styles.container}>
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
