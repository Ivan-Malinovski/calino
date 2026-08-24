import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from '@/types'
import {
  filterTasksByCollapsedAncestors,
  getTaskDescendants,
  getTaskTreeIndex,
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

  it('reuses one index for an immutable events-array reference', () => {
    const events = [task('parent'), task('child', 'parent')]
    const first = getTaskTreeIndex(events)
    const second = getTaskTreeIndex(events)

    expect(second).toBe(first)
    expect(first.getDescendants('parent')).toEqual([{ task: events[1], depth: 0 }])
    expect(first.getDescendants('parent')).not.toBe(first.getDescendants('parent'))
    expect(first.getParentsWithManyDescendants(1)).toBe(first.getParentsWithManyDescendants(1))
  })

  it('preserves depth-first stored order and suppresses duplicate IDs', () => {
    const parent = task('parent')
    const firstChild = task('first', 'parent')
    const grandchild = task('grandchild', 'first')
    const secondChild = task('second', 'parent')
    const duplicate = task('first', 'parent')
    const events = [parent, firstChild, grandchild, secondChild, duplicate]

    expect(
      getTaskDescendants(events, 'parent').map(({ task: item, depth }) => [item.id, depth])
    ).toEqual([
      ['first', 0],
      ['grandchild', 1],
      ['second', 0],
    ])
  })

  it('handles deeply nested task chains without recursive stack overflow', () => {
    const events = Array.from({ length: 3000 }, (_, index) =>
      task(`task-${index}`, index === 0 ? undefined : `task-${index - 1}`)
    )

    expect(getTaskTreeIndex(events).getDescendantCount('task-0')).toBe(2999)
  })
})
