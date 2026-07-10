import type { JSX } from 'react'
import { useMemo, useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  format,
  parseISO,
  startOfDay,
} from 'date-fns'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useCalendarStore } from '@/store/calendarStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import type { CalendarEvent } from '@/types'
import styles from './TodoView.module.css'

type FilterType = 'all' | 'active' | 'completed'

interface TaskWithColor extends CalendarEvent {
  calendarColor: string
}

interface TaskGroup {
  key: string
  label: string
  isOverdue?: boolean
  tasks: TaskWithColor[]
}

const PRIORITY_LABELS: Record<number, string> = {
  1: 'High',
  2: 'Medium',
  3: 'Low',
}

function getPriorityClass(priority?: number): string {
  if (priority === 1) return styles.priorityHigh
  if (priority === 2) return styles.priorityMed
  if (priority === 3) return styles.priorityLow
  return ''
}

function getDueLabel(task: TaskWithColor): { text: string; className: string } {
  if (!task.dueDate) return { text: '—', className: '' }

  const today = startOfDay(new Date())
  const dueDate = startOfDay(parseISO(task.dueDate))
  const diffMs = dueDate.getTime() - today.getTime()
  const diffDays = Math.round(diffMs / 86400000)

  if (diffDays < 0) {
    return { text: format(parseISO(task.dueDate), 'MMM d'), className: styles.dueOverdue }
  }
  if (diffDays === 0) return { text: 'Today', className: styles.dueToday }
  if (diffDays === 1) return { text: 'Tomorrow', className: '' }
  if (diffDays <= 6) {
    return { text: format(parseISO(task.dueDate), 'EEE'), className: '' }
  }
  return { text: format(parseISO(task.dueDate), 'MMM d'), className: '' }
}

function getTaskGroup(task: TaskWithColor): string {
  if (!task.dueDate) return 'nodate'

  const today = startOfDay(new Date())
  const dueDate = startOfDay(parseISO(task.dueDate))
  const diffMs = dueDate.getTime() - today.getTime()
  const diffDays = Math.round(diffMs / 86400000)

  if (diffDays < 0) return 'overdue'
  if (diffDays === 0) return 'today'
  if (diffDays <= 6) return 'week'
  return 'later'
}

const GROUP_ORDER = ['overdue', 'today', 'week', 'later', 'nodate']

const GROUP_LABELS: Record<string, string> = {
  overdue: 'Overdue',
  today: 'Today',
  week: 'This week',
  later: 'Later',
  nodate: 'No due date',
}

type VirtualItem =
  | { type: 'header'; key: string; label: string; count: number; isOverdue?: boolean }
  | { type: 'task'; key: string; task: TaskWithColor; depth: number }

