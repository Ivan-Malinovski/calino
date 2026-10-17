import { describe, it, expect } from 'vitest'
import ICAL from 'ical.js'
import {
  compareTaskSortOrder,
  nextSubtaskSortOrder,
  parseSortOrder,
  SORT_ORDER_STEP,
} from '../taskSortOrder'
import { getDirectSubtasks } from '../taskTree'
import { weekScopedTasksInRange } from '../weekTasks'
import { compareDayEvents } from '@/features/calendar/lib/multiDayFragments'
import {
  calendarEventToIcalVtodo,
  icalVtodoToCalendarEvent,
} from '@/features/caldav/adapter/icalTypeMapping'
import { parseICALTask } from '@/features/caldav/adapter/iCalendarAdapter'
import { patchICALData } from '@/features/caldav/adapter/icalPatch'
import { makeTask } from './fixtures'

function vtodo(...lines: string[]): ICAL.Component {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VTODO',
    'UID:t1',
    'SUMMARY:Pack bag',
    ...lines,
    'END:VTODO',
    'END:VCALENDAR',
  ].join('\r\n')
  return new ICAL.Component(ICAL.parse(ics)).getFirstSubcomponent('vtodo')!
}

function calendar(...components: string[][]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Other Client//EN',
    ...components.flat(),
    'END:VCALENDAR',
  ].join('\r\n')
}

const sortOrderLines = (ics: string): string[] =>
  ics.split(/\r\n/).filter((line) => line.startsWith('X-APPLE-SORT-ORDER'))

