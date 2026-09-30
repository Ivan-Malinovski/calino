import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from '@/types'
import { isWeekScopedTask, weekScopedTasksInRange } from '../weekTasks'

const task = (id: string, start: string, due: string, extra: Partial<CalendarEvent> = {}) =>
  ({
    id,
    calendarId: 'cal',
    title: id,
    type: 'task',
    start: `${start}T00:00:00`,
    end: `${due}T00:00:00`,
    dueDate: `${due}T00:00:00`,
    isAllDay: true,
    ...extra,
  }) as CalendarEvent

describe('isWeekScopedTask', () => {
  it('needs a range of three or more calendar days', () => {
    expect(isWeekScopedTask(task('a', '2026-09-28', '2026-10-04'))).toBe(true)
    expect(isWeekScopedTask(task('b', '2026-09-28', '2026-09-30'))).toBe(true)
    expect(isWeekScopedTask(task('c', '2026-09-28', '2026-09-29'))).toBe(false)
    expect(isWeekScopedTask(task('d', '2026-09-28', '2026-09-28'))).toBe(false)
  })

  it('ignores undated, non-task and recurring items', () => {
    expect(isWeekScopedTask(task('a', '2026-09-28', '2026-10-04', { dueDate: undefined }))).toBe(
      false
    )
    expect(isWeekScopedTask(task('b', '2026-09-28', '2026-10-04', { type: 'event' }))).toBe(false)
    expect(
      isWeekScopedTask(task('c', '2026-09-28', '2026-10-04', { rruleString: 'FREQ=WEEKLY' }))
    ).toBe(false)
  })
})

describe('weekScopedTasksInRange', () => {
  const visible = new Set(['cal'])

  it('keeps tasks overlapping the range, sorted by start then due', () => {
    const list = [
      task('late', '2026-09-30', '2026-10-04'),
      task('early-long', '2026-09-28', '2026-10-04'),
      task('early-short', '2026-09-28', '2026-09-30'),
      task('outside', '2026-10-05', '2026-10-11'),
      task('single', '2026-09-30', '2026-09-30'),
    ]
    const result = weekScopedTasksInRange(list, '2026-09-28', '2026-10-04', visible)
    expect(result.map((t) => t.id)).toEqual(['early-short', 'early-long', 'late'])
  })

  it('includes a task that started in an earlier week', () => {
    const list = [task('spill', '2026-09-24', '2026-09-29')]
    expect(weekScopedTasksInRange(list, '2026-09-28', '2026-10-04', visible)).toHaveLength(1)
  })

  it('skips hidden calendars', () => {
    const list = [task('a', '2026-09-28', '2026-10-04', { calendarId: 'other' })]
    expect(weekScopedTasksInRange(list, '2026-09-28', '2026-10-04', visible)).toEqual([])
  })
})
