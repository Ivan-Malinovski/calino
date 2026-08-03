import { describe, it, expect, beforeEach } from 'vitest'
import { format, parseISO } from 'date-fns'
import { useCalendarStore, getTasksForDay, getTasksDueOn } from '../calendarStore'
import { nextOpenOccurrence } from '@/lib/occurrenceExpansion'
import { makeTask, makeRecurringTask } from '@/lib/__tests__/fixtures'
import type { CalendarEvent } from '@/types'

/**
 * R2.7 — Recurring VTODOs per RFC 5545 §3.6.2.
 *
 * A recurring task is a master carrying an RRULE plus zero or more detached
 * override VTODOs, each with the same UID and a RECURRENCE-ID naming one
 * occurrence. Nothing here may depend on a non-standard property.
 */
describe('R2.7 recurring task occurrences', () => {
  beforeEach(() => {
    const store = useCalendarStore.getState()
    store.events.forEach((e) => store.deleteEvent(e.id))
    store.calendars.forEach((c) => {
      if (!c.isDefault) store.deleteCalendar(c.id)
    })
    useCalendarStore.setState({ selectedCategoryIds: [] })
  })

  const calId = (): string => useCalendarStore.getState().calendars.find((c) => c.isDefault)!.id
  const events = (): CalendarEvent[] => useCalendarStore.getState().events

  const addRecurring = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => {
    // 2026-03-03 is a Tuesday.
    const task = makeRecurringTask('FREQ=WEEKLY;BYDAY=TU', {
      id: 'gym',
      uid: 'gym',
      calendarId: calId(),
      title: 'Exercise',
      ...overrides,
    })
    useCalendarStore.getState().addEvent(task)
    return task
  }

  describe('per-day expansion', () => {
    it('shows the series on every occurrence day, not only its anchor', () => {
      addRecurring()

      for (const day of ['2026-03-03', '2026-03-10', '2026-03-17']) {
        const tasks = getTasksForDay(events(), day)
        expect(tasks.map((t) => t.title)).toEqual(['Exercise'])
      }
      // Wednesday is not in the recurrence set.
      expect(getTasksForDay(events(), '2026-03-04')).toEqual([])
    })

    it('gives each occurrence its own dueDate rather than the master anchor', () => {
      addRecurring()

      const [occurrence] = getTasksForDay(events(), '2026-03-17')
      expect(occurrence.dueDate?.split('T')[0]).toBe('2026-03-17')
      expect(occurrence.id).not.toBe('gym')
    })

    it('still lands on the grid when the master ends at 23:59:59 on its own day', () => {
      // What EventModal actually writes for an all-day task: end is the SAME
      // day at 23:59:59, not the next midnight. That rounds to a one-day
      // duration, so deriving the occurrence's dueDate from its end pushed
      // every occurrence onto the following day — where it then failed the
      // day-key check and disappeared from the month grid entirely.
      addRecurring({ start: '2026-03-03T00:00:00', end: '2026-03-03T23:59:59' })

      const tasks = getTasksForDay(events(), '2026-03-10')
      expect(tasks).toHaveLength(1)
      expect(tasks[0].dueDate?.split('T')[0]).toBe('2026-03-10')
    })

    it('preserves a timed task’s DTSTART→DUE offset on every occurrence', () => {
      // RFC 5545 §3.6.2: the offset is a duration that applies identically to
      // each occurrence.
      addRecurring({
        isAllDay: false,
        start: '2026-03-03T09:00:00.000Z',
        end: '2026-03-03T17:00:00.000Z',
        dueDate: '2026-03-03T17:00:00.000Z',
      })

      // A timed task buckets by its LOCAL day, which is not necessarily the
      // UTC one — so derive the key rather than hardcoding a timezone's answer.
      const dayKey = format(parseISO('2026-03-10T17:00:00.000Z'), 'yyyy-MM-dd')
      const [occurrence] = getTasksForDay(events(), dayKey)
      expect(occurrence.dueDate).toBe('2026-03-10T17:00:00.000Z')
    })

    it('keeps the recurring master out of the plain due-date index', () => {
      addRecurring()

      // Otherwise the whole series would also render once on its anchor day
      // via the non-recurring fast path, double-rendering that occurrence.
      expect(getTasksDueOn(events(), '2026-03-03')).toEqual([])
    })

    it('leaves non-recurring tasks on the plain index untouched', () => {
      useCalendarStore
        .getState()
        .addEvent(makeTask({ id: 'plain', uid: 'plain', calendarId: calId(), title: 'Buy milk' }))

      expect(getTasksDueOn(events(), '2026-03-03').map((t) => t.title)).toEqual(['Buy milk'])
      expect(getTasksForDay(events(), '2026-03-03').map((t) => t.title)).toEqual(['Buy milk'])
    })

    it('files an all-day task under its literal date regardless of local timezone', () => {
      // All-day due dates are stored as a floating midnight serialized with a
      // Z. Running that through a local-timezone format lands it on the
      // previous day anywhere west of UTC (RFC 5545 §3.3.4 — a DATE has no
      // timezone at all).
      useCalendarStore.getState().addEvent(
        makeTask({
          id: 'utcish',
          uid: 'utcish',
          calendarId: calId(),
          title: 'Renew passport',
          start: '2026-03-09T00:00:00.000Z',
        })
      )

      expect(getTasksDueOn(events(), '2026-03-09').map((t) => t.title)).toEqual(['Renew passport'])
    })

    it('keeps a daily all-day task on its own day across a DST boundary', () => {
      addRecurring({ rruleString: 'FREQ=DAILY' })

      // US spring-forward 2026 is 2026-03-08.
      for (const day of ['2026-03-07', '2026-03-08', '2026-03-09']) {
        const tasks = getTasksForDay(events(), day)
        expect(tasks).toHaveLength(1)
        expect(tasks[0].dueDate?.split('T')[0]).toBe(day)
      }
    })
  })

  describe('overrides', () => {
    const addOverride = (recurrenceId: string, extra: Partial<CalendarEvent> = {}): void => {
      useCalendarStore.getState().addEvent(
        makeTask({
          id: `gym-${recurrenceId}`,
          uid: 'gym',
          calendarId: calId(),
          title: 'Exercise',
          start: recurrenceId,
          recurrenceId,
          recurrenceMasterId: 'gym',
          ...extra,
        })
      )
    }

    it('suppresses the master slot on a day that has a detached override', () => {
      addRecurring()
      addOverride('2026-03-10T00:00:00', { completed: true, taskStatus: 'COMPLETED' })

      // Exactly one row: the override itself, arriving via the plain index.
      const tasks = getTasksForDay(events(), '2026-03-10')
      expect(tasks).toHaveLength(1)
      expect(tasks[0].completed).toBe(true)
      expect(tasks[0].recurrenceId).toBe('2026-03-10T00:00:00')
    })

    it('drops an occurrence whose override is CANCELLED, leaving no row at all', () => {
      addRecurring()
      addOverride('2026-03-10T00:00:00', { taskStatus: 'CANCELLED' })

      const range = useCalendarStore
        .getState()
        .getEventsForDateRange('2026-03-09', '2026-03-11')
        .filter((e) => e.type === 'task')
      expect(range).toEqual([])
    })

    it('honours EXDATE', () => {
      addRecurring({ excludedDates: ['2026-03-10T00:00:00'] })

      expect(getTasksForDay(events(), '2026-03-10')).toEqual([])
      expect(getTasksForDay(events(), '2026-03-17')).toHaveLength(1)
    })

    it('lets an override win over an EXDATE for the same date', () => {
      // RFC 5545 §3.8.5.1: a detached instance supersedes the recurrence set.
      addRecurring({ excludedDates: ['2026-03-10T00:00:00'] })
      addOverride('2026-03-10T00:00:00', { completed: true, taskStatus: 'COMPLETED' })

      const tasks = getTasksForDay(events(), '2026-03-10')
      expect(tasks).toHaveLength(1)
      expect(tasks[0].completed).toBe(true)
    })
  })

  describe('completeTaskOccurrence', () => {
    it('records completion as an override and never mutates the master', () => {
      const master = addRecurring()

      const plan = useCalendarStore
        .getState()
        .completeTaskOccurrence('gym', '2026-03-10T00:00:00', true)

      expect(plan).not.toBeNull()
      // The master is returned unchanged — its RRULE has to keep generating
      // the series, which is the entire point of the override model.
      expect(plan!.master.rruleString).toBe(master.rruleString)
      expect(plan!.master.completed).toBe(false)

      const override = plan!.override!
      expect(override.recurrenceId).toBe('2026-03-10T00:00:00')
      expect(override.uid).toBe('gym')
      expect(override.recurrenceMasterId).toBe('gym')
      expect(override.taskStatus).toBe('COMPLETED')
      expect(override.percentComplete).toBe(100)
      expect(override.completedAt).toBeTruthy()
      // An override describes one instance; carrying the series definition
      // would make it a second master (RFC 5545 §3.8.5.3).
      expect(override.rruleString).toBeUndefined()
      expect(override.excludedDates).toBeUndefined()
    })

    it('removes a pure completion marker when un-completing', () => {
      addRecurring()
      useCalendarStore.getState().addEvent(
        makeTask({
          id: 'gym-2026-03-10T00:00:00',
          uid: 'gym',
          calendarId: calId(),
          title: 'Exercise',
          start: '2026-03-10T00:00:00',
          recurrenceId: '2026-03-10T00:00:00',
          recurrenceMasterId: 'gym',
          completed: true,
          taskStatus: 'COMPLETED',
        })
      )

      const plan = useCalendarStore
        .getState()
        .completeTaskOccurrence('gym', '2026-03-10T00:00:00', false)

      // Absence of an override IS "this occurrence is what the master says".
      expect(plan!.override).toBeNull()
      expect(plan!.removedOverrideIds).toEqual(['gym-2026-03-10T00:00:00'])
    })

    it('keeps an edited override when un-completing, flipping only its status', () => {
      addRecurring()
      useCalendarStore.getState().addEvent(
        makeTask({
          id: 'gym-2026-03-10T00:00:00',
          uid: 'gym',
          calendarId: calId(),
          title: 'Exercise (long session)',
          start: '2026-03-10T00:00:00',
          recurrenceId: '2026-03-10T00:00:00',
          recurrenceMasterId: 'gym',
          completed: true,
          taskStatus: 'COMPLETED',
        })
      )

      const plan = useCalendarStore
        .getState()
        .completeTaskOccurrence('gym', '2026-03-10T00:00:00', false)

      expect(plan!.removedOverrideIds).toEqual([])
      expect(plan!.override!.title).toBe('Exercise (long session)')
      expect(plan!.override!.taskStatus).toBe('NEEDS-ACTION')
      expect(plan!.override!.completedAt).toBeUndefined()
    })

    it('returns null for an unknown master rather than inventing one', () => {
      expect(
        useCalendarStore.getState().completeTaskOccurrence('nope', '2026-03-10T00:00:00', true)
      ).toBeNull()
    })
  })

  describe('nextOpenOccurrence', () => {
    const overrideMap = (...entries: CalendarEvent[]): Map<string, CalendarEvent> =>
      new Map(entries.map((e) => [e.recurrenceId as string, e]))

    it('starts at the master anchor when nothing is completed', () => {
      const master = makeRecurringTask('FREQ=WEEKLY;BYDAY=TU', { start: '2026-03-03T00:00:00' })
      expect(nextOpenOccurrence(master, new Map())!.occDateStr).toBe('2026-03-03')
    })

    it('advances past completed occurrences', () => {
      const master = makeRecurringTask('FREQ=WEEKLY;BYDAY=TU', { start: '2026-03-03T00:00:00' })
      const done = makeTask({
        recurrenceId: '2026-03-03T00:00:00',
        completed: true,
        taskStatus: 'COMPLETED',
      })

      expect(nextOpenOccurrence(master, overrideMap(done))!.occDateStr).toBe('2026-03-10')
    })

    it('skips EXDATEd occurrences', () => {
      const master = makeRecurringTask('FREQ=WEEKLY;BYDAY=TU', {
        start: '2026-03-03T00:00:00',
        excludedDates: ['2026-03-03T00:00:00', '2026-03-10T00:00:00'],
      })

      expect(nextOpenOccurrence(master, new Map())!.occDateStr).toBe('2026-03-17')
    })

    it('returns null once a finite series is exhausted', () => {
      const master = makeRecurringTask('FREQ=WEEKLY;BYDAY=TU;COUNT=2', {
        start: '2026-03-03T00:00:00',
      })
      const overrides = overrideMap(
        makeTask({ recurrenceId: '2026-03-03T00:00:00', completed: true }),
        makeTask({ recurrenceId: '2026-03-10T00:00:00', completed: true })
      )

      expect(nextOpenOccurrence(master, overrides)).toBeNull()
    })

    it('terminates instead of scanning an infinite rule forever', () => {
      // Every occurrence excluded: without the iteration cap this never
      // returns, since FREQ=DAILY has no end.
      const excludedDates: string[] = []
      const day = new Date(Date.UTC(2026, 2, 3))
      for (let i = 0; i < 2000; i++) {
        excludedDates.push(`${day.toISOString().split('T')[0]}T00:00:00`)
        day.setUTCDate(day.getUTCDate() + 1)
      }
      const master = makeRecurringTask('FREQ=DAILY', {
        start: '2026-03-03T00:00:00',
        excludedDates,
      })

      expect(nextOpenOccurrence(master, new Map())).toBeNull()
    })
  })
})
