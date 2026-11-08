import { describe, it, expect } from 'vitest'
import { planRollingTaskCompletion } from '@/lib/rollingTaskCompletion'
import { makeRecurringTask } from '@/lib/__tests__/fixtures'
import { eventToICAL } from '@/features/caldav/adapter/iCalendarAdapter'
import type {
  CalendarEvent,
  RollingFinalPlan,
  RollingRollPlan,
  RollingTaskCompletionPlan,
} from '@/types'

/**
 * R2.8 — Rolling completion mode.
 *
 * Completing an occurrence must leave every calendar object resource holding a
 * single VTODO: the master rolls forward, and the finished occurrence is
 * written as its own completed task under a new UID. That is the only shape
 * DAVx⁵/OpenTasks, Tasks.org, and Apple Reminders read back.
 */
describe('R2.8 rolling task completion', () => {
  const now = new Date('2026-03-03T18:00:00Z')
  const newUid = 'copy-uid'
  const plan = (
    master: CalendarEvent,
    occurrenceStart: string,
    overrides = new Map<string, CalendarEvent>()
  ): RollingTaskCompletionPlan | null =>
    planRollingTaskCompletion(master, occurrenceStart, overrides, { now, newUid })

  /** A plan that rolls the series and writes a copy. */
  const roll = (
    master: CalendarEvent,
    occurrenceStart: string,
    overrides = new Map<string, CalendarEvent>()
  ): RollingRollPlan => {
    const result = plan(master, occurrenceStart, overrides)
    if (result?.kind !== 'roll') throw new Error(`expected a roll plan, got ${result?.kind}`)
    return result
  }

  /** A plan that ends the series on the master itself. */
  const final = (
    master: CalendarEvent,
    occurrenceStart: string,
    overrides = new Map<string, CalendarEvent>()
  ): RollingFinalPlan => {
    const result = plan(master, occurrenceStart, overrides)
    if (result?.kind !== 'final') throw new Error(`expected a final plan, got ${result?.kind}`)
    return result
  }

  const weekly = (overrides: Partial<CalendarEvent> = {}): CalendarEvent =>
    makeRecurringTask('FREQ=WEEKLY;BYDAY=TU', {
      id: 'gym',
      uid: 'gym',
      title: 'Exercise',
      start: '2026-03-03T00:00:00',
      end: '2026-03-03T23:59:59',
      dueDate: '2026-03-03',
      ...overrides,
    })

  describe('completing the earliest open occurrence', () => {
    it('advances the master to the next occurrence and writes a standalone copy', () => {
      const result = roll(weekly(), '2026-03-03T00:00:00')

      // Master: same series identity, re-anchored on 10 March, still open.
      expect(result.master.id).toBe('gym')
      expect(result.master.uid).toBe('gym')
      expect(result.master.start).toBe('2026-03-10T00:00:00')
      expect(result.master.dueDate).toBe('2026-03-10')
      expect(result.master.completed).toBe(false)
      expect(result.master.taskStatus).toBe('NEEDS-ACTION')
      expect(result.master.rruleString).toBe('FREQ=WEEKLY;BYDAY=TU')

      // Copy: a brand-new task, single occurrence, completed at the old date.
      const copy = result.completedCopy
      expect(copy.id).toBe(newUid)
      expect(copy.uid).toBe(newUid)
      expect(copy.start).toBe('2026-03-03T00:00:00')
      expect(copy.dueDate).toBe('2026-03-03')
      expect(copy.completed).toBe(true)
      expect(copy.taskStatus).toBe('COMPLETED')
      expect(copy.percentComplete).toBe(100)
      expect(copy.completedAt).toBe(now.toISOString())
      // Nothing that would make the resource part of a series again.
      expect(copy.rruleString).toBeUndefined()
      expect(copy.recurrence).toBeUndefined()
      expect(copy.excludedDates).toBeUndefined()
      expect(copy.recurrenceId).toBeUndefined()
      expect(copy.recurrenceMasterId).toBeUndefined()
      expect(copy.occurrenceMasterId).toBeUndefined()
      expect(result.removedOverrideIds).toEqual([])
    })

    it('decrements COUNT by the slot the series consumed, keeping its length', () => {
      const result = roll(
        weekly({
          rruleString: 'FREQ=WEEKLY;BYDAY=TU;COUNT=4',
          recurrence: { frequency: 'weekly', interval: 1, byWeekday: [2], count: 4 },
        }),
        '2026-03-03T00:00:00'
      )

      expect(result.master.rruleString).toBe('FREQ=WEEKLY;BYDAY=TU;COUNT=3')
      expect(result.master.recurrence?.count).toBe(3)
    })

    it('leaves UNTIL alone and rolls an UNTIL-bounded series forward', () => {
      const result = roll(
        weekly({ rruleString: 'FREQ=WEEKLY;BYDAY=TU;UNTIL=20260324' }),
        '2026-03-03T00:00:00'
      )

      expect(result.master.rruleString).toBe('FREQ=WEEKLY;BYDAY=TU;UNTIL=20260324')
      expect(result.master.start).toBe('2026-03-10T00:00:00')
      expect(result.completedCopy.dueDate).toBe('2026-03-03')
    })

    it('skips occurrences the master already excludes', () => {
      const result = roll(weekly({ excludedDates: ['2026-03-10'] }), '2026-03-03T00:00:00')

      expect(result.master.start).toBe('2026-03-17T00:00:00')
      expect(result.master.dueDate).toBe('2026-03-17')
    })

    it('rolls a timed TZID series onto the next wall-clock occurrence', () => {
      const timed = weekly({
        isAllDay: false,
        timezone: 'Europe/Berlin',
        start: '2026-03-03T09:00:00',
        end: '2026-03-03T10:00:00',
        dueDate: '2026-03-03T09:00:00',
      })
      const result = roll(timed, '2026-03-03T09:00:00')

      // 09:00 Berlin (CET, UTC+1 before the DST change) is 08:00Z.
      expect(result.master.start).toBe('2026-03-10T08:00:00.000Z')
      expect(result.completedCopy.start).toBe('2026-03-03T08:00:00.000Z')
      expect(result.completedCopy.dueDate).toBe('2026-03-03T08:00:00.000Z')
    })
  })

  describe('completing a later occurrence out of order', () => {
    it('excludes just that date and leaves the anchor where it is', () => {
      const result = roll(weekly(), '2026-03-17T00:00:00')

      expect(result.master.start).toBe('2026-03-03T00:00:00')
      expect(result.master.dueDate).toBe('2026-03-03')
      expect(result.master.excludedDates).toEqual(['2026-03-17'])
      expect(result.master.rruleString).toBe('FREQ=WEEKLY;BYDAY=TU')
      expect(result.completedCopy.dueDate).toBe('2026-03-17')
      expect(result.completedCopy.completed).toBe(true)
    })

    it('does not duplicate an EXDATE that is already there', () => {
      const result = roll(weekly({ excludedDates: ['2026-03-17'] }), '2026-03-17T00:00:00')

      expect(result.master.excludedDates).toEqual(['2026-03-17'])
    })
  })

  describe('completing the final occurrence', () => {
    it('completes the master itself when COUNT runs out', () => {
      const result = final(
        weekly({
          rruleString: 'FREQ=WEEKLY;BYDAY=TU;COUNT=1',
          recurrence: { frequency: 'weekly', interval: 1, count: 1, byWeekday: [2] },
        }),
        '2026-03-03T00:00:00'
      )

      expect(result.master.id).toBe('gym')
      expect(result.master.completed).toBe(true)
      expect(result.master.taskStatus).toBe('COMPLETED')
      expect(result.master.percentComplete).toBe(100)
      expect(result.master.completedAt).toBe(now.toISOString())
    })

    it('completes the master when the occurrence is the last before UNTIL', () => {
      // 3 March is already done (as an override from the default mode), so the
      // 10 March edition really is the series' last open occurrence.
      const done = weekly({
        id: 'gym-2026-03-03T00:00:00',
        recurrenceId: '2026-03-03T00:00:00',
        recurrenceMasterId: 'gym',
        rruleString: undefined,
        recurrence: undefined,
        completed: true,
      })
      const overrides = new Map([
        ['2026-03-03T00:00:00', done],
        ['2026-03-03', done],
      ])
      const result = final(
        weekly({ rruleString: 'FREQ=WEEKLY;BYDAY=TU;UNTIL=20260310' }),
        '2026-03-10T00:00:00',
        overrides
      )

      expect(result.master.completed).toBe(true)
    })

    it('shows the completed final occurrence on its own date', () => {
      // The master is re-anchored onto the occurrence that ended the series, so
      // the Completed filter still has a row with that date on it.
      const done = weekly({
        id: 'gym-2026-03-03T00:00:00',
        recurrenceId: '2026-03-03T00:00:00',
        recurrenceMasterId: 'gym',
        rruleString: undefined,
        recurrence: undefined,
        completed: true,
      })
      const overrides = new Map([
        ['2026-03-03T00:00:00', done],
        ['2026-03-03', done],
      ])
      const result = final(
        weekly({ rruleString: 'FREQ=WEEKLY;BYDAY=TU;UNTIL=20260310' }),
        '2026-03-10T00:00:00',
        overrides
      )

      expect(result.master.start).toBe('2026-03-10T00:00:00')
      expect(result.master.dueDate).toBe('2026-03-10')
    })
  })

  describe('legacy RECURRENCE-ID overrides', () => {
    const overrideAt = (recurrenceId: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => {
      // A real override carries its own occurrence's dates, not the master's.
      const date = recurrenceId.slice(0, 10)
      return weekly({
        id: `gym-${recurrenceId}`,
        recurrenceId,
        recurrenceMasterId: 'gym',
        rruleString: undefined,
        recurrence: undefined,
        start: `${date}T00:00:00`,
        end: `${date}T23:59:59`,
        dueDate: date,
        completed: true,
        taskStatus: 'COMPLETED',
        ...extra,
      })
    }

    it('folds an override sharing the master resource into the copy and drops it', () => {
      const master = weekly({ resourceHref: '/cals/home/gym.ics' })
      const override = overrideAt('2026-03-03T00:00:00', {
        title: 'Exercise (edited)',
        resourceHref: '/cals/home/gym.ics',
      })
      const overrides = new Map([
        ['2026-03-03T00:00:00', override],
        ['2026-03-03', override],
      ])

      const result = roll(master, '2026-03-03T00:00:00', overrides)

      expect(result.completedCopy.title).toBe('Exercise (edited)')
      expect(result.removedOverrideIds).toEqual([override.id])
      expect(result.master.start).toBe('2026-03-10T00:00:00')
    })

    it('counts an override ahead of the anchor as a consumed slot', () => {
      const master = weekly({
        rruleString: 'FREQ=WEEKLY;BYDAY=TU;COUNT=5',
        resourceHref: '/cals/home/gym.ics',
      })
      const override = overrideAt('2026-03-10T00:00:00', {
        resourceHref: '/cals/home/gym.ics',
      })
      const overrides = new Map([
        ['2026-03-10T00:00:00', override],
        ['2026-03-10', override],
      ])

      const result = roll(master, '2026-03-03T00:00:00', overrides)

      // Five slots, two consumed (3 and 10 March) → three left from 17 March.
      expect(result.master.start).toBe('2026-03-17T00:00:00')
      expect(result.master.rruleString).toBe('FREQ=WEEKLY;BYDAY=TU;COUNT=3')
      // The 10 March completion leaves the master's resource as its own
      // finished task. It is behind the new anchor, so no EXDATE is needed.
      expect(result.removedOverrideIds).toEqual([override.id])
      expect(result.convertedOverrides).toHaveLength(1)
      expect(result.convertedOverrides[0]).toMatchObject({
        id: `${newUid}-1`,
        uid: `${newUid}-1`,
        completed: true,
        taskStatus: 'COMPLETED',
        recurrenceId: undefined,
        recurrenceMasterId: undefined,
        rruleString: undefined,
        resourceHref: undefined,
      })
      expect(result.convertedOverrides[0]!.dueDate?.slice(0, 10)).toBe('2026-03-10')
      expect(result.master.excludedDates ?? []).toEqual([])
    })

    it('turns an edited open override ahead of the anchor into a standalone task plus EXDATE', () => {
      const master = weekly({ resourceHref: '/cals/home/gym.ics' })
      const edited = overrideAt('2026-03-17T00:00:00', {
        title: 'Exercise (moved gym)',
        completed: false,
        taskStatus: 'NEEDS-ACTION',
        resourceHref: '/cals/home/gym.ics',
      })
      const overrides = new Map([
        ['2026-03-17T00:00:00', edited],
        ['2026-03-17', edited],
      ])

      const result = roll(master, '2026-03-03T00:00:00', overrides)

      // The edit makes 17 March closed to the rule, so the anchor is 10 March,
      // and 17 March, still ahead of it, is excluded from the series.
      expect(result.master.start).toBe('2026-03-10T00:00:00')
      expect((result.master.excludedDates ?? []).some((d) => d.startsWith('2026-03-17'))).toBe(true)
      expect(result.convertedOverrides).toHaveLength(1)
      expect(result.convertedOverrides[0]).toMatchObject({
        title: 'Exercise (moved gym)',
        completed: false,
        taskStatus: 'NEEDS-ACTION',
        recurrenceId: undefined,
      })
      expect(result.removedOverrideIds).toEqual([edited.id])
    })

    it('leaves an unrelated override that lives in its own resource alone', () => {
      const master = weekly({ resourceHref: '/cals/home/gym.ics' })
      const split = overrideAt('2026-03-10T00:00:00', {
        resourceHref: '/cals/home/gym-exception.ics',
      })
      const overrides = new Map([
        ['2026-03-10T00:00:00', split],
        ['2026-03-10', split],
      ])

      const result = roll(master, '2026-03-03T00:00:00', overrides)

      expect(result.convertedOverrides).toEqual([])
      expect(result.removedOverrideIds).toEqual([])
    })

    it('converts leftovers on the final occurrence too, without an EXDATE', () => {
      const master = weekly({
        rruleString: 'FREQ=WEEKLY;BYDAY=TU;COUNT=2',
        resourceHref: '/cals/home/gym.ics',
      })
      const done = overrideAt('2026-03-03T00:00:00', { resourceHref: '/cals/home/gym.ics' })
      const overrides = new Map([
        ['2026-03-03T00:00:00', done],
        ['2026-03-03', done],
      ])

      // 3 March is already done (override), so 10 March is the last open slot.
      const result = final(master, '2026-03-10T00:00:00', overrides)

      expect(result.master.taskStatus).toBe('COMPLETED')
      expect(result.convertedOverrides).toHaveLength(1)
      expect(result.removedOverrideIds).toEqual([done.id])
      expect(result.master.excludedDates ?? []).toEqual([])
    })

    it('declines an override that lives in its own resource', () => {
      const master = weekly({ resourceHref: '/cals/home/gym.ics' })
      const override = overrideAt('2026-03-03T00:00:00', {
        resourceHref: '/cals/home/gym-exception.ics',
      })
      const overrides = new Map([
        ['2026-03-03T00:00:00', override],
        ['2026-03-03', override],
      ])

      expect(plan(master, '2026-03-03T00:00:00', overrides)).toEqual({ kind: 'fallback' })
    })
  })

  describe('clicks that must not write a second completion', () => {
    it('ignores an occurrence the series has already moved past', () => {
      // What a second tap on a row that has not re-rendered yet looks like once
      // the first completion has rolled the master: the copy for 3 March
      // exists, so completing it again would duplicate it.
      const rolled = weekly({
        start: '2026-03-10T00:00:00',
        end: '2026-03-10T23:59:59',
        dueDate: '2026-03-10',
      })

      expect(plan(rolled, '2026-03-03T00:00:00')).toEqual({ kind: 'noop' })
    })

    it('leaves a date the current rule no longer generates to the override path', () => {
      // 4 March is a Wednesday: not in a BYDAY=TU series, so a copy would be
      // inventing an occurrence. The override shape names it explicitly.
      expect(plan(weekly(), '2026-03-04T00:00:00')).toEqual({ kind: 'fallback' })
    })
  })

  describe('plans nothing for tasks that cannot roll', () => {
    it('declines a non-recurring task', () => {
      expect(
        plan(weekly({ rruleString: undefined, recurrence: undefined }), '2026-03-03T00:00:00')
      ).toBeNull()
    })

    it('declines a recurring task with no due date to anchor it', () => {
      expect(plan(weekly({ dueDate: undefined }), '2026-03-03T00:00:00')).toBeNull()
    })
  })

  describe('wire format', () => {
    it('writes the copy as one VTODO under a new UID with no recurrence', () => {
      const result = roll(weekly(), '2026-03-03T00:00:00')
      const ics = eventToICAL(result.completedCopy)

      expect(ics.match(/BEGIN:VTODO/g)).toHaveLength(1)
      expect(ics).toContain(`UID:${newUid}`)
      expect(ics).not.toContain('RRULE')
      expect(ics).not.toContain('RECURRENCE-ID')
      expect(ics).not.toContain('EXDATE')
      expect(ics).toContain('STATUS:COMPLETED')
      expect(ics).toContain('PERCENT-COMPLETE:100')
      expect(ics).toContain('DUE;VALUE=DATE:20260303')
    })

    it('keeps the rolled master a single, open VTODO with the shortened rule', () => {
      const result = roll(
        weekly({
          rruleString: 'FREQ=WEEKLY;BYDAY=TU;COUNT=4',
          recurrence: { frequency: 'weekly', interval: 1, byWeekday: [2], count: 4 },
        }),
        '2026-03-03T00:00:00'
      )
      const ics = eventToICAL(result.master)

      expect(ics.match(/BEGIN:VTODO/g)).toHaveLength(1)
      expect(ics).toContain('UID:gym')
      expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=3')
      expect(ics).toContain('DUE;VALUE=DATE:20260310')
      expect(ics).toContain('STATUS:NEEDS-ACTION')
      expect(ics).not.toContain('STATUS:COMPLETED')
    })
  })
})
