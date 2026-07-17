import { describe, it, expect } from 'vitest'
import { findEventById, buildEventIndex } from '../events'

type E = { id: string; title: string }

const master: E = { id: 'abc', title: 'Master' }
const other: E = { id: 'xyz', title: 'Other' }
const events: E[] = [master, other]
const instanceId = 'abc-2026-03-10T15:00:00.000Z'

describe('findEventById', () => {
  it('finds a direct match by id (array)', () => {
    expect(findEventById(events, 'abc')).toBe(master)
  })

  it('falls back to the recurrence master for a generated instance id', () => {
    expect(findEventById(events, instanceId)).toBe(master)
    expect(findEventById(events, 'abc-2026-03-10T15:00:00')).toBe(master)
    expect(findEventById(events, 'abc-2026-03-10T15:00:00Z')).toBe(master)
  })

  // All-day recurring instances are encoded as `<masterId>-<YYYY-MM-DD>` (no
  // time component, see `extractOriginalEventId` comment). Without the
  // date-only fallback in the extractor, a click on a recurring all-day card
  // would resolve to `undefined` and silently no-op the preview popup — see
  // the regression covered by `e2e/recurring-allday-month.spec.ts`.
  it('falls back to the recurrence master for a date-only all-day instance id', () => {
    const allDayInstanceId = 'abc-2026-03-10'
    expect(findEventById(events, allDayInstanceId)).toBe(master)
  })

  it('returns undefined for unknown id and nullish id', () => {
    expect(findEventById(events, 'nope')).toBeUndefined()
    expect(findEventById(events, null)).toBeUndefined()
    expect(findEventById(events, undefined)).toBeUndefined()
  })

  it('works with a prebuilt Map index (direct + fallback)', () => {
    const index = buildEventIndex(events)
    expect(findEventById(index, 'xyz')).toBe(other)
    expect(findEventById(index, instanceId)).toBe(master)
    // Map path also has to honour the date-only all-day instance suffix.
    expect(findEventById(index, 'abc-2026-03-10')).toBe(master)
    expect(findEventById(index, 'nope')).toBeUndefined()
  })
})

describe('buildEventIndex', () => {
  it('maps every event id to its event', () => {
    const index = buildEventIndex(events)
    expect(index.size).toBe(2)
    expect(index.get('abc')).toBe(master)
    expect(index.get('xyz')).toBe(other)
  })
})
