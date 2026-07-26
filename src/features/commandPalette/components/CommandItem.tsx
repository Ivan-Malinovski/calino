import type { JSX } from 'react'
import { format } from 'date-fns'
import { formatTime } from '@/lib/datetime'
import type { Command, EventResult, CalendarResult, QuickAddResult } from '../types'
import type { TimeFormat } from '@/types'
import styles from './CommandPalette.module.css'

export interface CommandItemContentProps {
  item: Command | EventResult | CalendarResult | QuickAddResult
  type: 'command' | 'event' | 'calendar' | 'quick-add'
  timeFormat: TimeFormat
}

export function renderCommandItemContent({
  item,
  type,
  timeFormat,
}: CommandItemContentProps): JSX.Element {
  if (type === 'command') {
    const cmd = item as Command
    const desc = typeof cmd.description === 'function' ? cmd.description() : cmd.description
    return (
      <>
        {cmd.icon && (
          <span className={styles.icon} dangerouslySetInnerHTML={{ __html: cmd.icon }} />
        )}
        <div className={styles.body}>
          <div className={styles.title}>{cmd.label}</div>
          {desc && <div className={styles.desc}>{desc}</div>}
        </div>
        {cmd.shortcut && <kbd className={styles.kbd}>{cmd.shortcut}</kbd>}
      </>
    )
  }

  if (type === 'event') {
    const event = item as EventResult
    const calendarColor = '#4285F4'
    return (
      <>
        <span className={styles.eventColor} style={{ backgroundColor: calendarColor }} />
        <div className={styles.body}>
          <div className={styles.title}>{event.title}</div>
          <div className={styles.desc}>{new Date(event.start).toLocaleString()}</div>
        </div>
      </>
    )
  }

  if (type === 'calendar') {
    const cal = item as CalendarResult
    return (
      <>
        <span className={styles.eventColor} style={{ backgroundColor: cal.color }} />
        <div className={styles.body}>
          <div className={styles.title}>{cal.name}</div>
        </div>
      </>
    )
  }

  if (type === 'quick-add') {
    const qa = item as QuickAddResult
    const confidencePercent = Math.round(qa.confidence * 100)
    const isTaskItem = qa.isTask
    return (
      <>
        <span className={styles.icon}>{isTaskItem ? '○' : '+'}</span>
        <div className={styles.body}>
          <div className={styles.title}>
            {isTaskItem ? 'Task: ' : 'Create: '}
            {qa.title}
          </div>
          <div className={styles.desc}>
            {format(qa.startDate, 'EEEE, MMMM d')}
            {qa.endDate &&
              ` ${formatTime(qa.startDate, timeFormat)} – ${formatTime(qa.endDate, timeFormat)}`}
            {!qa.endDate && !qa.isAllDay && ` ${formatTime(qa.startDate, timeFormat)}`}
            {qa.isAllDay && ' (all day)'}
            {qa.location && ` at ${qa.location}`}
            <span className={styles.confidence}> · {confidencePercent}%</span>
          </div>
        </div>
      </>
    )
  }

  return <div className={styles.title}>Unknown</div>
}
