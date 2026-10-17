import { describe, it, expect, beforeEach } from 'vitest'
import { planReorder, stepIndex, type ReorderItem } from '@/lib/taskReorder'
import { SORT_ORDER_STEP } from '@/lib/taskSortOrder'
import { useCalendarStore } from '@/store/calendarStore'
import { makeRecurringTask, makeTask } from '@/lib/__tests__/fixtures'
import { dayReorderGroup, planDropReorder, planStep } from '../hooks/useTaskReorder'
import type { CalendarEvent } from '@/types'

const items = (...values: Array<[string, number?]>): ReorderItem[] =>
  values.map(([id, sortOrder]) => ({ id, sortOrder }))

describe('planReorder', () => {
  it('takes the midpoint between its new neighbours, writing only the moved task', () => {
    const group = items(['a', 1000], ['b', 2000], ['c', 3000])
    // c between a and b: index 1 in the list without c.
    expect(planReorder(group, 'c', 1)).toEqual([{ id: 'c', sortOrder: 1500 }])
  })

  it('goes after the last ordered task when the next one has no value', () => {
    const group = items(['a', 813528420], ['b'], ['c'])
    expect(planReorder(group, 'c', 1)).toEqual([{ id: 'c', sortOrder: 813528420 + SORT_ORDER_STEP }])
  })

  it('goes a step before the first task when dropped at the top', () => {
    const group = items(['a', 3000], ['b', 4000])
    expect(planReorder(group, 'b', 0)).toEqual([{ id: 'b', sortOrder: 2000 }])
  })

  it('never writes 0 or a negative value when dropped at the top', () => {
    // Halves the room above the first task instead of stepping past zero.
    expect(planReorder(items(['a', 1000], ['b', 2000]), 'b', 0)).toEqual([
      { id: 'b', sortOrder: 500 },
    ])
    expect(planReorder(items(['a', 500], ['b', 2000]), 'b', 0)).toEqual([
      { id: 'b', sortOrder: 250 },
    ])
  })

  it('renumbers from the step when nothing fits above a first value of 1', () => {
    expect(planReorder(items(['a', 1], ['b', 2], ['c', 3]), 'c', 0)).toEqual([
      { id: 'c', sortOrder: 1000 },
      { id: 'a', sortOrder: 2000 },
      { id: 'b', sortOrder: 3000 },
    ])
  })

  it('leaves values another client already wrote at 0 or below alone', () => {
    expect(planReorder(items(['a', 0], ['b', 2000]), 'b', 0)).toEqual([
      { id: 'b', sortOrder: -1000 },
    ])
  })

  it('seeds the unordered tasks above the drop point, in their current order', () => {
    const group = items(['a'], ['b'], ['c'], ['d'])
    // d between a and b: a and d get values, b and c stay unset below.
    expect(planReorder(group, 'd', 1)).toEqual([
      { id: 'a', sortOrder: 1000 },
      { id: 'd', sortOrder: 2000 },
    ])
  })

  it('seeds after the last ordered task when unordered ones sit in between', () => {
    const group = items(['a', 50], ['b'], ['c'])
    expect(planReorder(group, 'c', 2)).toEqual([
      { id: 'b', sortOrder: 50 + SORT_ORDER_STEP },
      { id: 'c', sortOrder: 50 + 2 * SORT_ORDER_STEP },
    ])
  })

  it('renumbers the ordered part of the group when there is no gap, keeping its first value', () => {
    const group = items(['a', 1], ['b', 2], ['c', 3], ['d'])
    expect(planReorder(group, 'c', 1)).toEqual([
      { id: 'c', sortOrder: 1 + SORT_ORDER_STEP },
      { id: 'b', sortOrder: 1 + 2 * SORT_ORDER_STEP },
    ])
  })

  it('writes nothing when the task lands where it already was', () => {
    const group = items(['a', 1000], ['b', 1500], ['c', 2000])
    expect(planReorder(group, 'b', 1)).toEqual([])
  })
})

describe('stepIndex', () => {
  const group = items(['a', 1], ['b', 2], ['c', 3])

  it('moves one place up or down', () => {
    // Nothing fits above a first value of 1, so the group is renumbered.
    expect(planReorder(group, 'b', stepIndex(group, 'b', -1)!)).toEqual([
      { id: 'b', sortOrder: SORT_ORDER_STEP },
      { id: 'a', sortOrder: 2 * SORT_ORDER_STEP },
      { id: 'c', sortOrder: 3 * SORT_ORDER_STEP },
    ])
    expect(planReorder(group, 'b', stepIndex(group, 'b', 1)!)).toEqual([
      { id: 'b', sortOrder: 3 + SORT_ORDER_STEP },
    ])
  })

  it('stops at the ends', () => {
    expect(stepIndex(group, 'a', -1)).toBeNull()
    expect(stepIndex(group, 'c', 1)).toBeNull()
    expect(stepIndex(group, 'missing', 1)).toBeNull()
  })
})

