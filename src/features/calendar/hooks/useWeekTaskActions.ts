import type { MouseEvent } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCalendarStore } from '@/store/calendarStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { completeTaskAndSync } from '@/lib/taskCompletion'
import { safeCalDAVUpdate } from '@/lib/caldavHelpers'
import { createUuid } from '@/lib/uuid'
import { showToast } from '@/lib/toast'
import { useContextMenuStore } from '@/store/contextMenuStore'
import type { CalendarEvent } from '@/types'

interface UseWeekTaskActionsOptions {
  /** First and last day (`yyyy-MM-dd`) of the week the tasks belong to. */
  weekStartKey: string
  weekEndKey: string
}

/**
 * What the "Sometime this week" bar (week view) and popover (month view) do
 * to a week's tasks: tick one off, add one, open the task form, and the
 * right-click menu.
 */
export function useWeekTaskActions({ weekStartKey, weekEndKey }: UseWeekTaskActionsOptions): {
  toggle: (task: CalendarEvent) => Promise<void>
  quickAdd: (title: string) => boolean
  openForm: (title?: string) => void
  openTask: (taskId: string) => void
  taskMenu: { task: CalendarEvent; x: number; y: number } | null
  handleContextMenu: (e: MouseEvent, task: CalendarEvent) => void
  closeTaskMenu: () => void
} {
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

  const openTask = (taskId: string): void => openModal(undefined, undefined, taskId, 'task')

  /** Adds a week task titled `title`; false when nothing was added. */
  const quickAdd = (rawTitle: string): boolean => {
    const title = rawTitle.trim()
    if (!title) return false
    if (!targetCalendar) {
      showToast(t('views.week.noTaskCalendar'))
      return false
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
    void safeCalDAVUpdate(createCalDAVEvent, newTask.calendarId, newTask, {})
    return true
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

  return { toggle, quickAdd, openForm, openTask, taskMenu, handleContextMenu, closeTaskMenu }
}
