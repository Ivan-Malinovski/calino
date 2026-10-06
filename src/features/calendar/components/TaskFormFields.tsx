import type { JSX } from 'react'
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { format, parseISO, subDays } from 'date-fns'
import { WEEK_TASK_MIN_DAYS, taskSpanDays, weekRangeKeys } from '@/lib/weekTasks'
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
  /** First day of a multi-day task, or '' for none. */
  startDate: string
  onStartDateChange: (date: string) => void
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

const PRIORITY_OPTIONS: { value: TaskPriority | undefined; labelKey: string }[] = [
  { value: undefined, labelKey: 'ui.task.priority.none' },
  { value: 1, labelKey: 'ui.task.priority.high' },
  { value: 2, labelKey: 'ui.task.priority.medium' },
  { value: 3, labelKey: 'ui.task.priority.low' },
]

type DueMode = 'datetime' | 'dateOnly' | 'none'

const DUE_MODE_OPTIONS: { value: DueMode; labelKey: string; testId: string }[] = [
  { value: 'datetime', labelKey: 'ui.task.due.datetime', testId: 'due-mode-datetime' },
  { value: 'dateOnly', labelKey: 'ui.task.due.dateOnly', testId: 'due-mode-date-only' },
  { value: 'none', labelKey: 'ui.task.due.none', testId: 'due-mode-none' },
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
  startDate,
  onStartDateChange,
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

  const dueDay = dueDate.split('T')[0]
  // A repeating task's DTSTART is its recurrence anchor, not a range start.
  const canHaveStart = !recurrenceProps?.recurring
  const hasStart = canHaveStart && startDate.length > 0
  const startInvalid = hasStart && hasDueDate && startDate >= dueDay
  const startSpan = hasStart && hasDueDate && !startInvalid ? taskSpanDays(startDate, dueDay) : 0

  const handleAddStartDate = (): void => {
    // Default to the day before the due date so the new field is a valid range.
    const due = hasDueDate ? dueDay : format(new Date(), 'yyyy-MM-dd')
    if (!hasDueDate) {
      onDueDateChange(due)
      onDueAllDayChange(true)
    }
    onStartDateChange(format(subDays(parseISO(due), 1), 'yyyy-MM-dd'))
  }

  const handleSometimeThisWeek = (): void => {
    const base = hasDueDate ? dueDay : format(new Date(), 'yyyy-MM-dd')
    const { startKey, dueKey } = weekRangeKeys(base, firstDayOfWeek)
    onStartDateChange(startKey)
    onDueDateChange(dueKey)
    onDueAllDayChange(true)
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
              {t(option.labelKey)}
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
            {t('ui.task.parentTask')}
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

        <div className={`${styles.field} ${styles.priorityField}`}>
          <label className={styles.label} htmlFor="priority-select">
            {t('ui.task.priorityLabel')}
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
              <option key={option.labelKey} value={option.value ?? ''}>
                {t(option.labelKey)}
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
              {t('ui.task.addSubtask')}
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
                aria-label={t(
                  task.completed
                    ? 'modals.miniTasks.markIncomplete'
                    : 'modals.miniTasks.markComplete',
                  { title: task.title }
                )}
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

      <div className={`${styles.row} ${styles.taskDateRow}`} data-component="task-dates">
        {hasStart && (
          <div className={`${styles.field} ${styles.taskDateField}`}>
            <label className={styles.label} htmlFor="task-start-date">
              {t('modals.eventModal.taskStartDate')}
            </label>
            <input
              type="date"
              id="task-start-date"
              value={startDate}
              max={hasDueDate ? dueDay : undefined}
              onChange={(e) => onStartDateChange(e.target.value)}
              className={styles.input}
            />
          </div>
        )}
        {hasDueDate && (
          <>
            <div className={`${styles.field} ${styles.taskDateField}`}>
              <label className={styles.label} htmlFor="due-date">
                {t('ui.task.dueDate')}
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
                  {t('ui.task.dueTime')}
                </label>
                <TimeField
                  value={dueTime}
                  timeFormat={timeFormat}
                  onChange={onDueTimeChange}
                  className={styles.input}
                  id="due-time"
                  dataComponent="task-due-time"
                  ariaLabel={t('ui.task.dueTime')}
                />
              </div>
            )}
          </>
        )}

        {canHaveStart && (
          <div className={`${styles.field} ${styles.taskDateButtons}`}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={handleSometimeThisWeek}
              data-component="task-sometime-this-week"
            >
              {t('modals.eventModal.sometimeThisWeek')}
            </button>
            {hasStart ? (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => onStartDateChange('')}
                data-component="task-clear-start"
              >
                {t('modals.eventModal.clearStartDate')}
              </button>
            ) : (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={handleAddStartDate}
                data-component="task-add-start"
              >
                {t('modals.eventModal.addStartDate')}
              </button>
            )}
          </div>
        )}
      </div>

      {hasStart && (
        <div className={styles.helperText} data-component="task-start-hint">
          {startInvalid
            ? t('modals.eventModal.startMustBeBeforeDue')
            : startSpan >= WEEK_TASK_MIN_DAYS
              ? t('modals.eventModal.startSpansWeek')
              : t('modals.eventModal.startSpansShort', { days: WEEK_TASK_MIN_DAYS })}
        </div>
      )}

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
