import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import {
  format,
  parseISO,
  isToday,
  isBefore,
  startOfDay,
  addDays,
  isWithinInterval,
} from 'date-fns'
import { useCalendarStore } from '@/store/calendarStore'
import type { CalendarEvent, TaskPriority } from '@/types'
import styles from './TodoView.module.css'

type FilterType = 'all' | 'active' | 'completed'

interface TaskWithCalendar extends CalendarEvent {
  calendarColor: string
}

interface TaskSection {
  title: string
  tasks: TaskWithCalendar[]
}

const PRIORITY_LABELS: Partial<Record<TaskPriority, string>> = {
  0: 'High',
  1: 'High',
  2: 'Medium',
  3: 'Low',
}

export function TodoView(): JSX.Element {
  const events = useCalendarStore((state) => state.events)
  const calendars = useCalendarStore((state) => state.calendars)
  const updateEvent = useCalendarStore((state) => state.updateEvent)
  const openModal = useCalendarStore((state) => state.openModal)

  const [filter, setFilter] = useState<FilterType>('active')

  const tasks: TaskWithCalendar[] = useMemo(() => {
    const calendarMap = new Map(calendars.map((c) => [c.id, c.color]))
    return events
      .filter((e) => e.type === 'task')
      .map((task) => ({
        ...task,
        calendarColor: calendarMap.get(task.calendarId) || '#888',
      }))
  }, [events, calendars])

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (filter === 'active') return !task.completed
      if (filter === 'completed') return task.completed
      return true
    })
  }, [tasks, filter])

  const sections = useMemo((): TaskSection[] => {
    const today = startOfDay(new Date())
    const weekFromNow = addDays(today, 7)

    const overdue: TaskWithCalendar[] = []
    const todayTasks: TaskWithCalendar[] = []
    const upcoming: TaskWithCalendar[] = []
    const noDate: TaskWithCalendar[] = []

    const sortedTasks = [...filteredTasks].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1
      if (!a.dueDate && !b.dueDate) return 0
      if (!a.dueDate) return 1
      if (!b.dueDate) return -1
      return parseISO(a.dueDate).getTime() - parseISO(b.dueDate).getTime()
    })

    for (const task of sortedTasks) {
      if (!task.dueDate) {
        noDate.push(task)
      } else {
        const dueDate = startOfDay(parseISO(task.dueDate))
        if (isBefore(dueDate, today)) {
          overdue.push(task)
        } else if (isToday(dueDate)) {
          todayTasks.push(task)
        } else if (isWithinInterval(dueDate, { start: today, end: weekFromNow })) {
          upcoming.push(task)
        } else {
          upcoming.push(task)
        }
      }
    }

    const result: TaskSection[] = []
    if (overdue.length > 0) result.push({ title: 'Overdue', tasks: overdue })
    if (todayTasks.length > 0) result.push({ title: 'Today', tasks: todayTasks })
    if (upcoming.length > 0) result.push({ title: 'Upcoming', tasks: upcoming })
    if (noDate.length > 0) result.push({ title: 'No due date', tasks: noDate })

    return result
  }, [filteredTasks])

  const handleToggleComplete = (taskId: string, currentCompleted: boolean): void => {
    updateEvent(taskId, { completed: !currentCompleted })
  }

  const handleTaskClick = (task: CalendarEvent): void => {
    openModal(undefined, undefined, task.id, 'task')
  }

  const activeCount = tasks.filter((t) => !t.completed).length
  const completedCount = tasks.filter((t) => t.completed).length

  const handleCreateTask = (): void => {
    openModal(undefined, undefined, undefined, 'task')
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.title}>
          <h2>Tasks</h2>
          <span className={styles.count}>
            {activeCount} active, {completedCount} completed
          </span>
        </div>
        <div className={styles.actions}>
          <div className={styles.tabs}>
            <button
              className={`${styles.tab} ${filter === 'all' ? styles.tabActive : ''}`}
              onClick={() => setFilter('all')}
            >
              All
            </button>
            <button
              className={`${styles.tab} ${filter === 'active' ? styles.tabActive : ''}`}
              onClick={() => setFilter('active')}
            >
              Active
            </button>
            <button
              className={`${styles.tab} ${filter === 'completed' ? styles.tabActive : ''}`}
              onClick={() => setFilter('completed')}
            >
              Completed
            </button>
          </div>
          <button className={styles.addButton} onClick={handleCreateTask}>
            + Add task
          </button>
        </div>
      </div>

      <div className={styles.list}>
        {sections.length === 0 ? (
          <div className={styles.empty}>
            {filter === 'all' ? 'No tasks yet' : `No ${filter} tasks`}
          </div>
        ) : (
          sections.map((section) => (
            <div key={section.title} className={styles.section}>
              <div className={styles.sectionTitle}>{section.title}</div>
              <div className={styles.sectionList}>
                {section.tasks.map((task) => (
                  <div
                    key={task.id}
                    className={`${styles.taskRow} ${task.completed ? styles.taskCompleted : ''}`}
                    onClick={() => handleTaskClick(task)}
                  >
                    <button
                      className={styles.checkbox}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleToggleComplete(task.id, !!task.completed)
                      }}
                    >
                      {task.completed && (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                    <div className={styles.taskContent}>
                      <div className={styles.taskMain}>
                        <span className={styles.taskTitle}>{task.title}</span>
                        {task.description && (
                          <span className={styles.taskDescription}>{task.description}</span>
                        )}
                      </div>
                    </div>
                    {task.priority && task.priority <= 3 && task.priority in PRIORITY_LABELS && (
                      <span className={styles.priority} data-priority={task.priority}>
                        {PRIORITY_LABELS[task.priority]}
                      </span>
                    )}
                    {task.dueDate && (
                      <span className={styles.taskDue}>
                        {format(parseISO(task.dueDate), 'MMM d')}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
