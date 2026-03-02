import type { JSX } from 'react'
import { format } from 'date-fns'
import type { Command, EventResult, CalendarResult, QuickAddResult } from '../types'
import type { TimeFormat } from '@/types'
import styles from './CommandItem.module.css'

interface CommandItemProps {
  item: Command | EventResult | CalendarResult | QuickAddResult
  type: 'command' | 'event' | 'calendar' | 'quick-add'
  isSelected: boolean
  onClick: () => void
  timeFormat: TimeFormat
}

export function CommandItem({
  item,
  type,
  isSelected,
  onClick,
  timeFormat,
}: CommandItemProps): JSX.Element {
  const handleClick = (): void => {
    onClick()
  }

  const formatTime = (date: Date): string => {
    return format(date, timeFormat === '24h' ? 'HH:mm' : 'h:mm a')
  }

  const renderContent = (): JSX.Element => {
    if (type === 'command') {
      const cmd = item as Command
      return (
        <>
          {cmd.icon && <span className={styles.icon}>{cmd.icon}</span>}
          <div className={styles.content}>
            <div className={styles.label}>{cmd.label}</div>
            {cmd.description && <div className={styles.description}>{cmd.description}</div>}
          </div>
          {cmd.shortcut && <span className={styles.shortcut}>{cmd.shortcut}</span>}
        </>
      )
    }

    if (type === 'event') {
      const event = item as EventResult
      const calendarColor = '#4285F4'
      return (
        <>
          <span className={styles.eventColor} style={{ backgroundColor: calendarColor }} />
          <div className={styles.content}>
            <div className={styles.label}>{event.title}</div>
            <div className={styles.description}>{new Date(event.start).toLocaleString()}</div>
          </div>
        </>
      )
    }

    if (type === 'calendar') {
      const cal = item as CalendarResult
      return (
        <>
          <span className={styles.eventColor} style={{ backgroundColor: cal.color }} />
          <div className={styles.content}>
            <div className={styles.label}>{cal.name}</div>
          </div>
        </>
      )
    }

    if (type === 'quick-add') {
      const qa = item as QuickAddResult
      const confidencePercent = Math.round(qa.confidence * 100)
      return (
        <>
          <span className={styles.icon}>➕</span>
          <div className={styles.content}>
            <div className={styles.label}>Create: {qa.title}</div>
            <div className={styles.description}>
              {format(qa.startDate, 'EEEE, MMMM d')}
              {qa.endDate && ` ${formatTime(qa.startDate)} - ${formatTime(qa.endDate)}`}
              {!qa.endDate && !qa.isAllDay && ` ${formatTime(qa.startDate)}`}
              {qa.isAllDay && ' (all day)'}
              {qa.location && ` at ${qa.location}`}
              <span className={styles.confidence}> · {confidencePercent}%</span>
            </div>
          </div>
        </>
      )
    }

    return <div className={styles.label}>Unknown</div>
  }

  return (
    <div
      className={`${styles.item} ${isSelected ? styles.selected : ''}`}
      onClick={handleClick}
      role="option"
      aria-selected={isSelected}
    >
      {renderContent()}
    </div>
  )
}