describe('planDropReorder', () => {
  const day = (id: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent =>
    makeTask({ id, uid: id, title: id, calendarId: 'cal-reorder', ...overrides })
  const a = day('a', { sortOrder: 1000 })
  const b = day('b', { sortOrder: 2000 })
  const c = day('c', { sortOrder: 3000 })
  const rows = [a, b, c]

  it('reorders on a row edge', () => {
    expect(planDropReorder(rows, c, 'b', 'before', rows)).toEqual({
      writes: [{ id: 'c', sortOrder: 1500 }],
      reparent: undefined,
    })
    expect(planDropReorder(rows, a, 'b', 'after', rows)).toEqual({
      writes: [{ id: 'a', sortOrder: 2500 }],
      reparent: undefined,
    })
  })

  it('refuses tasks on another day, timed tasks and done tasks', () => {
    const tomorrow = day('t', { start: '2026-03-04T00:00:00' })
    expect(planDropReorder([...rows, tomorrow], tomorrow, 'a', 'before', rows)).toBeNull()
    const timed = day('timed', { dueDate: '2026-03-03T09:00:00', isAllDay: false })
    expect(planDropReorder([...rows, timed], a, 'timed', 'before', rows)).toBeNull()
    const done = day('done', { completed: true })
    expect(planDropReorder([...rows, done], done, 'a', 'before', rows)).toBeNull()
  })

  it('makes a task the first subtask when dropped just below an expanded parent', () => {
    const parent = day('p')
    const child = day('kid', { parentTaskId: 'p', sortOrder: 10 })
    const list = [parent, child, a]
    expect(planDropReorder(list, a, 'p', 'after', list)).toEqual({
      writes: [{ id: 'a', sortOrder: 5 }],
      reparent: { id: 'a', parentTaskId: 'p' },
    })
  })

  it('refuses to nest a task inside its own subtree', () => {
    const parent = day('p')
    const child = day('kid', { parentTaskId: 'p' })
    const list = [parent, child]
    expect(planDropReorder(list, parent, 'kid', 'before', list)).toBeNull()
  })

  it('refuses to change the parent of a repeating task', () => {
    const parent = day('p')
    const child = day('kid', { parentTaskId: 'p' })
    const series = day('series', { rruleString: 'FREQ=DAILY' })
    const list = [parent, child, series]
    expect(planDropReorder(list, series, 'kid', 'before', list)).toBeNull()
  })
})

describe('Move up / Move down', () => {
  beforeEach(() => {
    const store = useCalendarStore.getState()
    store.events.forEach((e) => store.deleteEvent(e.id))
  })

  const calId = (): string =>
    useCalendarStore.getState().calendars.find((calendar) => calendar.isDefault)!.id

  it('steps through the open, untimed tasks of the same day and parent', () => {
    const store = useCalendarStore.getState()
    const cal = calId()
    store.addEvent(makeTask({ id: 'a', uid: 'a', calendarId: cal, sortOrder: 1000 }))
    store.addEvent(makeTask({ id: 'b', uid: 'b', calendarId: cal, sortOrder: 2000 }))
    store.addEvent(makeTask({ id: 'done', uid: 'done', calendarId: cal, completed: true }))
    store.addEvent(makeTask({ id: 'sub', uid: 'sub', calendarId: cal, parentTaskId: 'a' }))
    store.addEvent(
      makeTask({ id: 'other-day', uid: 'other-day', calendarId: cal, start: '2026-03-04T00:00:00' })
    )
    const b = useCalendarStore.getState().events.find((event) => event.id === 'b')!

    const group = dayReorderGroup(useCalendarStore.getState().events, b, new Set([cal]))
    expect(group.map((task) => task.id)).toEqual(['a', 'b'])
    expect(planStep(b, -1)).toEqual([{ id: 'b', sortOrder: 500 }])
    expect(planStep(b, 1)).toBeNull()
  })

  it('writes a repeating task’s order to its master', () => {
    const store = useCalendarStore.getState()
    const cal = calId()
    store.addEvent(
      makeRecurringTask('FREQ=DAILY', { id: 'gym', uid: 'gym', calendarId: cal, sortOrder: 5000 })
    )
    store.addEvent(makeTask({ id: 'a', uid: 'a', calendarId: cal, sortOrder: 1000 }))
    const [occurrence] = dayReorderGroup(
      useCalendarStore.getState().events,
      makeTask({ id: 'a', uid: 'a', calendarId: cal, sortOrder: 1000 }),
      new Set([cal])
    ).filter((task) => task.occurrenceMasterId === 'gym')

    expect(occurrence).toBeDefined()
    expect(planStep(occurrence, -1)).toEqual([{ id: 'gym', sortOrder: 500 }])
  })
})
