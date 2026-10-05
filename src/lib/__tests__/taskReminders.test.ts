import { describe, it, expect } from 'vitest'
import { format, parseISO } from 'date-fns'
import type { Calendar } from '@/types'
import { toEventInstant } from '@/lib/datetime'
import {
  TASK_ALL_DAY_REMINDER_HOUR,
  TASK_DUE_REMINDER_ID,
  buildTaskDueReminderEvents,
  countOverdueTasks,
  taskDueInstant,
} from '../taskReminders'
import { reminderBody } from '../notifications'
import { makeEvent, makeRecurringTask, makeTask } from './fixtures'

function makeCalendar(overrides: Partial<Calendar> = {}): Calendar {
  return {
    id: 'cal1',
    name: 'Tasks',
    color: '#3b82f6',
    isVisible: true,
    isDefault: false,
    showTasksInViews: true,
    ...overrides,
  }
}

const calendars = [makeCalendar()]
const from = new Date(2026, 2, 1, 0, 0)
const to = new Date(2026, 2, 31, 23, 59)

describe('taskDueInstant', () => {
  it('announces a date-only task at 9:00 local on its day', () => {
    const due = taskDueInstant({ dueDate: '2026-03-10' })
    expect(format(due!, 'yyyy-MM-dd HH:mm')).toBe(`2026-03-10 0${TASK_ALL_DAY_REMINDER_HOUR}:00`)
  })

  it('treats midnight and all-day values like the rest of the app does: as date-only', () => {
    for (const task of [
      { dueDate: '2026-03-10T00:00:00' },
      { dueDate: '2026-03-10T00:00' },
      { dueDate: '2026-03-10T00:00:00.000Z', isAllDay: true },
      { dueDate: '2026-03-10T14:30', isAllDay: true },
    ]) {
      expect(format(taskDueInstant(task)!, 'yyyy-MM-dd HH:mm')).toBe('2026-03-10 09:00')
    }
  })

  it('uses the exact time of a timed task', () => {
    expect(format(taskDueInstant({ dueDate: '2026-03-10T14:30' })!, 'yyyy-MM-dd HH:mm')).toBe(
      '2026-03-10 14:30'
    )
  })

  it('resolves a timed task through its zone', () => {
    const due = taskDueInstant({ dueDate: '2026-03-10T14:30:00', timezone: 'Europe/Copenhagen' })
    expect(due!.getTime()).toBe(toEventInstant('2026-03-10T14:30:00', 'Europe/Copenhagen').getTime())
  })

  it('has no instant without a due date, or with a garbage one', () => {
    expect(taskDueInstant({})).toBeNull()
    expect(taskDueInstant({ dueDate: 'not-a-date' })).toBeNull()
  })
})

describe('buildTaskDueReminderEvents', () => {
  it('turns an open task into a zero-lead reminder at its due instant, under its own id', () => {
    const task = makeTask({ id: 't1', dueDate: '2026-03-10T14:30', isAllDay: false })
    const [reminder] = buildTaskDueReminderEvents([task], calendars, from, to)
    expect(reminder.id).toBe('t1')
    expect(reminder.reminders).toEqual([
      { id: TASK_DUE_REMINDER_ID, minutesBefore: 0, method: 'popup' },
    ])
    expect(parseISO(reminder.start).getTime()).toBe(taskDueInstant(task)!.getTime())
    expect(reminder.title).toBe(task.title)
  })

  it('skips completed tasks, undated tasks and plain events', () => {
    const events = [
      makeTask({ id: 'done', completed: true }),
      makeTask({ id: 'undated', dueDate: undefined }),
      makeEvent({ id: 'evt', start: '2026-03-10T10:00:00' }),
    ]
    expect(buildTaskDueReminderEvents(events, calendars, from, to)).toEqual([])
  })

  it('skips tasks on hidden calendars and on muted webcal overlays', () => {
    const task = makeTask({ dueDate: '2026-03-10' })
    expect(
      buildTaskDueReminderEvents([task], [makeCalendar({ isVisible: false })], from, to)
    ).toEqual([])
    expect(
      buildTaskDueReminderEvents([task], [makeCalendar({ source: 'webcal' })], from, to)
    ).toEqual([])
    expect(
      buildTaskDueReminderEvents(
        [task],
        [makeCalendar({ source: 'webcal', notifyReminders: true })],
        from,
        to
      )
    ).toHaveLength(1)
  })

  it('skips tasks whose calendar is unknown', () => {
    expect(buildTaskDueReminderEvents([makeTask({ dueDate: '2026-03-10' })], [], from, to)).toEqual(
      []
    )
  })

  it('keeps only tasks that fall due inside the window', () => {
    const events = [
      makeTask({ id: 'before', dueDate: '2026-02-20' }),
      makeTask({ id: 'inside', dueDate: '2026-03-10' }),
      makeTask({ id: 'after', dueDate: '2026-04-20' }),
    ]
    expect(buildTaskDueReminderEvents(events, calendars, from, to).map((e) => e.id)).toEqual([
      'inside',
    ])
  })

  it('announces a recurring task once, at its next open occurrence, under the master id', () => {
    const master = makeRecurringTask('FREQ=WEEKLY;BYDAY=TU', {
      id: 'series',
      uid: 'series',
      start: '2026-03-03T00:00:00',
      end: '2026-03-03T00:00:00',
      dueDate: '2026-03-03T00:00:00',
    })
    const reminders = buildTaskDueReminderEvents([master], calendars, from, to)
    expect(reminders).toHaveLength(1)
    expect(reminders[0].id).toBe('series')
  })
})

