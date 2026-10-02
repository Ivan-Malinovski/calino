import { type JSX, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { useDndContext } from '@dnd-kit/core'
import { parseISO } from 'date-fns'
import { useCalendarStore } from '@/store/calendarStore'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { useModalDismiss } from '@/hooks/useModalDismiss'
import { DUR_FAST } from '@/lib/motion'
import { formatDisplayDate } from '@/lib/datetime'
import { taskDayRange } from '@/lib/weekTasks'
import type { CalendarEvent } from '@/types'
import { usePlacement } from '../hooks/usePlacement'
import { useWeekTaskActions } from '../hooks/useWeekTaskActions'
import { TaskContextMenu } from './TaskContextMenu'
import { WeekTaskQuickAdd } from './WeekTaskQuickAdd'
import { DraggablePill } from './WeekTasksBar'
import popupStyles from './DayEventsPopup.module.css'
import controls from './weekTaskControls.module.css'
import styles from './WeekTasksPopover.module.css'

interface WeekTasksPopoverProps {
  /** The week's "sometime this week" tasks, already filtered for the month view. */
  tasks: CalendarEvent[]
  /** First and last day (`yyyy-MM-dd`) of the week row the popover belongs to. */
  weekStartKey: string
  weekEndKey: string
  weekNumber: number
  position: { x: number; y: number }
  onClose: () => void
}

/**
 * The month view's "Sometime this week" list: opened from the badge in a week
 * row's gutter, with the same tick, open, right-click and quick-add the week
 * view's bar offers.
 */
export function WeekTasksPopover({
  tasks,
  weekStartKey,
  weekEndKey,
  weekNumber,
  position,
  onClose,
}: WeekTasksPopoverProps): JSX.Element {
  const { t } = useTranslation('calendar')
  const calendars = useCalendarStore((state) => state.calendars)
  const popupRef = useRef<HTMLDivElement>(null)
  const prefersReducedMotion = useReducedMotion()
  const placement = usePlacement(popupRef, position)
  const { toggle, quickAdd, openForm, openTask, taskMenu, handleContextMenu, closeTaskMenu } =
    useWeekTaskActions({ weekStartKey, weekEndKey })

  // Focus trap + Escape + focus restore, shared with every other dialog.
  useModalDismiss(popupRef, true, onClose)

  // A task lifted out of the list is on its way to a day or another week, so
  // the popover steps aside (but stays mounted: unmounting the dragged row
  // would cancel the drag) to uncover the grid underneath.
  const { active } = useDndContext()
  const dragging = active !== null && String(active.id).endsWith('::weektask')

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      // The right-click menu is portaled out of the popover; pressing one of
      // its items must not tear the popover (and the menu with it) down first.
      if (taskMenu) return
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose, taskMenu])

  const range = t('views.week.weekTaskRange', {
    start: formatDisplayDate(parseISO(weekStartKey), 'd MMM'),
    due: formatDisplayDate(parseISO(weekEndKey), 'd MMM'),
  })

  return createPortal(
    <AnimatePresence>
      <motion.div
        ref={popupRef}
        className={`${popupStyles.popup} ${styles.popover} ${dragging ? styles.dragAside : ''}`}
        style={dragging ? { ...placement, pointerEvents: 'none' } : placement}
        data-component="week-tasks-popover"
        /* Portaled into <body>, but React events still bubble along the tree
           the popover was declared in: the gutter cell, whose click jumps to
           week view. Stop at the dialog's edge. */
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('views.week.weekTasksAriaLabel', { number: weekNumber })}
        tabIndex={-1}
        initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.97, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -4 }}
        transition={{ duration: prefersReducedMotion ? 0 : DUR_FAST }}
      >
        <div className={styles.header}>
          <span className={styles.heading}>
            {t('views.year.weekNumber', { number: weekNumber })}
          </span>
          <span className={styles.dates}>{range}</span>
        </div>
        <ul className={styles.list} data-component="week-tasks-popover-list">
          {tasks.length === 0 && <li className={styles.empty}>{t('views.week.weekTasksEmpty')}</li>}
          {tasks.map((task) => {
            const calendar = calendars.find((c) => c.id === task.calendarId)
            const readOnly = calendar?.readOnly === true
            const taskRange = taskDayRange(task)
            // Only a task that covers less than the whole row needs its range
            // spelled out; the rest simply read "this week".
            const partial =
              taskRange !== null &&
              (taskRange.startKey > weekStartKey || taskRange.dueKey < weekEndKey)
            return (
              <DraggablePill
                key={task.id}
                task={task}
                disabled={readOnly}
                className={`${styles.row} ${task.completed ? controls.done : ''}`}
                style={
                  calendar?.color
                    ? ({ '--event-color': calendar.color } as React.CSSProperties)
                    : undefined
                }
                onContextMenu={(e) => handleContextMenu(e, task)}
                data-component="week-task-pill"
                data-testid={`week-task-${task.id}`}
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
                {partial && taskRange && (
                  <span className={styles.range}>
                    {t('views.week.weekTaskRange', {
                      start: formatDisplayDate(parseISO(taskRange.startKey), 'EEE'),
                      due: formatDisplayDate(parseISO(taskRange.dueKey), 'EEE'),
                    })}
                  </span>
                )}
              </DraggablePill>
            )
          })}
        </ul>
        <div className={styles.footer}>
          <WeekTaskQuickAdd onAdd={quickAdd} onOpenForm={openForm} />
        </div>
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
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}
