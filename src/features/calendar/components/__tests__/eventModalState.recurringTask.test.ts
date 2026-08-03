import { describe, it, expect } from 'vitest'
import { getInitialFormState } from '../eventModalState'
import { getOccurrenceStart } from '@/lib/recurrenceDelete'
import { makeRecurringTask } from '@/lib/__tests__/fixtures'

/**
 * R2.7 — Which occurrence did the user act on?
 *
 * The modal answers this from the id it is opened with, and everything
 * downstream — "this occurrence" edits, "this and following" splits, and
 * single-occurrence deletes — depends on the answer. Handed a master's id
 * instead of an occurrence's, all three silently retarget the series' anchor
 * date, which is a data-loss bug the user only notices later: they delete the
 * occurrence they were looking at and a different one disappears.
 *
 * The Tasks list shows a whole series as one row and deliberately keeps the
 * MASTER's id on it (the subtask tree and drag/re-parent key off task ids), so
 * it has to hand the modal the occurrence id explicitly. These tests pin the
 * resolution chain that makes that work.
 */
describe('R2.7 opening a recurring task occurrence', () => {
  const calendars = [{ id: 'cal1', isDefault: true }]
  const master = makeRecurringTask('FREQ=WEEKLY;BYDAY=TU', {
    id: 'gym',
    uid: 'gym',
    calendarId: 'cal1',
    title: 'Exercise',
    start: '2026-03-03T00:00:00',
    end: '2026-03-03T23:59:59',
    dueDate: '2026-03-03',
  })

  const openWith = (id: string) =>
    getInitialFormState(true, id, null, null, [master], calendars, [])

  it('resolves an all-day occurrence id back to its master', () => {
    // All-day occurrence ids end in a bare date rather than a timestamp.
    const state = openWith('gym-2026-03-17')

    expect(state.isRecurringInstance).toBe(true)
    expect(state.originalEventId).toBe('gym')
    // The form is populated from the master, so the series' own rule is what
    // the recurrence controls show.
    expect(state.recurring).toBe(true)
  })

  it('resolves a timed occurrence id back to its master', () => {
    const state = openWith('gym-2026-03-17T09:00:00.000Z')

    expect(state.isRecurringInstance).toBe(true)
    expect(state.originalEventId).toBe('gym')
  })

  it('targets the occurrence the user opened, not the series anchor', () => {
    const state = openWith('gym-2026-03-17')

    // The regression: opened with the master's id, this resolved to the
    // master's own start (2026-03-03) — so deleting "this occurrence" from a
    // row showing 17 March excluded 3 March instead.
    expect(getOccurrenceStart(undefined, 'gym-2026-03-17', state.originalEventId)).toBe(
      '2026-03-17'
    )
  })

  it('still treats a plain master id as the series itself', () => {
    // Opening the master directly (e.g. a non-recurring task, or editing the
    // series as a whole) must NOT be mistaken for an occurrence.
    const state = openWith('gym')

    expect(state.isRecurringInstance).toBe(false)
    expect(state.originalEventId).toBeNull()
    expect(getOccurrenceStart(master, 'gym', null)).toBe('2026-03-03T00:00:00')
  })
})