describe('reminderBody for a task', () => {
  const reference = new Date(2026, 2, 9, 12, 0)

  it('phrases date-only tasks against the day, not a start time', () => {
    const body = (dueDate: string): string =>
      reminderBody(makeTask({ dueDate, isAllDay: true }), reference)
    expect(body('2026-03-09')).toBe('Due today')
    expect(body('2026-03-10')).toBe('Due tomorrow')
    expect(body('2026-03-15')).toContain('Due on')
    expect(body('2026-03-15')).toContain('Mar 15, 2026')
  })

  it('includes the time for a timed task', () => {
    const body = reminderBody(
      makeTask({ dueDate: '2026-03-09T14:30', isAllDay: false }),
      reference
    )
    expect(body).toMatch(/^Due at /)
    expect(body).toMatch(/14:30|2:30/)
  })
})

describe('countOverdueTasks', () => {
  const now = new Date(2026, 2, 10, 15, 0)

  it('counts open top-level tasks due before today', () => {
    const events = [
      makeTask({ id: 'yesterday', dueDate: '2026-03-09' }),
      makeTask({ id: 'last-week', dueDate: '2026-03-02T09:00', isAllDay: false }),
      makeTask({ id: 'today', dueDate: '2026-03-10' }),
      makeTask({ id: 'earlier-today', dueDate: '2026-03-10T08:00', isAllDay: false }),
      makeTask({ id: 'tomorrow', dueDate: '2026-03-11' }),
    ]
    expect(countOverdueTasks(events, calendars, now)).toBe(2)
  })

  it('ignores completed, undated, subtask, cancelled and non-task items', () => {
    const events = [
      makeTask({ id: 'done', dueDate: '2026-03-01', completed: true }),
      makeTask({ id: 'undated', dueDate: undefined }),
      makeTask({ id: 'child', dueDate: '2026-03-01', parentTaskId: 'parent' }),
      makeTask({ id: 'cancelled', dueDate: '2026-03-01', taskStatus: 'CANCELLED' }),
      makeEvent({ id: 'evt', start: '2026-03-01T10:00:00' }),
    ]
    expect(countOverdueTasks(events, calendars, now)).toBe(0)
  })

  it('ignores tasks on hidden or unknown calendars', () => {
    const events = [
      makeTask({ id: 'a', calendarId: 'hidden', dueDate: '2026-03-01' }),
      makeTask({ id: 'b', calendarId: 'nowhere', dueDate: '2026-03-01' }),
    ]
    expect(
      countOverdueTasks(events, [makeCalendar({ id: 'hidden', isVisible: false })], now)
    ).toBe(0)
  })

  it('counts a recurring task once, by its next open occurrence', () => {
    const master = makeRecurringTask('FREQ=DAILY', {
      id: 'daily',
      uid: 'daily',
      start: '2026-03-01T00:00:00',
      end: '2026-03-01T00:00:00',
      dueDate: '2026-03-01T00:00:00',
    })
    expect(countOverdueTasks([master], calendars, now)).toBe(1)
  })
})