export function TodoView(): JSX.Element {
  const events = useCalendarStore((state) => state.events)
  const calendars = useCalendarStore((state) => state.calendars)
  const completeTask = useCalendarStore((state) => state.completeTask)
  const openModal = useCalendarStore((state) => state.openModal)
  const { updateEvent: updateCalDAVEvent } = useCalDAV()
  const isMobile = useIsMobile()

  const [filter, setFilter] = useState<FilterType>('active')
  const [projectFilter, setProjectFilter] = useState('')
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false)
  const [composing, setComposing] = useState(false)
  const [unstriking, setUnstriking] = useState<Set<string>>(new Set())
  const [recentlyCompleted, setRecentlyCompleted] = useState<Set<string>>(new Set())
  const [fadingOut, setFadingOut] = useState<Set<string>>(new Set())
  const composerRef = useRef<HTMLInputElement>(null)
  const segmentedRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number }>({ left: 0, width: 0 })
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const projectMenuRef = useRef<HTMLDivElement>(null)
  const [scrollReady, setScrollReady] = useState(false)

  useEffect(() => {
    if (composing && composerRef.current) {
      composerRef.current.focus()
    }
  }, [composing])

  // Detect when scroll container is ready (has a height)
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return

    // Check immediately
    if (el.clientHeight > 0) {
      setScrollReady(true)
      return
    }

    // Poll briefly for layout
    const timer = setTimeout(() => {
      if (el.clientHeight > 0) {
        setScrollReady(true)
      }
    }, 50)

    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!isProjectMenuOpen) return
    const closeMenu = (event: MouseEvent): void => {
      if (!projectMenuRef.current?.contains(event.target as Node)) setIsProjectMenuOpen(false)
    }
    document.addEventListener('mousedown', closeMenu)
    return () => document.removeEventListener('mousedown', closeMenu)
  }, [isProjectMenuOpen])

  // Sliding indicator for filter tabs
  useLayoutEffect(() => {
    const container = segmentedRef.current
    const activeTab = tabRefs.current.get(filter)
    if (container && activeTab) {
      const containerRect = container.getBoundingClientRect()
      const tabRect = activeTab.getBoundingClientRect()
      setIndicatorStyle({
        left: tabRect.left - containerRect.left,
        width: tabRect.width,
      })
    }
  }, [filter])

  const tasks: TaskWithColor[] = useMemo(() => {
    const calendarMap = new Map(calendars.map((c) => [c.id, c.color]))
    const visibleCalendarIds = new Set(calendars.filter((c) => c.isVisible).map((c) => c.id))
    return events
      .filter((e) => e.type === 'task' && visibleCalendarIds.has(e.calendarId))
      .map((task) => ({
        ...task,
        calendarColor: calendarMap.get(task.calendarId) || '#888',
      }))
  }, [events, calendars])

  const taskCalendars = useMemo(
    () => calendars.filter((calendar) =>
      calendar.isVisible &&
      (!calendar.supportedComponents || calendar.supportedComponents.includes('VTODO'))
    ),
    [calendars]
  )
  const filteredTasks = useMemo(
    () => projectFilter ? tasks.filter((task) => task.calendarId === projectFilter) : tasks,
    [projectFilter, tasks]
  )
  const activeCount = useMemo(() => filteredTasks.filter((task) => !task.completed).length, [filteredTasks])
  const completedCount = useMemo(() => filteredTasks.filter((task) => task.completed).length, [filteredTasks])
  const selectedProject = taskCalendars.find((calendar) => calendar.id === projectFilter)

  const groupedTasks = useMemo((): TaskGroup[] => {
    const active = filteredTasks.filter((t) => !t.completed || recentlyCompleted.has(t.id))
    const done = filteredTasks.filter((t) => t.completed && !recentlyCompleted.has(t.id))

    const result: TaskGroup[] = []

    if (filter !== 'completed') {
      // Sort active tasks: due date ascending (earliest first), no-date last
      const sorted = [...active].sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0
        if (!a.dueDate) return 1
        if (!b.dueDate) return -1
        return parseISO(a.dueDate).getTime() - parseISO(b.dueDate).getTime()
      })

      // Group a complete branch by its root task so children with a different
      // due date still remain under their parent.
      const grouped = new Map<string, TaskWithColor[]>()
      const taskIds = new Set(sorted.map((task) => task.id))
      const children = new Map<string, TaskWithColor[]>()
      for (const task of sorted) {
        if (!task.parentTaskId || !taskIds.has(task.parentTaskId)) continue
        const siblings = children.get(task.parentTaskId) ?? []
        siblings.push(task)
        children.set(task.parentTaskId, siblings)
      }
      const appendBranch = (task: TaskWithColor, branch: TaskWithColor[]): void => {
        branch.push(task)
        for (const child of children.get(task.id) ?? []) appendBranch(child, branch)
      }
      for (const task of sorted) {
        if (task.parentTaskId && taskIds.has(task.parentTaskId)) continue
        const group = getTaskGroup(task)
        if (!grouped.has(group)) grouped.set(group, [])
        appendBranch(task, grouped.get(group)!)
      }

      // Add groups in order
      for (const key of GROUP_ORDER) {
        const groupTasks = grouped.get(key)
        if (groupTasks && groupTasks.length > 0) {
          result.push({
            key,
            label: GROUP_LABELS[key],
            isOverdue: key === 'overdue',
            tasks: groupTasks,
          })
        }
      }
    }

    if (filter !== 'active' && done.length > 0) {
      // Sort completed: most recently done first
      const sortedDone = [...done].sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0
        if (!a.dueDate) return 1
        if (!b.dueDate) return -1
        return parseISO(b.dueDate).getTime() - parseISO(a.dueDate).getTime()
      })

      result.push({
        key: 'done',
        label: 'Completed',
        tasks: sortedDone,
      })
    }

    return result
  }, [filteredTasks, filter, recentlyCompleted])

  const handleToggleComplete = async (task: TaskWithColor): Promise<void> => {
    const newCompleted = !task.completed
    // If uncompleting, trigger unstrike animation
    if (task.completed && !newCompleted) {
      setUnstriking((prev) => new Set(prev).add(task.id))
      setTimeout(() => {
        setUnstriking((prev) => {
          const next = new Set(prev)
          next.delete(task.id)
          return next
        })
      }, 300)
    }
    // If completing in active view, keep visible briefly for strike animation
    if (!task.completed && newCompleted && filter === 'active') {
      setRecentlyCompleted((prev) => new Set(prev).add(task.id))
      // Start fade-out after strike animation completes
      setTimeout(() => {
        setFadingOut((prev) => new Set(prev).add(task.id))
      }, 320)
      // Remove from list after fade-out
      setTimeout(() => {
        setRecentlyCompleted((prev) => {
          const next = new Set(prev)
          next.delete(task.id)
          return next
        })
        setFadingOut((prev) => {
          const next = new Set(prev)
          next.delete(task.id)
          return next
        })
      }, 520)
    }
    const updatedTasks = completeTask(task.id, newCompleted)
    try {
      await Promise.all(updatedTasks.map((updatedTask) => updateCalDAVEvent(updatedTask.calendarId, updatedTask)))
    } catch {
      // error handled by useCalDAV
    }
  }

  const handleTaskClick = (task: TaskWithColor): void => {
    openModal(undefined, undefined, task.id, 'task')
  }

  const handleCreateTask = (): void => {
    setComposing(true)
    if (filter === 'completed') setFilter('active')
  }

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && composerRef.current?.value.trim()) {
      // Forward the composer's text into the modal so the user doesn't have
      // to retype the title they just typed.
      openModal(format(new Date(), 'yyyy-MM-dd'), undefined, undefined, 'task', composerRef.current.value.trim(), undefined, projectFilter || undefined)
      composerRef.current.value = ''
      setComposing(false)
    } else if (e.key === 'Escape') {
      setComposing(false)
    }
  }

  const flatItems: VirtualItem[] = useMemo(() => {
    const items: VirtualItem[] = []
    for (const group of groupedTasks) {
      items.push({
        type: 'header',
        key: `header-${group.key}`,
        label: group.label,
        count: group.tasks.length,
        isOverdue: group.isOverdue,
      })
      const taskIds = new Set(group.tasks.map((task) => task.id))
      const children = new Map<string, TaskWithColor[]>()
      for (const task of group.tasks) {
        if (!task.parentTaskId || !taskIds.has(task.parentTaskId)) continue
        const siblings = children.get(task.parentTaskId) ?? []
        siblings.push(task)
        children.set(task.parentTaskId, siblings)
      }
      const appendTask = (task: TaskWithColor, depth: number): void => {
        items.push({ type: 'task', key: `task-${task.id}`, task, depth })
        for (const child of children.get(task.id) ?? []) appendTask(child, depth + 1)
      }
      for (const task of group.tasks) {
        if (!task.parentTaskId || !taskIds.has(task.parentTaskId)) appendTask(task, 0)
      }
    }
    return items
  }, [groupedTasks])

  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: (index) => (flatItems[index].type === 'header' ? 40 : 56),
    overscan: 5,
  })

  const renderHeader = useCallback(
    (item: Extract<VirtualItem, { type: 'header' }>, transform?: string) => (
      <div
        key={item.key}
        data-index={0}
        style={{
          position: transform ? 'absolute' : undefined,
          top: 0,
          left: 0,
          width: '100%',
          transform,
        }}
      >
        <div className={`${styles.taskGroup} ${item.isOverdue ? styles.overdueGroup : ''}`}>
          <div className={styles.groupHeader}>
            <span className={styles.groupTitle}>{item.label}</span>
            <span className={styles.groupCount}>{item.count}</span>
            <span className={styles.groupRule} />
          </div>
        </div>
      </div>
    ),
    [],
  )

  const renderTask = useCallback(
    (item: Extract<VirtualItem, { type: 'task' }>, transform?: string) => {
      const task = item.task
      const dueInfo = getDueLabel(task)
      return (
        <div
          key={item.key}
          data-index={0}
          style={{
            position: transform ? 'absolute' : undefined,
            top: 0,
            left: 0,
            width: '100%',
            transform,
          }}
        >
          <div
            className={`${styles.taskRow} ${item.depth > 0 ? styles.taskSubtask : ''} ${task.completed ? styles.taskDone : ''} ${unstriking.has(task.id) ? styles.unstriking : ''} ${fadingOut.has(task.id) ? styles.fadingOut : ''}`}
            style={{ '--event-color': task.calendarColor, marginLeft: item.depth * 28 } as React.CSSProperties}
            data-component="task-row"
            data-task-depth={item.depth}
          >
            <button
              className={styles.taskCheck}
              onClick={(e) => {
                e.stopPropagation()
                handleToggleComplete(task)
              }}
              aria-label={task.completed ? 'Mark as incomplete' : 'Mark as complete'}
            >
              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7.5l2.5 2.5L11 4" />
              </svg>
            </button>
            <div className={styles.taskBody} onClick={() => handleTaskClick(task)}>
              <div className={styles.taskTitle}>{task.title}</div>
              {task.description && (
                <div className={styles.taskNote}>{task.description}</div>
              )}
            </div>
            <div className={styles.taskMeta}>
              {task.priority && task.priority <= 3 && (
                <span className={`${styles.priority} ${getPriorityClass(task.priority)}`}>
                  {PRIORITY_LABELS[task.priority]}
                </span>
              )}
              <span className={`${styles.dueLabel} ${dueInfo.className}`}>
                {dueInfo.text}
              </span>
            </div>
          </div>
        </div>
      )
    },
    [unstriking, fadingOut, handleToggleComplete, handleTaskClick],
  )

  return (
    <div className={styles.container}>
      <div className={styles.tpInner}>
        {/* Top Bar */}
        <div className={styles.tpBar}>
          <div className={styles.tpMeta}>
            {taskCalendars.length > 1 && (
              <div className={styles.projectMenu} ref={projectMenuRef}>
                <button type="button" className={styles.projectFilter} onClick={() => setIsProjectMenuOpen(!isProjectMenuOpen)} aria-expanded={isProjectMenuOpen} aria-haspopup="menu" aria-label="Filter tasks by project" data-component="task-project-filter">
                  {selectedProject && <span className={styles.projectColor} style={{ backgroundColor: selectedProject.color }} />}
                  {selectedProject?.name ?? 'All projects'}
                  <svg aria-hidden="true" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                {isProjectMenuOpen && <div className={styles.projectMenuList} role="menu" data-component="task-project-menu">
                  <button type="button" role="menuitem" className={projectFilter ? styles.projectMenuItem : `${styles.projectMenuItem} ${styles.projectMenuItemSelected}`} onClick={() => { setProjectFilter(''); setIsProjectMenuOpen(false) }}>All projects</button>
                  {taskCalendars.map((calendar) => <button key={calendar.id} type="button" role="menuitem" className={projectFilter === calendar.id ? `${styles.projectMenuItem} ${styles.projectMenuItemSelected}` : styles.projectMenuItem} onClick={() => { setProjectFilter(calendar.id); setIsProjectMenuOpen(false) }}><span className={styles.projectColor} style={{ backgroundColor: calendar.color }} />{calendar.name}</button>)}
                </div>}
              </div>
            )}
            <div className={styles.tpCount}>
              <b>{activeCount}</b> active <span className={styles.dim}>·</span> {completedCount} completed
            </div>
          </div>
          <div className={styles.tpControls}>
            <div className={styles.segmentedControl} ref={segmentedRef} data-component="todo-segmented">
              <div className={styles.tabIndicator} style={{ left: indicatorStyle.left, width: indicatorStyle.width }} data-component="view-switcher-indicator" />
              <button
                ref={(el) => { if (el) tabRefs.current.set('all', el) }}
                className={`${styles.tab} ${filter === 'all' ? styles.tabActive : ''}`}
                onClick={() => setFilter('all')}
              >
                All
              </button>
              <button
                ref={(el) => { if (el) tabRefs.current.set('active', el) }}
                className={`${styles.tab} ${filter === 'active' ? styles.tabActive : ''}`}
                onClick={() => setFilter('active')}
              >
                Active
              </button>
              <button
                ref={(el) => { if (el) tabRefs.current.set('completed', el) }}
                className={`${styles.tab} ${filter === 'completed' ? styles.tabActive : ''}`}
                onClick={() => setFilter('completed')}
              >
                Completed
              </button>
            </div>
            <button className={styles.addTask} onClick={handleCreateTask} data-component="add-task-button">
              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M7 2v10M2 7h10" />
              </svg>
              {isMobile ? 'Add' : 'Add task'}
            </button>
          </div>
        </div>

        {/* Task List */}
        <div className={styles.taskList} ref={scrollContainerRef}>
          {/* Inline Composer */}
          {composing && (
            <div className={styles.inlineComposer}>
              <span className={styles.composerCheck} />
              <input
                ref={composerRef}
                type="text"
                className={styles.composerInput}
                placeholder="What needs doing?"
                onKeyDown={handleComposerKeyDown}
                onBlur={() => setComposing(false)}
              />
            </div>
          )}

          {/* Empty State */}
          {groupedTasks.length === 0 && (
            <div className={styles.emptyState}>
              <span className={styles.emptyTitle}>All clear</span>
              <p className={styles.emptyMessage}>Nothing here right now.</p>
              <button
                className={styles.emptyCreateBtn}
                onClick={() => {
                  setComposing(true)
                  // Focus the composer input on next tick
                  setTimeout(() => composerRef.current?.focus(), 0)
                }}
                data-component="todo-empty-create"
              >
                + Create task
              </button>
            </div>
          )}

          {/* Virtualized Task List */}
          {flatItems.length > 0 && scrollReady && (
            <div
              style={{
                height: virtualizer.getTotalSize(),
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const item = flatItems[virtualRow.index]
                if (item.type === 'header') {
                  return renderHeader(item, `translateY(${virtualRow.start}px)`)
                }
                return renderTask(item, `translateY(${virtualRow.start}px)`)
              })}
            </div>
          )}

          {/* Fallback: render all items when scroll container not ready */}
          {flatItems.length > 0 && !scrollReady && (
            <>
              {flatItems.map((item) => {
                if (item.type === 'header') {
                  return renderHeader(item)
                }
                return renderTask(item)
              })}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
