import { describe, it, expect } from 'vitest'
import { rrulestr } from 'rrule'
import { buildMasterTruncation, getFutureOverrideIds, isFirstOccurrence } from '../recurrenceSplit'
import { makeEvent, makeRule } from './fixtures'
import type { CalendarEvent } from '@/types'

/**
 * Phase 0 verification for the "this and following" EDIT path
 * (`EventModal.tsx` 1075-1159) against the DELETE path
 * (`recurrenceDelete.ts` 102-133), which is the reference implementation.
 *
 * Everything here is either a fixed calendar day or a UTC instant, so no
 * assertion depends on the ambient zone — the suite runs in both `west`
 * (America/New_York) and `east` (Europe/Copenhagen). Where a fixture does carry
 * a wall clock it is written with an explicit `Z`.
 */

/** Number of occurrences an RRULE string yields from a UTC DTSTART. */
function occurrenceCount(rruleString: string, dtstartUtc: string): number {
  const rule = rrulestr(`DTSTART:${dtstartUtc}\nRRULE:${rruleString}`)
  return rule.all().length
}

describe('Phase 0 verification: buildMasterTruncation drops COUNT without redistributing it', () => {
  it('truncates a COUNT=10 master to the 4 occurrences before the split', () => {
    const master = makeEvent({
      id: 'master-1',
      uid: 'series-uid',
      start: '2024-03-01T00:00:00',
      end: '2024-03-01T00:00:00',
      isAllDay: true,
      recurrence: makeRule({ frequency: 'daily', interval: 1, count: 10 }),
      rruleString: 'FREQ=DAILY;COUNT=10',
    })

    // Split at the 5th occurrence (2024-03-05); the master keeps 1st-4th.
    const truncation = buildMasterTruncation(master, '2024-03-05')

    expect(truncation.recurrence?.count).toBeUndefined()
    expect(truncation.recurrence?.endDate).toBe('2024-03-04')
    expect(truncation.rruleString).toBe('FREQ=DAILY;UNTIL=20240304')
    expect(occurrenceCount(truncation.rruleString!, '20240301T000000Z')).toBe(4)
  })

  it('gives the split a total of 14 occurrences because the new series reuses the full COUNT', () => {
    const master = makeEvent({
      id: 'master-1',
      uid: 'series-uid',
      start: '2024-03-01T00:00:00',
      end: '2024-03-01T00:00:00',
      isAllDay: true,
      recurrence: makeRule({ frequency: 'daily', interval: 1, count: 10 }),
      rruleString: 'FREQ=DAILY;COUNT=10',
    })

    const truncation = buildMasterTruncation(master, '2024-03-05')
    const keptByMaster = occurrenceCount(truncation.rruleString!, '20240301T000000Z')

    // EventModal.tsx:1130 hands the new series `effectiveRecurrence`, which is
    // the form's own recurrence state. The form seeds `endAfterCount` from the
    // master's COUNT and the user did not touch it, so the new series is built
    // with the SAME count the original series had.
    const newSeriesRecurrence = { ...master.recurrence!, count: master.recurrence!.count }
    const newSeriesOccurrences = occurrenceCount(
      `FREQ=DAILY;COUNT=${newSeriesRecurrence.count}`,
      '20240305T000000Z'
    )

    expect(keptByMaster).toBe(4)
    expect(newSeriesOccurrences).toBe(10)
    // BUG: 4 + 10 = 14 occurrences from a series the user set to 10. Correct
    // behaviour: the new series gets COUNT = 10 - 4 = 6, for a total of 10.
    expect(keptByMaster + newSeriesOccurrences).toBe(14)
    expect(keptByMaster + newSeriesOccurrences).not.toBe(master.recurrence!.count)
  })

  it('leaves nothing in buildMasterTruncation that could carry the remaining count to a caller', () => {
    const master = makeEvent({
      isAllDay: true,
      start: '2024-03-01T00:00:00',
      recurrence: makeRule({ frequency: 'daily', count: 10 }),
      rruleString: 'FREQ=DAILY;COUNT=10',
    })
    const truncation = buildMasterTruncation(master, '2024-03-05')

    // BUG: the returned patch exposes only these three fields — there is no
    // "remaining count" for EventModal to hand the new series even if it wanted
    // to. Correct behaviour: the helper reports the consumed/remaining count.
    expect(Object.keys(truncation).sort()).toEqual(['excludedDates', 'recurrence', 'rruleString'])
  })
})

