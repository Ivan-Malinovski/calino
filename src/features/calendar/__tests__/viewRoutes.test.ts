import { describe, it, expect } from 'vitest'
import { ALL_VIEWS, reconcileViewOrder, buildCycleOrder } from '../viewRoutes'
import type { ViewType } from '@/types'

const CANONICAL = ALL_VIEWS.map((v) => v.value)

describe('reconcileViewOrder', () => {
  it('falls back to the canonical order when nothing is stored', () => {
    expect(reconcileViewOrder(undefined).map((v) => v.value)).toEqual(CANONICAL)
    expect(reconcileViewOrder([]).map((v) => v.value)).toEqual(CANONICAL)
  })

  it('preserves a stored arrangement', () => {
    const stored: ViewType[] = [
      'agenda',
      'todo',
      'month',
      'week',
      'year',
      'day',
      'journal',
      'contacts',
    ]
    expect(reconcileViewOrder(stored).map((v) => v.value)).toEqual(stored)
  })

  it('appends views the stored order predates', () => {
    // Simulates upgrading into a build that ships a view the user's stored
    // arrangement has never seen.
    const stored: ViewType[] = ['agenda', 'month']
    const result = reconcileViewOrder(stored).map((v) => v.value)

    expect(result.slice(0, 2)).toEqual(['agenda', 'month'])
    expect([...result].sort()).toEqual([...CANONICAL].sort())
    // Newcomers keep their canonical relative order.
    const newcomers = result.slice(2)
    expect(newcomers).toEqual(CANONICAL.filter((v) => !stored.includes(v)))
  })

  it('drops views that no longer exist', () => {
    const stored = ['agenda', 'not-a-view', 'month'] as ViewType[]
    const result = reconcileViewOrder(stored).map((v) => v.value)

    expect(result).not.toContain('not-a-view')
    expect(result.slice(0, 2)).toEqual(['agenda', 'month'])
  })

  it('collapses duplicates rather than rendering a view twice', () => {
    const stored = ['agenda', 'agenda', 'month'] as ViewType[]
    const result = reconcileViewOrder(stored).map((v) => v.value)

    expect(result.filter((v) => v === 'agenda')).toHaveLength(1)
    expect(result).toHaveLength(CANONICAL.length)
  })

  it('always returns every shipped view exactly once', () => {
    for (const stored of [undefined, [], ['month'] as ViewType[], CANONICAL.slice().reverse()]) {
      const result = reconcileViewOrder(stored).map((v) => v.value)
      expect([...result].sort()).toEqual([...CANONICAL].sort())
    }
  })
})

describe('buildCycleOrder', () => {
  it('splices 3day in beside week, wherever week sits', () => {
    const reordered = reconcileViewOrder(['agenda', 'week', 'month'] as ViewType[])
    const cycle = buildCycleOrder(reordered)

    expect(cycle.indexOf('3day')).toBe(cycle.indexOf('week') + 1)
    expect(cycle[0]).toBe('agenda')
  })

  it('omits 3day when week is not present', () => {
    const cycle = buildCycleOrder(ALL_VIEWS.filter((v) => v.value !== 'week'))
    expect(cycle).not.toContain('3day')
  })

  it('covers every routable view in the default arrangement', () => {
    const cycle = buildCycleOrder(ALL_VIEWS)
    expect(cycle).toHaveLength(ALL_VIEWS.length + 1)
    expect(new Set(cycle).size).toBe(cycle.length)
  })
})
