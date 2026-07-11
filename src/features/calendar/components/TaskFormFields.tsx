import type { JSX } from 'react'
import { useRef } from 'react'
import { format } from 'date-fns'
import type { CalendarEvent, TaskPriority } from '@/types'
import { useScrollInput } from '@/hooks/useScrollInput'
import { useSettingsStore } from '@/store/settingsStore'
import styles from './EventModal.module.css'
import { TimeInput } from './TimeInput'

interface TaskFormFieldsProps {
  completed: boolean
  onCompletedChange: (checked: boolean) => void
  dueDate: string
  onDueDateChange: (date: string) => void
  dueTime: string
  onDueTimeChange: (time: string) => void
  dueAllDay: boolean
  onDueAllDayChange: (checked: boolean) => void
  priority: TaskPriority | undefined
  onPriorityChange: (priority: TaskPriority | undefined) => void
  parentTaskId?: string
  parentTasks: CalendarEvent[]
  onParentTaskChange: (parentTaskId: string | undefined) => void
  subtasks: CalendarEvent[]
  onOpenSubtask: (taskId: string) => void
  onAddSubtask?: () => void
}

const PRIORITY_OPTIONS: { value: TaskPriority | undefined; label: string }[] = [
  { value: undefined, label: 'None' },
  { value: 1, label: 'High' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'Low' },
]

export function TaskFormFields({
  completed,
  onCompletedChange,
  dueDate,
  onDueDateChange,
  dueTime,
  onDueTimeChange,
  dueAllDay,
  onDueAllDayChange,
  priority,
  onPriorityChange,
  parentTaskId,
  parentTasks,
  onParentTaskChange,
  subtasks,
  onOpenSubtask,
  onAddSubtask,
}: TaskFormFieldsProps): JSX.Element {
  const dueDateRef = useRef<HTMLInputElement>(null)
  const timeFormat = useSettingsStore((state) => state.timeFormat)
  const parentTask = parentTasks.find((task) => task.id === parentTaskId)
  const hasDueDate = dueDate.trim().length > 0
  useScrollInput([dueDateRef])

  return (
    <>
      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={completed}
              onChange={(e) => onCompletedChange(e.target.checked)}
            />
            <span>Completed</span>
          </label>
        </div>

        <div className={styles.field}>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={!hasDueDate}
              onChange={(e) =>
                onDueDateChange(e.target.checked ? '' : format(new Date(), 'yyyy-MM-dd'))
              }
              data-component="task-no-due-date"
            />
            <span>No due date</span>
          </label>
        </div>

        {hasDueDate && (
          <div className={styles.field}>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={dueAllDay}
                onChange={(e) => onDueAllDayChange(e.target.checked)}
              />
              <span>Only due date</span>
            </label>
          </div>
        )}
      </div>

      <div className={styles.row} data-component="task-subtasks">
        <div className={styles.field}>
          {parentTask && <div className={styles.helperText} data-component="subtask-parent">Subtask of: {parentTask.title}</div>}
          <label className={styles.label} htmlFor="parent-task-select">
            Parent task
          </label>
          <select
            id="parent-task-select"
            value={parentTaskId ?? ''}
            onChange={(e) => onParentTaskChange(e.target.value || undefined)}
            className={styles.select}
          >
            <option value="">No parent</option>
            {parentTasks.map((task) => (
              <option key={task.id} value={task.id}>{task.title}</option>
            ))}
          </select>
        </div>
        {onAddSubtask && (
          <div className={styles.field}>
            <button type="button" className={styles.secondaryButton} onClick={onAddSubtask} data-component="add-subtask">
              Add subtask
            </button>
          </div>
        )}
      </div>

      {subtasks.length > 0 && (
        <div className={styles.subtaskList}>
          <span className={styles.label}>Subtasks</span>
          {subtasks.map((task) => (
            <button
              key={task.id}
              type="button"
              className={styles.subtaskItem}
              onClick={() => onOpenSubtask(task.id)}
            >
              {task.completed ? '✓ ' : ''}{task.title}
            </button>
          ))}
        </div>
      )}

      <div className={styles.row}>
        {hasDueDate && (
          <>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="due-date">
                Due date
              </label>
              <input
                type="date"
                id="due-date"
                ref={dueDateRef}
                value={dueDate.split('T')[0]}
                onChange={(e) => onDueDateChange(e.target.value)}
                className={styles.input}
              />
            </div>

            {!dueAllDay && (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="due-time">
                  Due time
                </label>
                <TimeInput
                  value={dueTime}
                  timeFormat={timeFormat}
                  onChange={onDueTimeChange}
                  className={styles.input}
                  id="due-time"
                  dataComponent="task-due-time"
                  ariaLabel="Due time"
                />
              </div>
            )}
          </>
        )}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="priority-select">
            Priority
          </label>
          <select
            id="priority-select"
            value={priority ?? ''}
            onChange={(e) =>
              onPriorityChange(
                e.target.value ? (Number(e.target.value) as TaskPriority) : undefined
              )
            }
            className={styles.select}
          >
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option.label} value={option.value ?? ''}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  )
}
