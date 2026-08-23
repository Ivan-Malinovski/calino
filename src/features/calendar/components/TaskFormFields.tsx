import type { JSX } from 'react'
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import type { CalendarEvent, TaskPriority } from '@/types'
import type { TaskTreeItem } from '@/lib/taskTree'
import { TaskCollapseToggle } from './TaskCollapseToggle'
import { useScrollInput } from '@/hooks/useScrollInput'
import { useSettingsStore } from '@/store/settingsStore'
import styles from './EventModal.module.css'
import { TimeField } from './TimeField'
import { RecurrenceFields, RecurrenceToggle, type RecurrenceFieldsProps } from './RecurrenceFields'

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
  subtasks: TaskTreeItem[]
  onOpenSubtask: (taskId: string) => void
  onToggleSubtask: (task: CalendarEvent) => void
  rootTaskId?: string
  rootTaskTitle?: string
  taskHasSubtasks: (taskId: string) => boolean
  taskIsCollapsed: (taskId: string) => boolean
  taskDescendantCount: (taskId: string) => number
  onToggleTaskSubtasks: (taskId: string) => void
  readOnly?: boolean
  readOnlyTaskIds?: Set<string>
  onAddSubtask?: () => void
  /**
   * R2.7 — Recurrence controls, identical to the event form's. Passed through
   * rather than owned here so both forms drive the same `RecurrenceFields`.
   */
  recurrence?: TaskRecurrenceProps
}

/**
 * R2.7 — Everything the shared recurrence UI needs, plus the one task-specific
 * bit: why recurrence may be unavailable.
 */
export interface TaskRecurrenceProps extends Omit<
  RecurrenceFieldsProps,
  'recurring' | 'firstDayOfWeek' | 'startDate'
> {
  recurring: boolean
  onRecurringChange: (recurring: boolean) => void
  /**
   * Non-empty when this task may not recur. Shown next to a disabled toggle —
   * a control that silently vanishes reads as a missing feature.
   */
  disabledReason?: string
}

const PRIORITY_OPTIONS: { value: TaskPriority | undefined; label: string }[] = [
  { value: undefined, label: 'None' },
  { value: 1, label: 'High' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'Low' },
]

type DueMode = 'datetime' | 'dateOnly' | 'none'

