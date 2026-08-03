import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { createPortal } from 'react-dom'
import { Link } from 'react-router'
import { format, parseISO, isToday, isBefore, startOfDay } from 'date-fns'
import { useCalendarStore } from '@/store/calendarStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { nextOpenOccurrence, materializeOccurrence } from '@/lib/occurrenceExpansion'
import type { CalendarEvent } from '@/types'
import styles from './Sidebar.module.css'

interface MiniTasksSectionProps {
  isExpanded: boolean
  onToggle: () => void
}

export function MiniTasksSection({ isExpanded, onToggle }: MiniTasksSectionProps): JSX.Element {
  const prefersReducedMotion = useReducedMotion()
  const events = useCalendarStore((state) => state.events)
  const calendars = useCalendarStore((state) => state.calendars)
  const completeTask = useCalendarStore((state) => state.completeTask)
  const completeTaskOccurrence = useCalendarStore((state) => state.completeTaskOccurrence)
  const openModal = useCalendarStore((state) => state.openModal)
  const { updateEvent: updateCalDAVEvent, saveRecurrenceOverride } = useCalDAV()
  const [hoveredTask, setHoveredTask] = useState<string | null>(null)
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null)
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null)
  // Tick once a minute so the "today" boundary advances even when the user
  // is idle (e.g. leaves the app open across midnight). Without this, the
  // "upcoming" filter would go stale until events change.
  const [, setNowTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  // `now` captured here. Re-evaluates on any events change AND every
  // minute (the `nowTick` interval above). Together they keep "today"
  // current without the user having to interact with the app.
  const upcomingTasks = useMemo(() => {
    const today = startOfDay(new Date())
    const visibleCalendarIds = new Set(
      calendars.filter((calendar) => calendar.isVisible).map((calendar) => calendar.id)
    )

    // R2.7 — This list reads raw store events, where a recurring task is a
    // single master sitting on its anchor date. Shown as-is it would be stuck
    // at the series' first date forever, and ticking it would run
    // `completeTask` on the master — completing the WHOLE series rather than
    // one occurrence. Substitute the next open occurrence, as the Tasks list
    // does; `occurrenceMasterId` then routes the toggle to the override path.
    const overridesByMaster = new Map<string, Map<string, CalendarEvent>>()
    for (const e of events) {
      if (e.type !== 'task' || !e.recurrenceId) continue
      const key = e.recurrenceMasterId || e.uid || ''
      const group = overridesByMaster.get(key) ?? new Map<string, CalendarEvent>()
      group.set(e.recurrenceId, e)
      overridesByMaster.set(key, group)
    }
    const resolved = events.flatMap((e): CalendarEvent[] => {
      if (e.type !== 'task') return [e]
      // A cancelled override exists only to suppress one occurrence.
      if (e.taskStatus === 'CANCELLED') return []
      if (e.recurrenceId || !(e.rruleString || e.recurrence)) return [e]
      const next = nextOpenOccurrence(
        e,
        overridesByMaster.get(e.id) ?? overridesByMaster.get(e.uid || '') ?? new Map()
      )
      return next ? [materializeOccurrence(e, next)] : []
    })

    const tasks = resolved
      .filter(
        (e) =>
          e.type === 'task' &&
          !e.parentTaskId &&
          !e.completed &&
          visibleCalendarIds.has(e.calendarId)
      )
      .filter((task) => {
        if (!task.dueDate) return true // Show tasks without due date
        const dueDate = startOfDay(parseISO(task.dueDate))
        return !isBefore(dueDate, today) // Show all future tasks
      })
      .sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0
        if (!a.dueDate) return 1 // No due date goes to end
        if (!b.dueDate) return -1
        return parseISO(a.dueDate).getTime() - parseISO(b.dueDate).getTime()
      })
      .slice(0, 8)

    const overdue = resolved
      .filter(
        (e) =>
          e.type === 'task' &&
          !e.parentTaskId &&
          !e.completed &&
          visibleCalendarIds.has(e.calendarId)
      )
      .filter((task) => {
        if (!task.dueDate) return false
        const dueDate = startOfDay(parseISO(task.dueDate))
        return isBefore(dueDate, today)
      })
      .sort((a, b) => {
        if (!a.dueDate || !b.dueDate) return 0
        return parseISO(a.dueDate).getTime() - parseISO(b.dueDate).getTime()
      })
      .slice(0, 5)

    return [...tasks, ...overdue].slice(0, 10)
  }, [calendars, events])

  const activeCount = events.filter(
    (e) =>
      e.type === 'task' &&
      !e.parentTaskId &&
      !e.completed &&
      calendars.some((calendar) => calendar.id === e.calendarId && calendar.isVisible)
  ).length

  // Count of incomplete descendants (children, grandchildren, ...) for each
  // task id. Subtasks are intentionally hidden from the sidebar (parents
  // represent their subtree), but a parent that has hidden children is hard
  // to discover — a small "· N" badge on the parent keeps the indirection
  // visible. Recurse via the same parentTaskId graph that TodoView uses.
  const subtaskCountsByParent = useMemo(() => {
    const childrenByParent = new Map<string, CalendarEvent[]>()
    for (const e of events) {
      if (e.type !== 'task' || !e.parentTaskId || e.completed) continue
      const bucket = childrenByParent.get(e.parentTaskId) ?? []
      bucket.push(e)
      childrenByParent.set(e.parentTaskId, bucket)
    }
    const counts = new Map<string, number>()
    const walk = (id: string): number => {
      const cached = counts.get(id)
      if (cached !== undefined) return cached
      // Each call recurses once; cache result to keep this O(n).
      let total = 0
      for (const child of childrenByParent.get(id) ?? []) {
        // Includes both direct children and their own descendants — the
        // number is the total open work under this parent.
        total += 1 + walk(child.id)
      }
      counts.set(id, total)
      return total
    }
    for (const e of events) {
      if (e.type !== 'task') continue
      walk(e.id)
    }
    return counts
  }, [events])

  const handleToggleComplete = async (task: CalendarEvent): Promise<void> => {
    setCompletingTaskId(task.id)

    setTimeout(async () => {
      const newCompleted = !task.completed

      // R2.7 — one occurrence of a series, not the series itself.
      if (task.occurrenceMasterId) {
        const plan = completeTaskOccurrence(task.occurrenceMasterId, task.start, newCompleted)
        setCompletingTaskId(null)
        if (plan) {
          try {
            await saveRecurrenceOverride(
              plan.master.calendarId,
              plan.master,
              plan.override,
              plan.removedOverrideIds
            )
          } catch {
            // surfaced by useCalDAV, which queues a retry
          }
        }
        return
      }

      const updatedTasks = completeTask(task.id, newCompleted)
      setCompletingTaskId(null)
      try {
        await Promise.all(
          updatedTasks.map((updatedTask) => updateCalDAVEvent(updatedTask.calendarId, updatedTask))
        )
      } catch {
        // error handled by useCalDAV
      }
    }, 300)
  }

  const handleTaskClick = (task: CalendarEvent): void => {
    openModal(undefined, undefined, task.id, 'task')
  }

  const hoveredTaskData = hoveredTask ? upcomingTasks.find((t) => t.id === hoveredTask) : null

  return (
    <div className={styles.tasksSection} data-component="tasks-section">
      <button
        className={styles.tasksHeader}
        onClick={onToggle}
        aria-expanded={isExpanded}
        data-component="tasks-header"
      >
        <div className={styles.tasksHeaderLeft}>
          <span className={styles.tasksTitle}>Tasks</span>
          {activeCount > 0 && <span className={styles.tasksCount}>{activeCount}</span>}
        </div>
        <svg
          aria-hidden="true"
          className={`${styles.tasksChevron} ${isExpanded ? styles.tasksChevronExpanded : ''}`}
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
        >
          <path
            d="M4 6L8 10L12 6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {isExpanded && (
        <div className={styles.tasksList}>
          {upcomingTasks.length === 0 ? (
            <div className={styles.tasksEmpty}>No upcoming tasks</div>
          ) : (
            <>
              <AnimatePresence>
                {upcomingTasks.map((task) => (
                  <motion.div
                    key={task.id}
                    initial={prefersReducedMotion ? false : { opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={
                      prefersReducedMotion
                        ? { opacity: 0 }
                        : {
                            opacity: 0,
                            y: -10,
                            transition: { duration: prefersReducedMotion ? 0 : 0.15 },
                          }
                    }
                    className={`${styles.taskRow} ${task.id === completingTaskId ? styles.taskCompleting : ''}`}
                    onMouseEnter={(e) => {
                      setHoveredTask(task.id)
                      setTooltipPosition({ x: e.clientX, y: e.clientY })
                    }}
                    onMouseLeave={() => {
                      setHoveredTask(null)
                      setTooltipPosition(null)
                    }}
                  >
                    <button
                      className={styles.taskCheckbox}
                      onClick={(e) => {
                        e.stopPropagation()
                        setHoveredTask(null)
                        setTooltipPosition(null)
                        handleToggleComplete(task)
                      }}
                      role="checkbox"
                      aria-checked={task.completed}
                      aria-label={
                        task.completed
                          ? `Mark "${task.title}" as incomplete`
                          : `Mark "${task.title}" as complete`
                      }
                    >
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <circle cx="12" cy="12" r="9" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={styles.taskContent}
                      onClick={() => handleTaskClick(task)}
                    >
                      <span className={styles.taskTitle}>{task.title}</span>
                      {(() => {
                        const subtaskCount = subtaskCountsByParent.get(task.id) ?? 0
                        if (subtaskCount === 0) return null
                        return (
                          <span
                            className={styles.taskSubtaskBadge}
                            data-component="task-subtask-count"
                            data-subtask-count={subtaskCount}
                            // Tooltip-style aria — surfaces the "this row has
                            // hidden subtasks" affordance to screen readers
                            // without taking focus from the row.
                            aria-label={`${subtaskCount} open subtask${subtaskCount === 1 ? '' : 's'}`}
                          >
                            ↳ {subtaskCount}
                          </span>
                        )
                      })()}
                      {task.dueDate ? (
                        <span
                          className={`${styles.taskDue} ${
                            isBefore(startOfDay(parseISO(task.dueDate)), startOfDay(new Date()))
                              ? styles.taskOverdue
                              : ''
                          }`}
                        >
                          {isToday(parseISO(task.dueDate))
                            ? 'Today'
                            : format(parseISO(task.dueDate), 'MMM d')}
                        </span>
                      ) : (
                        <span className={styles.taskDue}>No date</span>
                      )}
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
              {createPortal(
                hoveredTaskData && hoveredTaskData.description && tooltipPosition ? (
                  <div
                    className={styles.taskTooltip}
                    style={{
                      position: 'fixed',
                      left: tooltipPosition.x + 12,
                      top: tooltipPosition.y + 12,
                    }}
                  >
                    {hoveredTaskData.description}
                  </div>
                ) : null,
                document.body
              )}
              <Link to="/tasks" className={styles.tasksViewAll}>
                View all →
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  )
}
