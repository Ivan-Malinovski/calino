import { describe, it, expect, beforeEach } from 'vitest'
import { format, parseISO } from 'date-fns'
import { useCalendarStore, getTasksForDay } from '../calendarStore'
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

      // The master is indexed separately from the plain due-date bucket, so
      // its anchor day yields exactly ONE row. Indexing it in both would
      // double-render that occurrence.
      expect(getTasksForDay(events(), '2026-03-03')).toHaveLength(1)
    })

    it('leaves non-recurring tasks on the plain index untouched', () => {
      useCalendarStore
        .getState()
        .addEvent(makeTask({ id: 'plain', uid: 'plain', calendarId: calId(), title: 'Buy milk' }))

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

      expect(getTasksForDay(events(), '2026-03-09').map((t) => t.title)).toEqual(['Renew passport'])
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

      // ...including on the task grid, which reads a different index. The
      // cancelled override suppresses the master's slot for that date and must
      // not then be emitted in its place.
      expect(getTasksForDay(events(), '2026-03-10')).toEqual([])
      // The rest of the series is untouched.
      expect(getTasksForDay(events(), '2026-03-17')).toHaveLength(1)
    })

    it('suppresses the master slot when the override alone becomes timed', () => {
      // Editing one occurrence of an all-day series from "date only" to "date
      // and time" leaves the override timed while the master stays all-day.
      // Its RECURRENCE-ID still names an all-day slot, so it has to be indexed
      // in the MASTER's frame — keying it in the override's own frame filed it
      // under a timestamp while every lookup asked for the date, and the day
      // showed the occurrence twice: once timed, once from the master.
      addRecurring()
      addOverride('2026-03-10T00:00:00', {
        isAllDay: false,
        start: '2026-03-10T09:00:00.000Z',
        end: '2026-03-10T10:00:00.000Z',
        dueDate: '2026-03-10T10:00:00.000Z',
      })

      const dayKey = format(parseISO('2026-03-10T10:00:00.000Z'), 'yyyy-MM-dd')
      const tasks = getTasksForDay(events(), dayKey)
      expect(tasks).toHaveLength(1)
      expect(tasks[0].dueDate).toBe('2026-03-10T10:00:00.000Z')
    })

    it('suppresses it too when the RECURRENCE-ID is a bare date', () => {
      // What EventModal writes for this exact edit (#96): the occurrence key of
      // an all-day recurring task is a bare `YYYY-MM-DD`, not an ISO instant,
      // so the override reaching the index carries that form. Pinned
      // separately because a fix that only normalises timestamps would leave
      // the real user-facing path duplicating.
      addRecurring()
      addOverride('2026-03-10', {
        isAllDay: false,
        start: '2026-03-10T09:00:00.000Z',
        end: '2026-03-10T10:00:00.000Z',
        dueDate: '2026-03-10T10:00:00.000Z',
      })

      const dayKey = format(parseISO('2026-03-10T10:00:00.000Z'), 'yyyy-MM-dd')
      const tasks = getTasksForDay(events(), dayKey)
      expect(tasks).toHaveLength(1)
      expect(tasks[0].dueDate).toBe('2026-03-10T10:00:00.000Z')
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

    it('places the override on the occurrence date, for a master shaped as EventModal writes one', () => {
      // Regression: the override was built by hand instead of through
      // materializeOccurrenceAt, which reintroduced two separate off-by-ones —
      // dueDate taken from `end` (a day late for a 23:59:59 end) and the
      // recurrence id parsed as local rather than UTC midnight (a day early
      // east of UTC, putting DTSTART before its own RECURRENCE-ID).
      addRecurring({ start: '2026-03-03T00:00:00', end: '2026-03-03T23:59:59' })

      const plan = useCalendarStore
        .getState()
        .completeTaskOccurrence('gym', '2026-03-10T00:00:00', true)

      const override = plan!.override!
      expect(override.start).toBe('2026-03-10T00:00:00')
      expect(override.dueDate).toBe('2026-03-10')
      expect(override.start.split('T')[0]).toBe(override.recurrenceId!.split('T')[0])
    })

    it('round-trips complete then un-complete without stranding the occurrence', () => {
      // The same off-by-one made overrideHasUserEdits always true, so
      // un-completing kept the override and nextOpenOccurrence skipped past it
      // — the occurrence could never be reopened.
      addRecurring({ start: '2026-03-03T00:00:00', end: '2026-03-03T23:59:59' })

      const done = useCalendarStore
        .getState()
        .completeTaskOccurrence('gym', '2026-03-03T00:00:00', true)
      useCalendarStore.getState().addEvent(done!.override!)

      const undone = useCalendarStore
        .getState()
        .completeTaskOccurrence('gym', '2026-03-03T00:00:00', false)

      expect(undone!.override).toBeNull()
      expect(undone!.removedOverrideIds).toEqual([done!.override!.id])
    })

    it('can complete an occurrence straight off what the grid rendered', () => {
      // Regression: the calendar grids tick a task via its rendered card,
      // whose id is the synthetic `${masterId}-${occurrenceKey}`. That matches
      // nothing in the store, so completing it silently did nothing — the
      // checkbox in month/week/day view simply never responded. The rendered
      // occurrence must carry enough identity to address its own master.
      addRecurring({ start: '2026-03-03T00:00:00', end: '2026-03-03T23:59:59' })

      const [rendered] = getTasksForDay(events(), '2026-03-17')
      expect(rendered.occurrenceMasterId).toBe('gym')
      expect(rendered.id).not.toBe('gym')

      const plan = useCalendarStore
        .getState()
        .completeTaskOccurrence(rendered.occurrenceMasterId!, rendered.start, true)

      expect(plan).not.toBeNull()
      expect(plan!.override!.recurrenceId).toBe('2026-03-17T00:00:00')
      expect(plan!.override!.taskStatus).toBe('COMPLETED')
      // The series itself is untouched.
      expect(plan!.master.rruleString).toBe('FREQ=WEEKLY;BYDAY=TU')
      expect(plan!.master.completed).toBe(false)
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
