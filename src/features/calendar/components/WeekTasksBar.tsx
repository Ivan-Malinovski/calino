import type { JSX } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { format } from 'date-fns'
import { useCalendarStore } from '@/store/calendarStore'
import { formatDisplayDate, toEventInstant } from '@/lib/datetime'
import type { CalendarEvent } from '@/types'
import { useWeekTaskActions } from '../hooks/useWeekTaskActions'
import { TaskContextMenu } from './TaskContextMenu'
import { WeekTaskQuickAdd } from './WeekTaskQuickAdd'
import styles from './WeekTasksBar.module.css'
import controls from './weekTaskControls.module.css'

/** Droppable id of the bar; WeekView turns a task dropped here into a week task. */
export const WEEK_TASKS_DROP_ID = 'weektasks-bar'

/**
 * A pill that can be picked up and dropped on the week grid. The id carries a
 * `::weektask` suffix (WeekView's drag handlers split on `::`) so it cannot
 * collide with the same task's card elsewhere.
 */
function DraggablePill({
  task,
  disabled,
  children,
  ...liProps
}: {
  task: CalendarEvent
  disabled: boolean
  children: React.ReactNode
} & React.LiHTMLAttributes<HTMLLIElement> &
  Record<`data-${string}`, string | undefined>): JSX.Element {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${task.id}::weektask`,
    disabled,
  })
  return (
    <li
      {...liProps}
      {...attributes}
      {...listeners}
      ref={setNodeRef}
      style={{ ...liProps.style, ...(isDragging ? { opacity: 0.4 } : null) }}
    >
      {children}
    </li>
  )
}

interface WeekTasksBarProps {
  tasks: CalendarEvent[]
  /** First and last day (`yyyy-MM-dd`) of the week the bar is showing. */
  weekStartKey: string
  weekEndKey: string
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
export function WeekTasksBar({ tasks, weekStartKey, weekEndKey }: WeekTasksBarProps): JSX.Element {
  const { t } = useTranslation('calendar')
  const calendars = useCalendarStore((state) => state.calendars)
  const { toggle, quickAdd, openForm, openTask, taskMenu, handleContextMenu, closeTaskMenu } =
    useWeekTaskActions({ weekStartKey, weekEndKey })

  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: WEEK_TASKS_DROP_ID })

  return (
    <div
      ref={setDropRef}
      className={`${styles.bar} ${isOver ? styles.dropActive : ''}`}
      data-component="week-tasks-bar"
    >
      <span className={styles.label}>{t('views.week.sometimeThisWeek')}</span>
      <ul className={styles.list}>
        {tasks.map((task) => {
          const calendar = calendars.find((c) => c.id === task.calendarId)
          const readOnly = calendar?.readOnly === true
          const range = rangeLabel(task, t)
          const tooltip = [task.title, range, task.description].filter(Boolean).join('\n')
          return (
            <DraggablePill
              key={task.id}
              task={task}
              disabled={readOnly}
              className={`${styles.pill} ${task.completed ? controls.done : ''}`}
              title={tooltip}
              data-component="week-task-pill"
              onContextMenu={(e) => handleContextMenu(e, task)}
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
                className={controls.check}
                checked={!!task.completed}
                disabled={readOnly}
                aria-label={task.title}
                onChange={() => void toggle(task)}
              />
              <button type="button" className={controls.title} onClick={() => openTask(task.id)}>
                {task.title}
              </button>
            </DraggablePill>
          )
        })}
        <li className={styles.add}>
          <WeekTaskQuickAdd onAdd={quickAdd} onOpenForm={openForm} />
        </li>
      </ul>
      {taskMenu && (
        <TaskContextMenu
          task={taskMenu.task}
          x={taskMenu.x}
          y={taskMenu.y}
          menuId={`task-${taskMenu.task.id}`}
          onEdit={() => openTask(taskMenu.task.id)}
          onClose={closeTaskMenu}
        />
      )}
    </div>
  )
}
