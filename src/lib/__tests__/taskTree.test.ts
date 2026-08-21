import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from '@/types'
import {
  filterTasksByCollapsedAncestors,
  getTaskParentsWithManyDescendants,
  getVisibleTaskDescendants,
} from '../taskTree'

const task = (id: string, parentTaskId?: string): CalendarEvent => ({
  id,
  calendarId: 'default',
  title: id,
  type: 'task',
  parentTaskId,
  start: '2026-08-21T00:00:00.000Z',
  end: '2026-08-21T00:00:00.000Z',
  isAllDay: true,
})

describe('task tree disclosure helpers', () => {
  it('auto-collapses parents with four or more descendants', () => {
    const events = [
      task('parent'),
      task('child-1', 'parent'),
      task('child-2', 'parent'),
      task('grandchild-1', 'child-1'),
      task('grandchild-2', 'child-1'),
    ]

    expect(getTaskParentsWithManyDescendants(events)).toEqual(new Set(['parent']))
  })

  it('hides a collapsed branch on calendar surfaces and preserves it elsewhere', () => {
    const events = [task('parent'), task('child', 'parent'), task('grandchild', 'child')]
    const visibleIds = filterTasksByCollapsedAncestors(events, events, new Set(['parent'])).map(
      ({ id }) => id
    )

    expect(visibleIds).toEqual(['parent'])
    expect(getVisibleTaskDescendants(events, 'parent', new Set(['parent']))).toEqual([])
  })

  it('guards descendant traversal against cyclic parent links', () => {
    const events = [task('parent', 'child'), task('child', 'parent')]

    expect(getVisibleTaskDescendants(events, 'parent', new Set())).toEqual([
      { task: events[1], depth: 0 },
    ])
  })
})
