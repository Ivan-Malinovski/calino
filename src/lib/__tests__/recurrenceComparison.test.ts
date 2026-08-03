import { describe, it, expect } from 'vitest'
import { hasRecurrenceChanged, type RecurrenceFormState } from '../recurrenceComparison'
import { makeEvent, makeTask } from './fixtures'
import type { RecurrenceRule } from '@/types'

/**
 * This comparison gates the whole save: EventModal's `saveEvent` closes the
 * modal WITHOUT writing when `hasChanges` is false. A false negative here
 * therefore discards the user's edit silently — which is exactly how recurring
 * tasks shipped broken (R2.7), so these cases are regression guards, not
 * decoration.
 */
describe('hasRecurrenceChanged', () => {
  const form = (overrides: Partial<RecurrenceFormState> = {}): RecurrenceFormState => ({
    recurring: true,
    frequency: 'daily',
    interval: 1,
    byWeekday: [],
    byMonthDay: [],
    byMonth: [],
    byDayOrdinals: [],
    endCondition: 'never',
    endOnDate: '',
    endAfterCount: 10,
    ...overrides,
  })

  const daily: RecurrenceRule = { frequency: 'daily', interval: 1 }

  it('reports no change when the form still matches the stored rule', () => {
    expect(hasRecurrenceChanged(form(), makeEvent({ recurrence: daily }))).toBe(false)
  })

  it('detects a frequency change on a TASK', () => {
    // The original bug: daily → weekly on a task read as "no changes", so the
    // edit was dropped and the old rule survived a hard refresh.
    const task = makeTask({ recurrence: daily, rruleString: 'FREQ=DAILY' })
    const weekly = form({ frequency: 'weekly', byWeekday: [1, 4] })

    expect(hasRecurrenceChanged(weekly, task)).toBe(true)
  })

  it('detects a frequency change on an event', () => {
    expect(
      hasRecurrenceChanged(form({ frequency: 'weekly' }), makeEvent({ recurrence: daily }))
    ).toBe(true)
  })

  it('detects an interval change', () => {
    expect(hasRecurrenceChanged(form({ interval: 2 }), makeEvent({ recurrence: daily }))).toBe(true)
  })

  it('detects weekday selection changes', () => {
    const stored: RecurrenceRule = { frequency: 'weekly', interval: 1, byWeekday: [1] }
    const twoDays = form({ frequency: 'weekly', byWeekday: [1, 4] })

    expect(hasRecurrenceChanged(twoDays, makeEvent({ recurrence: stored }))).toBe(true)
  })

  it('detects turning recurrence on and off', () => {
    expect(hasRecurrenceChanged(form({ recurring: false }), makeEvent({ recurrence: daily }))).toBe(
      true
    )
    expect(hasRecurrenceChanged(form(), makeEvent())).toBe(true)
  })

  it('treats a raw RRULE with no structured rule as recurring', () => {
    // A CalDAV component whose RRULE failed to parse into a structured rule
    // still recurs; calling it non-recurring would make switching the toggle
    // OFF look like no change at all.
    const event = makeEvent({ rruleString: 'FREQ=DAILY', recurrence: undefined })

    expect(hasRecurrenceChanged(form({ recurring: false }), event)).toBe(true)
  })

  it('ignores the end-count input while the end condition is not "after"', () => {
    // The count field keeps its last value when the user switches back to
    // "never", and that must not read as a change they cannot see.
    const event = makeEvent({ recurrence: daily })

    expect(hasRecurrenceChanged(form({ endAfterCount: 25 }), event)).toBe(false)
  })

  it('detects an end condition change', () => {
    const event = makeEvent({ recurrence: daily })

    expect(hasRecurrenceChanged(form({ endCondition: 'after', endAfterCount: 5 }), event)).toBe(
      true
    )
    expect(hasRecurrenceChanged(form({ endCondition: 'on', endOnDate: '2026-06-30' }), event)).toBe(
      true
    )
  })

  it('reports no change for a count-bounded rule the user did not touch', () => {
    const bounded: RecurrenceRule = { frequency: 'daily', interval: 1, count: 5 }
    const matching = form({ endCondition: 'after', endAfterCount: 5 })

    expect(hasRecurrenceChanged(matching, makeEvent({ recurrence: bounded }))).toBe(false)
  })

  it('reads legacy bySetPos ordinals so old data does not look edited', () => {
    // R2.4 — per-BYDAY ordinals used to live in bySetPos.
    const legacy: RecurrenceRule = {
      frequency: 'monthly',
      interval: 1,
      byWeekday: [1],
      bySetPos: [2],
    }
    const asLoaded = form({ frequency: 'monthly', byWeekday: [1], byDayOrdinals: [2] })

    expect(hasRecurrenceChanged(asLoaded, makeEvent({ recurrence: legacy }))).toBe(false)
  })
})
