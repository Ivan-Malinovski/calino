import type { JSX } from 'react'
import type { Calendar } from '@/types'
import styles from './TaskCalendarLabel.module.css'

interface TaskCalendarLabelProps {
  calendar?: Calendar
  visible: boolean
  compact?: boolean
  placement?: 'metadata' | 'reveal'
}

export function TaskCalendarLabel({
  calendar,
  visible,
  compact = false,
  placement = 'metadata',
}: TaskCalendarLabelProps): JSX.Element | null {
  if (!visible || !calendar) return null

  return (
    <span
      className={`${styles.label} ${compact ? styles.compact : ''} ${placement === 'reveal' ? styles.reveal : ''}`}
      title={calendar.name}
      data-component="task-calendar-label"
      data-calendar-id={calendar.id}
    >
      <span
        className={styles.dot}
        style={{ backgroundColor: calendar.color }}
        aria-hidden="true"
        data-component="task-calendar-dot"
      />
      <span className={styles.name}>{calendar.name}</span>
    </span>
  )
}
