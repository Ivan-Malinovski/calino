import { describe, it, expect, vi } from 'vitest'
import { mapWithConcurrency, CALDAV_FETCH_CONCURRENCY } from '../mapWithConcurrency'

/** A deferred promise so a test can control exactly when a task settles. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('mapWithConcurrency', () => {
  it('returns results in input order, not completion order', async () => {
    const result = await mapWithConcurrency([30, 20, 10], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms))
      return ms
    })

    // 10 finishes first but must still land last.
    expect(result).toEqual([30, 20, 10])
  })

  it('never runs more than `limit` tasks at once', async () => {
    let active = 0
    let peak = 0

    await mapWithConcurrency(
      Array.from({ length: 12 }, (_, i) => i),
      3,
      async (i) => {
        active++
        peak = Math.max(peak, active)
        await new Promise((r) => setTimeout(r, 1))
        active--
        return i
      }
    )

    expect(peak).toBe(3)
  })

  it('starts a queued task as soon as a slot frees, not in fixed batches', async () => {
    const gates = [deferred<number>(), deferred<number>(), deferred<number>(), deferred<number>()]
    const started: number[] = []

    const run = mapWithConcurrency([0, 1, 2, 3], 2, async (i) => {
      started.push(i)
      return gates[i].promise
    })

    await Promise.resolve()
    expect(started).toEqual([0, 1])

    // Releasing one slot admits exactly one more — a batching implementation
    // would wait for both of the first pair instead.
    gates[0].resolve(0)
    await Promise.resolve()
    await Promise.resolve()
    expect(started).toEqual([0, 1, 2])

    gates[1].resolve(1)
    gates[2].resolve(2)
    gates[3].resolve(3)
    await expect(run).resolves.toEqual([0, 1, 2, 3])
  })

  it('rejects on the first failure, like Promise.all', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom')
        return n
      })
    ).rejects.toThrow('boom')
  })

  it('handles an empty input without calling the mapper', async () => {
    const fn = vi.fn()

    await expect(mapWithConcurrency([], 3, fn)).resolves.toEqual([])
    expect(fn).not.toHaveBeenCalled()
  })

  it('treats a limit below 1 as serial rather than deadlocking', async () => {
    let peak = 0
    let active = 0

    const result = await mapWithConcurrency([1, 2, 3], 0, async (n) => {
      active++
      peak = Math.max(peak, active)
      await Promise.resolve()
      active--
      return n
    })

    expect(result).toEqual([1, 2, 3])
    expect(peak).toBe(1)
  })

  it('bounds CalDAV fan-out at 3', () => {
    expect(CALDAV_FETCH_CONCURRENCY).toBe(3)
  })
})
