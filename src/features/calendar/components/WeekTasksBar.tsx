import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { format } from 'date-fns'
import { useCalendarStore } from '@/store/calendarStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { completeTaskAndSync } from '@/lib/taskCompletion'
import { formatDisplayDate, toEventInstant } from '@/lib/datetime'
import type { CalendarEvent } from '@/types'
import styles from './WeekTasksBar.module.css'

interface WeekTasksBarProps {
  tasks: CalendarEvent[]
}

function rangeLabel(task: CalendarEvent, t: TFunction<'calendar'>): string {
  const start = toEventInstant(task.start, task.timezone)
  const due = toEventInstant(task.dueDate ?? task.end, task.timezone)
  return t('views.week.weekTaskRange', {
    start: formatDisplayDate(start, 'EEE d MMM'),
    due: formatDisplayDate(due, 'EEE d MMM'),
  })
}

/**
 * "Sometime this week": tasks that span several days and so belong to no
 * particular day column. Shown below the grid; ticking one completes it.
 */
export function WeekTasksBar({ tasks }: WeekTasksBarProps): JSX.Element | null {
  const { t } = useTranslation('calendar')
  const calendars = useCalendarStore((state) => state.calendars)
  const openModal = useCalendarStore((state) => state.openModal)
  const completeTask = useCalendarStore((state) => state.completeTask)
  const completeTaskOccurrence = useCalendarStore((state) => state.completeTaskOccurrence)
  const { updateEvent: updateCalDAVEvent, saveRecurrenceOverride } = useCalDAV()

  if (tasks.length === 0) return null

  const toggle = async (task: CalendarEvent): Promise<void> => {
    try {
      await completeTaskAndSync(task, !task.completed, {
        completeTask,
        completeTaskOccurrence,
        updateCalDAVEvent,
        saveRecurrenceOverride,
      })
    } catch {
      // The CalDAV hook queues failed writes and surfaces their status.
    }
  }

  return (
    <div className={styles.bar} data-component="week-tasks-bar">
      <span className={styles.label}>{t('views.week.sometimeThisWeek')}</span>
      <ul className={styles.list}>
        {tasks.map((task) => {
          const calendar = calendars.find((c) => c.id === task.calendarId)
          const readOnly = calendar?.readOnly === true
          const range = rangeLabel(task, t)
          const tooltip = [task.title, range, task.description].filter(Boolean).join('\n')
          return (
            <li
              key={task.id}
              className={`${styles.pill} ${task.completed ? styles.done : ''}`}
              title={tooltip}
              data-component="week-task-pill"
              style={
                calendar?.color
                  ? ({ '--event-color': calendar.color } as React.CSSProperties)
                  : undefined
              }
              data-testid={`week-task-${task.id}`}
              data-week-start={format(toEventInstant(task.start, task.timezone), 'yyyy-MM-dd')}
            >
              <input
                type="checkbox"
                className={styles.check}
                checked={!!task.completed}
                disabled={readOnly}
                aria-label={task.title}
                onChange={() => void toggle(task)}
              />
              <button
                type="button"
                className={styles.title}
                onClick={() => openModal(undefined, undefined, task.id, 'task')}
              >
                {task.title}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