describe('Phase 0 verification: buildMasterTruncation writes a malformed UNTIL for sub-second starts', () => {
  /**
   * The timed branch does
   * `masterEndDate.replace(/[-:]/g, '').replace('.000', '')`, which only strips
   * the millisecond field when it happens to be exactly `.000`.
   */
  const timedMaster = (start: string): CalendarEvent =>
    makeEvent({
      id: 'master-2',
      uid: 'series-uid-2',
      start,
      end: '2024-03-01T15:00:00.000Z',
      isAllDay: false,
      // No structured `recurrence`, so `rruleString` is the branch that consumes
      // `untilValue` verbatim.
      recurrence: undefined,
      rruleString: 'FREQ=DAILY;COUNT=10',
    })

  it('emits a clean UNTIL when the occurrence lands on a whole second', () => {
    const truncation = buildMasterTruncation(
      timedMaster('2024-03-01T14:00:00.000Z'),
      '2024-03-05T14:00:00.000Z'
    )
    expect(truncation.rruleString).toBe('FREQ=DAILY;UNTIL=20240305T135959Z')
  })

  it('leaks the millisecond field into UNTIL when the occurrence has non-zero ms', () => {
    const truncation = buildMasterTruncation(
      timedMaster('2024-03-01T14:00:00.500Z'),
      '2024-03-05T14:00:00.500Z'
    )

    // BUG: `.500Z` survives, producing an UNTIL that is not an RFC 5545 §3.3.5
    // DATE-TIME. Correct behaviour: `UNTIL=20240305T135959Z`.
    expect(truncation.rruleString).toBe('FREQ=DAILY;UNTIL=20240305T135959.500Z')
    expect(() => rrulestr(`DTSTART:20240301T140000Z\nRRULE:${truncation.rruleString}`)).toThrow()
  })

  it('also leaks a sub-second endDate into the structured recurrence patch', () => {
    const master = makeEvent({
      start: '2024-03-01T14:00:00.500Z',
      isAllDay: false,
      recurrence: makeRule({ frequency: 'daily', count: 10 }),
      rruleString: 'FREQ=DAILY;COUNT=10',
    })
    const truncation = buildMasterTruncation(master, '2024-03-05T14:00:00.500Z')

    // BUG: `endDate` keeps the millisecond field too. Correct behaviour: the
    // split boundary is truncated to whole seconds.
    expect(truncation.recurrence?.endDate).toBe('2024-03-05T13:59:59.500Z')
  })
})

describe('Phase 0 verification: the edit path never computes future override ids', () => {
  const master = makeEvent({
    id: 'master-3',
    uid: 'series-uid-3',
    calendarId: 'cal1',
    start: '2024-03-01T00:00:00',
    isAllDay: true,
    recurrence: makeRule({ frequency: 'daily', count: 10 }),
    rruleString: 'FREQ=DAILY;COUNT=10',
  })

  const pastOverride = makeEvent({
    id: 'ovr-past',
    uid: 'series-uid-3',
    calendarId: 'cal1',
    recurrenceMasterId: 'master-3',
    recurrenceId: '2024-03-02',
    start: '2024-03-02T00:00:00',
    isAllDay: true,
  })

  const futureOverride = makeEvent({
    id: 'ovr-future',
    uid: 'series-uid-3',
    calendarId: 'cal1',
    recurrenceMasterId: 'master-3',
    recurrenceId: '2024-03-07',
    start: '2024-03-07T00:00:00',
    isAllDay: true,
  })

  const events = [master, pastOverride, futureOverride]

  it('getFutureOverrideIds identifies the override the split orphans', () => {
    // This is what recurrenceDelete.ts:120 passes as `removedOverrideIds`.
    expect(getFutureOverrideIds(events, master, '2024-03-05')).toEqual(['ovr-future'])
    expect(isFirstOccurrence(master, '2024-03-05')).toBe(false)
  })

  it('the truncated master no longer covers the future override RECURRENCE-ID', () => {
    const truncation = buildMasterTruncation(master, '2024-03-05')
    const occurrences = rrulestr(
      `DTSTART:20240301T000000Z\nRRULE:${truncation.rruleString}`
    ).all()
    const lastDay = occurrences[occurrences.length - 1].toISOString().split('T')[0]

    expect(lastDay).toBe('2024-03-04')
    // BUG: EventModal.tsx:1099-1118 applies exactly this truncation and then
    // stops — it never calls getFutureOverrideIds and never deletes or
    // reassigns 'ovr-future', so an override at 2024-03-07 stays attached to a
    // master whose UNTIL is 2024-03-04. Correct behaviour: the edit path
    // removes at-or-after overrides the way recurrenceDelete.ts:119-127 does.
    expect(futureOverride.recurrenceId! > lastDay).toBe(true)
  })
})