const DUE_MODE_OPTIONS: { value: DueMode; label: string; testId: string }[] = [
  { value: 'datetime', label: 'Due date and time', testId: 'due-mode-datetime' },
  { value: 'dateOnly', label: 'Date only', testId: 'due-mode-date-only' },
  { value: 'none', label: 'No due date', testId: 'due-mode-none' },
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
  onToggleSubtask,
  rootTaskId,
  rootTaskTitle,
  taskHasSubtasks,
  taskIsCollapsed,
  taskDescendantCount,
  onToggleTaskSubtasks,
  readOnly = false,
  readOnlyTaskIds,
  onAddSubtask,
  recurrence: recurrenceProps,
}: TaskFormFieldsProps): JSX.Element {
  const { t } = useTranslation('calendar')
  const dueDateRef = useRef<HTMLInputElement>(null)
  const timeFormat = useSettingsStore((state) => state.timeFormat)
  const firstDayOfWeek = useSettingsStore((state) => state.firstDayOfWeek)
  const parentTask = parentTasks.find((task) => task.id === parentTaskId)
  const hasDueDate = dueDate.trim().length > 0
  useScrollInput([dueDateRef])

  const dueMode: DueMode = !hasDueDate ? 'none' : dueAllDay ? 'dateOnly' : 'datetime'
  const dueModeControlRef = useRef<HTMLDivElement>(null)
  const dueModeTabRefs = useRef<Map<DueMode, HTMLButtonElement>>(new Map())
  const [dueModeIndicator, setDueModeIndicator] = useState<{ left: number; width: number }>({
    left: 0,
    width: 0,
  })

  useLayoutEffect(() => {
    const activeTab = dueModeTabRefs.current.get(dueMode)
    // Use offsetLeft/offsetWidth rather than getBoundingClientRect: the
    // modal mounts with a scale() transition, and getBoundingClientRect
    // reflects the in-progress transformed size, producing a pill that's
    // measured too small until something else forces a recalculation.
    // offset* values reflect the untransformed layout box.
    if (activeTab) {
      setDueModeIndicator({
        left: activeTab.offsetLeft,
        width: activeTab.offsetWidth,
      })
    }
  }, [dueMode])

  const handleDueModeChange = (mode: DueMode): void => {
    if (mode === 'none') {
      onDueDateChange('')
      return
    }
    if (!hasDueDate) onDueDateChange(format(new Date(), 'yyyy-MM-dd'))
    onDueAllDayChange(mode === 'dateOnly')
  }

  return (
    <>
      <div className={`${styles.row} ${styles.taskMetaRow}`}>
        <div className={styles.field}>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={completed}
              onChange={(e) => onCompletedChange(e.target.checked)}
            />
            <span>{t('surface.completed')}</span>
          </label>
        </div>

        <div
          className={styles.dueModeControl}
          ref={dueModeControlRef}
          data-component="task-due-mode"
        >
          <div
            className={styles.dueModeIndicator}
            style={{ left: dueModeIndicator.left, width: dueModeIndicator.width }}
          />
          {DUE_MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              ref={(el) => {
                if (el) dueModeTabRefs.current.set(option.value, el)
              }}
              className={`${styles.dueModeTab} ${dueMode === option.value ? styles.dueModeTabActive : ''}`}
              onClick={() => handleDueModeChange(option.value)}
              data-component={option.testId}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`${styles.row} ${styles.parentTaskRow}`} data-component="task-subtasks">
        <div className={styles.field}>
          {parentTask && (
            <div className={styles.helperText} data-component="subtask-parent">
              {t('surface.subtaskOfLabel', { title: parentTask.title })}
            </div>
          )}
          <label className={styles.label} htmlFor="parent-task-select">
            Parent task
          </label>
          <select
            id="parent-task-select"
            value={parentTaskId ?? ''}
            onChange={(e) => onParentTaskChange(e.target.value || undefined)}
            className={styles.select}
          >
            <option value="">{t('surface.noParent')}</option>
            {parentTasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </select>
        </div>
        {onAddSubtask && (
          <div className={`${styles.field} ${styles.addSubtaskField}`}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={onAddSubtask}
              data-component="add-subtask"
            >
              Add subtask
            </button>
          </div>
        )}
      </div>

      {(subtasks.length > 0 || (rootTaskId && taskHasSubtasks(rootTaskId))) && (
        <div className={styles.subtaskList}>
          <div className={styles.subtaskHeading}>
            <span className={styles.label}>{t('surface.subtasks')}</span>
            {rootTaskId && rootTaskTitle && taskHasSubtasks(rootTaskId) && (
              <TaskCollapseToggle
                taskTitle={rootTaskTitle}
                collapsed={taskIsCollapsed(rootTaskId)}
                hiddenCount={taskDescendantCount(rootTaskId)}
                onToggle={() => onToggleTaskSubtasks(rootTaskId)}
                className={styles.subtaskCollapseToggle}
              />
            )}
          </div>
          {subtasks.map(({ task, depth }) => (
            <div
              key={task.id}
              className={styles.subtaskItem}
              style={{ marginLeft: depth * 18 }}
              data-component="subtask-row"
              data-task-depth={depth}
            >
              <input
                type="checkbox"
                checked={Boolean(task.completed)}
                disabled={readOnly || readOnlyTaskIds?.has(task.id)}
                onChange={() => onToggleSubtask(task)}
                aria-label={
                  task.completed
                    ? `Mark "${task.title}" as incomplete`
                    : `Mark "${task.title}" as complete`
                }
              />
              <button
                type="button"
                className={styles.subtaskTitle}
                onClick={() => onOpenSubtask(task.id)}
              >
                {task.title}
              </button>
              {taskHasSubtasks(task.id) && (
                <TaskCollapseToggle
                  taskTitle={task.title}
                  collapsed={taskIsCollapsed(task.id)}
                  hiddenCount={taskDescendantCount(task.id)}
                  onToggle={() => onToggleTaskSubtasks(task.id)}
                  className={styles.subtaskCollapseToggle}
                />
              )}
            </div>
          ))}
        </div>
      )}

      <div className={styles.row}>
        {hasDueDate && (
          <>
            <div className={`${styles.field} ${styles.dueDateField}`}>
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
              <div className={`${styles.field} ${styles.dueTimeField}`}>
                <label className={styles.label} htmlFor="due-time">
                  Due time
                </label>
                <TimeField
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

      {recurrenceProps && (
        <div data-component="task-recurrence">
          <div className={styles.row}>
            <div className={styles.field}>
              <RecurrenceToggle
                recurring={recurrenceProps.recurring}
                onRecurringChange={recurrenceProps.onRecurringChange}
                disabled={Boolean(recurrenceProps.disabledReason)}
                disabledReason={recurrenceProps.disabledReason}
              />
            </div>
          </div>
          {/* The due date is the task's DTSTART, so it is what the monthly /
              yearly pattern pickers describe. */}
          <RecurrenceFields
            {...recurrenceProps}
            startDate={dueDate.split('T')[0]}
            firstDayOfWeek={firstDayOfWeek}
          />
        </div>
      )}
    </>
  )
}
