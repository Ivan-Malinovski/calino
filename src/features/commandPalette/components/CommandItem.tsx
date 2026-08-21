import type { JSX } from 'react'
import { format, parseISO } from 'date-fns'
import { formatTime } from '@/lib/datetime'
import { describeRecurrenceRule } from '@/lib/recurrence'
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
    // `new Date(...)` reads a bare 'yyyy-MM-dd' as UTC midnight, which shifts
    // the day itself west of Greenwich — parseISO keeps it local. Journal
    // entries are day-scoped, so they get no time either way.
    const start = parseISO(event.start)
    const dayOnly = event.type === 'journal' || !event.start.includes('T')
    return (
      <>
        <span className={styles.eventColor} style={{ backgroundColor: calendarColor }} />
        <div className={styles.body}>
          <div className={styles.title}>
            {event.title}
            {event.recurrence && (
              <span
                className={styles.recurringBadge}
                title={event.recurrence}
                aria-label="Recurring"
              >
                ↻
              </span>
            )}
          </div>
          <div className={styles.desc}>
            {format(start, 'EEE, d MMM yyyy')}
            {!dayOnly && ` ${formatTime(start, timeFormat)}`}
            {event.recurrence && ` · ${event.recurrence}`}
          </div>
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
    // Quick-add creates the series without opening the modal, so the row has
    // to say so up front — same badge + description suffix an existing
    // recurring event gets above.
    const recurrence = qa.recurrence ? describeRecurrenceRule(qa.recurrence) : undefined
    return (
      <>
        <span className={styles.icon}>{isTaskItem ? '○' : '+'}</span>
        <div className={styles.body}>
          <div className={styles.title}>
            {isTaskItem ? 'Task: ' : 'Create: '}
            {qa.title}
            {recurrence && (
              <span className={styles.recurringBadge} title={recurrence} aria-label="Recurring">
                ↻
              </span>
            )}
          </div>
          <div className={styles.desc}>
            {format(qa.startDate, 'EEEE, MMMM d')}
            {qa.endDate &&
              ` ${formatTime(qa.startDate, timeFormat)} – ${formatTime(qa.endDate, timeFormat)}`}
            {!qa.endDate && !qa.isAllDay && ` ${formatTime(qa.startDate, timeFormat)}`}
            {qa.isAllDay && ' (all day)'}
            {qa.location && ` at ${qa.location}`}
            {recurrence && ` · ${recurrence}`}
            <span className={styles.confidence}> · {confidencePercent}%</span>
          </div>
        </div>
      </>
    )
  }

  return <div className={styles.title}>Unknown</div>
}
