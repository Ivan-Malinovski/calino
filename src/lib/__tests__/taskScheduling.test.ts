import { describe, expect, it } from 'vitest'
import { buildTaskMovePatch, taskMoveTargets } from '../taskScheduling'
import type { CalendarEvent } from '@/types'

const NOW = new Date('2026-08-12T10:00:00')

function task(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 't1',
    calendarId: 'cal',
    title: 'Task',
    start: '2026-08-12T09:00',
    end: '2026-08-12T09:30',
    isAllDay: false,
    type: 'task',
    dueDate: '2026-08-12',
    ...overrides,
  } as CalendarEvent
}

describe('taskMoveTargets', () => {
  it('offers tomorrow for a task due today', () => {
    expect(taskMoveTargets(task(), NOW)).toEqual(['tomorrow', 'nextWeek'])
  })

  it('offers today for an overdue task', () => {
    expect(taskMoveTargets(task({ dueDate: '2026-08-10' }), NOW)).toEqual(['today', 'nextWeek'])
  })

  it('offers today for a future task', () => {
    expect(taskMoveTargets(task({ dueDate: '2026-08-20' }), NOW)).toEqual(['today', 'nextWeek'])
  })

  it('offers today for a task with no due date', () => {
    expect(taskMoveTargets(task({ dueDate: undefined }), NOW)).toEqual(['today', 'nextWeek'])
  })

  it('offers nothing for a repeating task', () => {
    expect(taskMoveTargets(task({ rruleString: 'FREQ=WEEKLY' }), NOW)).toEqual([])
    expect(taskMoveTargets({ ...task(), occurrenceStart: '2026-08-12T09:00' }, NOW)).toEqual([])
  })
})

describe('buildTaskMovePatch', () => {
  it('moves an all-day due date to tomorrow', () => {
    expect(buildTaskMovePatch(task(), 'tomorrow', NOW).dueDate).toBe('2026-08-13')
  })

  it('pulls an overdue task to today', () => {
    expect(buildTaskMovePatch(task({ dueDate: '2026-08-01' }), 'today', NOW).dueDate).toBe(
      '2026-08-12'
    )
  })

  it('counts next week from the due date, landing on the same weekday', () => {
    // 2026-08-20 is a Thursday; +7 days is Thursday 2026-08-27.
    const patch = buildTaskMovePatch(task({ dueDate: '2026-08-20' }), 'nextWeek', NOW)
    expect(patch.dueDate).toBe('2026-08-27')
  })

  it('counts next week from today for an overdue task, never landing in the past', () => {
    // Counting from the stale due date would give 2026-07-08 — still overdue.
    const patch = buildTaskMovePatch(task({ dueDate: '2026-07-01' }), 'nextWeek', NOW)
    expect(patch.dueDate).toBe('2026-08-19')
  })

  it('counts next week from today when there is no due date', () => {
    const patch = buildTaskMovePatch(task({ dueDate: undefined }), 'nextWeek', NOW)
    expect(patch.dueDate).toBe('2026-08-19')
  })

  it('preserves the time on a timed due date', () => {
    const patch = buildTaskMovePatch(task({ dueDate: '2026-08-12T17:30' }), 'tomorrow', NOW)
    expect(patch.dueDate).toBe('2026-08-13T17:30')
  })

  it('moves start and end with the due date, keeping times and duration', () => {
    const patch = buildTaskMovePatch(task(), 'tomorrow', NOW)
    expect(patch.start).toBe('2026-08-13T09:00')
    expect(patch.end).toBe('2026-08-13T09:30')
  })

  it('keeps a multi-day span intact', () => {
    const patch = buildTaskMovePatch(
      task({ dueDate: '2026-08-12', start: '2026-08-12', end: '2026-08-14' }),
      'tomorrow',
      NOW
    )
    expect(patch.start).toBe('2026-08-13')
    expect(patch.end).toBe('2026-08-15')
  })
})
