import type { JSX } from 'react'
import type { TaskPriority } from '@/types'
import styles from './EventModal.module.css'

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
}: TaskFormFieldsProps): JSX.Element {
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
              checked={dueAllDay}
              onChange={(e) => onDueAllDayChange(e.target.checked)}
            />
            <span>Only due date</span>
          </label>
        </div>
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="due-date">
            Due date
          </label>
          <input
            type="date"
            id="due-date"
            value={dueDate}
            onChange={(e) => onDueDateChange(e.target.value)}
            className={styles.input}
            required
          />
        </div>

        {!dueAllDay && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="due-time">
              Due time
            </label>
            <input
              type="time"
              id="due-time"
              value={dueTime}
              onChange={(e) => onDueTimeChange(e.target.value)}
              className={styles.input}
            />
          </div>
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
