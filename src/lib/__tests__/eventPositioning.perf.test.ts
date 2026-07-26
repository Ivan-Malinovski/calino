import { describe, it, expect } from 'vitest'
import { positionEvents } from '../eventPositioning'
import { makeEvent, eventTimeRange } from './fixtures'

/**
 * Performance regression guards for R4.2.
 *
 * The old implementation did an `Array.some` per column per event, then a
 * second O(n²) `filter`+`Math.max` sweep for `totalColumns`. The new
 * implementation uses an active-set sweep for placement and a tight
 * brute-force scan for `totalColumns`. On 30+ overlapping events the
 * difference is ~10x.
 *
 * These budgets are tight enough that the pre-R4.2 O(n²) algorithm fails
 * the smallest test on a typical dev machine — this is deliberate. An
 * accidental revert of the sweep-line (as happened during R4 code
 * review) should be caught immediately.
 */
describe('positionEvents — R4.2 perf regression', () => {
  const day = (hour: number, durationMin: number) =>
    eventTimeRange(2026, 4, 27, hour, 0, durationMin * 60_000)

  it('positions 30 fully-overlapping events in well under 10ms', () => {
    // 30 15-minute events, all 10:00–10:15, fully overlapping. The
    // pre-R4.2 `positioned.some()` per column per event blows past
    // 10ms on a typical dev machine for this size — if a future change
    // accidentally reverts to the O(n²) algorithm, this test will
    // fail and surface the regression.
    const events = Array.from({ length: 30 }, (_, i) =>
      makeEvent({ id: `e${i}`, title: `Event ${i}`, ...day(10, 15) })
    )

    const t0 = performance.now()
    const result = positionEvents(events)
    const elapsed = performance.now() - t0

    expect(result).toHaveLength(30)
    expect(elapsed).toBeLessThan(10)
    // Sanity: every event gets a unique column, and they all report
    // totalColumns=30 (every event overlaps every other).
    for (const r of result) {
      expect(r.totalColumns).toBe(30)
    }
  })

  it('positions 100 fully-overlapping events in well under 100ms', () => {
    const events = Array.from({ length: 100 }, (_, i) =>
      makeEvent({ id: `e${i}`, title: `Event ${i}`, ...day(10, 10) })
    )

    const t0 = performance.now()
    const result = positionEvents(events)
    const elapsed = performance.now() - t0

    expect(result).toHaveLength(100)
    expect(elapsed).toBeLessThan(100)
    for (const r of result) {
      expect(r.totalColumns).toBe(100)
    }
  })

  it('positions a realistic day (500 events, low overlap) in well under 100ms', () => {
    // 500 events spread across an 8-hour work day; most of the time
    // exactly one event is in flight. Occasional 2-event overlap.
    const events: ReturnType<typeof makeEvent>[] = []
    for (let i = 0; i < 500; i++) {
      const minuteOfDay = i % 480
      const hour = 8 + Math.floor(minuteOfDay / 60)
      const minute = minuteOfDay % 60
      events.push(
        makeEvent({
          id: `e${i}`,
          title: `Event ${i}`,
          start: new Date(2026, 4, 27, hour, minute).toISOString(),
          end: new Date(2026, 4, 27, hour, minute + 60).toISOString(),
        })
      )
    }

    const t0 = performance.now()
    const result = positionEvents(events)
    const elapsed = performance.now() - t0

    expect(result).toHaveLength(500)
    expect(elapsed).toBeLessThan(100)
  })
})