describe('parseSortOrder', () => {
  it('reads plain, signed and padded integers', () => {
    expect(parseSortOrder('42')).toBe(42)
    expect(parseSortOrder(' 813528420 ')).toBe(813528420)
    expect(parseSortOrder('-7')).toBe(-7)
    expect(parseSortOrder('+3')).toBe(3)
  })

  it('leaves non-integers unset', () => {
    for (const raw of ['', 'abc', '1.5', '12abc', '1e3', undefined, null]) {
      expect(parseSortOrder(raw)).toBeUndefined()
    }
  })

  it('leaves values a number cannot hold exactly unset', () => {
    expect(parseSortOrder('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER)
    expect(parseSortOrder('9007199254740993')).toBeUndefined()
  })
})

describe('VTODO X-APPLE-SORT-ORDER', () => {
  it('parses the value', () => {
    expect(icalVtodoToCalendarEvent(vtodo('X-APPLE-SORT-ORDER:813528420'), 'c1').sortOrder).toBe(
      813528420
    )
  })

  it('leaves it unset when missing or invalid', () => {
    expect(icalVtodoToCalendarEvent(vtodo(), 'c1').sortOrder).toBeUndefined()
    expect(
      icalVtodoToCalendarEvent(vtodo('X-APPLE-SORT-ORDER:soon'), 'c1').sortOrder
    ).toBeUndefined()
  })

  it('writes it on a freshly built VTODO', () => {
    const out = calendarEventToIcalVtodo(makeTask({ sortOrder: 2000 })).toString()
    expect(sortOrderLines(out)).toEqual(['X-APPLE-SORT-ORDER:2000'])
  })

  it('writes nothing for a task without one', () => {
    expect(sortOrderLines(calendarEventToIcalVtodo(makeTask()).toString())).toEqual([])
  })

  const plain = calendar([
    'BEGIN:VTODO',
    'UID:t1',
    'DTSTAMP:20260101T000000Z',
    'SUMMARY:Pack bag',
    'DUE;VALUE=DATE:20260303',
    'X-APPLE-SORT-ORDER:813528420',
    'END:VTODO',
  ])

  it('survives an edit', () => {
    const [task] = parseICALTask(plain, 'c1')
    const out = patchICALData(plain, [{ ...task, title: 'Pack the bag' }])!
    expect(sortOrderLines(out)).toEqual(['X-APPLE-SORT-ORDER:813528420'])
    expect(parseICALTask(out, 'c1')[0].sortOrder).toBe(813528420)
  })

  it('survives completing the task', () => {
    const [task] = parseICALTask(plain, 'c1')
    const out = patchICALData(plain, [
      { ...task, completed: true, taskStatus: 'COMPLETED', percentComplete: 100 },
    ])!
    expect(sortOrderLines(out)).toEqual(['X-APPLE-SORT-ORDER:813528420'])
  })

  it('leaves a value it could not read untouched', () => {
    const odd = plain.replace('X-APPLE-SORT-ORDER:813528420', 'X-APPLE-SORT-ORDER:first')
    const [task] = parseICALTask(odd, 'c1')
    expect(task.sortOrder).toBeUndefined()
    expect(sortOrderLines(patchICALData(odd, [{ ...task, title: 'x' }])!)).toEqual([
      'X-APPLE-SORT-ORDER:first',
    ])
  })
})

describe('repeating tasks', () => {
  const master = [
    'BEGIN:VTODO',
    'UID:gym',
    'DTSTAMP:20260101T000000Z',
    'SUMMARY:Exercise',
    'DTSTART;VALUE=DATE:20260303',
    'DUE;VALUE=DATE:20260303',
    'RRULE:FREQ=WEEKLY;BYDAY=TU',
    'X-APPLE-SORT-ORDER:5000',
    'END:VTODO',
  ]
  const override = (...extra: string[]): string[] => [
    'BEGIN:VTODO',
    'UID:gym',
    'DTSTAMP:20260101T000000Z',
    'SUMMARY:Exercise',
    'RECURRENCE-ID;VALUE=DATE:20260310',
    'DTSTART;VALUE=DATE:20260310',
    'DUE;VALUE=DATE:20260310',
    'STATUS:COMPLETED',
    ...extra,
    'END:VTODO',
  ]

  it("gives an override without its own value the master's", () => {
    const tasks = parseICALTask(calendar(master, override()), 'c1')
    expect(tasks.find((t) => t.recurrenceId)?.sortOrder).toBe(5000)
  })

  it('keeps an override’s own value', () => {
    const tasks = parseICALTask(calendar(master, override('X-APPLE-SORT-ORDER:10')), 'c1')
    expect(tasks.find((t) => t.recurrenceId)?.sortOrder).toBe(10)
  })

  it('completing an occurrence keeps the master’s value and does not copy it to the override', () => {
    const ics = calendar(master)
    const [series] = parseICALTask(ics, 'c1')
    const completed = {
      ...series,
      id: 'gym-2026-03-10T00:00:00',
      start: '2026-03-10T00:00:00',
      end: '2026-03-10T00:00:00',
      dueDate: '2026-03-10',
      rruleString: undefined,
      recurrence: undefined,
      recurrenceId: '2026-03-10T00:00:00',
      recurrenceMasterId: 'gym',
      completed: true,
      taskStatus: 'COMPLETED' as const,
    }
    const out = patchICALData(ics, [series, completed])!

    // Written once, on the master only.
    expect(sortOrderLines(out)).toEqual(['X-APPLE-SORT-ORDER:5000'])
    const reparsed = parseICALTask(out, 'c1')
    expect(reparsed.find((t) => !t.recurrenceId)?.sortOrder).toBe(5000)
    expect(reparsed.find((t) => t.recurrenceId)?.sortOrder).toBe(5000)
  })
})

describe('compareTaskSortOrder', () => {
  const ids = (tasks: { id: string }[]): string[] => tasks.map((t) => t.id)

  it('puts lower values first and unset values last, keeping their order', () => {
    const tasks = [
      makeTask({ id: 'none-a' }),
      makeTask({ id: 'high', sortOrder: 813528420 }),
      makeTask({ id: 'none-b' }),
      makeTask({ id: 'low', sortOrder: -5 }),
    ]
    expect(ids([...tasks].sort(compareTaskSortOrder))).toEqual(['low', 'high', 'none-a', 'none-b'])
  })

  it('changes nothing when no task has a value', () => {
    const tasks = [makeTask({ id: 'b' }), makeTask({ id: 'a' }), makeTask({ id: 'c' })]
    expect(ids([...tasks].sort(compareTaskSortOrder))).toEqual(['b', 'a', 'c'])
  })

  it('only breaks ties: an earlier time still wins in a day list', () => {
    const timed = makeTask({
      id: 'timed',
      start: '2026-03-03T08:00:00',
      isAllDay: false,
      sortOrder: 9000,
    })
    const untimed = makeTask({ id: 'untimed', start: '2026-03-03T00:00:00', sortOrder: 1 })
    const later = makeTask({
      id: 'later',
      start: '2026-03-03T09:00:00',
      isAllDay: false,
      sortOrder: 1,
    })
    expect(ids([later, timed, untimed].sort(compareDayEvents))).toEqual([
      'untimed',
      'timed',
      'later',
    ])
  })

  it('orders siblings under their parent', () => {
    const events = [
      makeTask({ id: 'parent' }),
      makeTask({ id: 'c', parentTaskId: 'parent' }),
      makeTask({ id: 'b', parentTaskId: 'parent', sortOrder: 2000 }),
      makeTask({ id: 'a', parentTaskId: 'parent', sortOrder: 1000 }),
    ]
    expect(ids(getDirectSubtasks(events, 'parent'))).toEqual(['a', 'b', 'c'])
  })

  it('never moves a week task across weeks, only within its range', () => {
    const week = (id: string, start: string, due: string, sortOrder?: number) =>
      makeTask({ id, title: id, start, dueDate: due, end: due, sortOrder })
    const tasks = [
      week('z-next', '2026-03-09', '2026-03-15', 1),
      week('y', '2026-03-02', '2026-03-08'),
      week('x', '2026-03-02', '2026-03-08', 50),
    ]
    expect(
      ids(weekScopedTasksInRange(tasks, '2026-03-02', '2026-03-15', new Set(['cal1'])))
    ).toEqual(['x', 'y', 'z-next'])
  })
})

describe('nextSubtaskSortOrder', () => {
  it('places a new subtask after the highest sibling', () => {
    expect(
      nextSubtaskSortOrder([makeTask({ sortOrder: 813528420 }), makeTask({ sortOrder: 3 })])
    ).toBe(813528420 + SORT_ORDER_STEP)
  })

  it('leaves it unset when no sibling is ordered', () => {
    expect(nextSubtaskSortOrder([])).toBeUndefined()
    expect(nextSubtaskSortOrder([makeTask()])).toBeUndefined()
  })
})
