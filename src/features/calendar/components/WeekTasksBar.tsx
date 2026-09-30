import type { JSX, KeyboardEvent, MouseEvent } from 'react'
import { useState } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { format } from 'date-fns'
import { useCalendarStore } from '@/store/calendarStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { completeTaskAndSync } from '@/lib/taskCompletion'
import { safeCalDAVUpdate } from '@/lib/caldavHelpers'
import { createUuid } from '@/lib/uuid'
import { showToast } from '@/lib/toast'
import { formatDisplayDate, toEventInstant } from '@/lib/datetime'
import { useContextMenuStore } from '@/store/contextMenuStore'
import type { CalendarEvent } from '@/types'
import { TaskContextMenu } from './TaskContextMenu'
import styles from './WeekTasksBar.module.css'

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
  const openModal = useCalendarStore((state) => state.openModal)
  const addEvent = useCalendarStore((state) => state.addEvent)
  const completeTask = useCalendarStore((state) => state.completeTask)
  const completeTaskOccurrence = useCalendarStore((state) => state.completeTaskOccurrence)
  const {
    updateEvent: updateCalDAVEvent,
    createEvent: createCalDAVEvent,
    saveRecurrenceOverride,
  } = useCalDAV()
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const closeAdd = (): void => {
    setDraft('')
    setAdding(false)
  }
  const openMenu = useContextMenuStore((state) => state.openMenu)
  const closeMenu = useContextMenuStore((state) => state.closeMenu)
  const [taskMenu, setTaskMenu] = useState<{ task: CalendarEvent; x: number; y: number } | null>(
    null
  )

  const closeTaskMenu = (): void => {
    closeMenu()
    setTaskMenu(null)
  }

  const handleContextMenu = (e: MouseEvent, task: CalendarEvent): void => {
    // Suppress the native menu unconditionally (Android's long-press too), but
    // only open ours for a real right-click.
    e.preventDefault()
    e.stopPropagation()
    if (e.button !== 2) return
    openMenu(`task-${task.id}`)
    setTaskMenu({ task, x: e.clientX, y: e.clientY })
  }

  // Same rule the task form uses for its default: the default calendar, or the
  // first one, among those that can hold a VTODO and are not read-only.
  const taskCalendars = calendars.filter(
    (c) => !c.readOnly && (!c.supportedComponents || c.supportedComponents.includes('VTODO'))
  )
  const targetCalendar = taskCalendars.find((c) => c.isDefault) ?? taskCalendars[0]

  // The whole week is stored, DTSTART on its first day and DUE on its last, so
  // the task is week-scoped to any other CalDAV client too.
  const openForm = (title?: string): void =>
    openModal(weekEndKey, undefined, undefined, 'task', title, undefined, undefined, weekStartKey)

  const quickAdd = (): void => {
    const title = draft.trim()
    if (!title) return
    if (!targetCalendar) {
      showToast(t('views.week.noTaskCalendar'))
      return
    }
    const newTask: CalendarEvent = {
      id: createUuid(),
      title,
      calendarId: targetCalendar.id,
      start: `${weekStartKey}T00:00:00`,
      end: `${weekEndKey}T23:59:59`,
      isAllDay: true,
      type: 'task',
      dueDate: weekEndKey,
      completed: false,
    }
    addEvent(newTask)
    setDraft('')
    void safeCalDAVUpdate(createCalDAVEvent, newTask.calendarId, newTask, {})
  }

  const onDraftKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      quickAdd()
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      closeAdd()
    }
  }

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
              className={`${styles.pill} ${task.completed ? styles.done : ''}`}
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
            </DraggablePill>
          )
        })}
        <li className={styles.add}>
          <button
            type="button"
            className={styles.addButton}
            onClick={() => (adding ? closeAdd() : setAdding(true))}
            aria-label={t('views.week.addWeekTask')}
            aria-expanded={adding}
            title={t('views.week.addWeekTask')}
            data-component="week-task-add"
          >
            +
          </button>
          {adding && (
            <>
              <input
                type="text"
                autoFocus
                className={styles.addInput}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onDraftKeyDown}
                onBlur={() => {
                  if (!draft.trim()) setAdding(false)
                }}
                placeholder={t('views.week.quickAddPlaceholder')}
                aria-label={t('views.week.quickAddPlaceholder')}
                data-component="week-task-quick-add"
              />
              <button
                type="button"
                className={styles.addButton}
                // Keep focus in the field so its blur does not close it first.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  openForm(draft.trim() || undefined)
                  closeAdd()
                }}
                aria-label={t('views.week.addWeekTaskDetails')}
                title={t('views.week.addWeekTaskDetails')}
                data-component="week-task-add-details"
              >
                …
              </button>
            </>
          )}
        </li>
      </ul>
      {taskMenu && (
        <TaskContextMenu
          task={taskMenu.task}
          x={taskMenu.x}
          y={taskMenu.y}
          menuId={`task-${taskMenu.task.id}`}
          onEdit={() => openModal(undefined, undefined, taskMenu.task.id, 'task')}
          onClose={closeTaskMenu}
        />
      )}
    </div>
  )
}
