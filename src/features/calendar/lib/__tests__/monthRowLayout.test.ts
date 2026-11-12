import { describe, expect, it } from 'vitest'
import {
  CHIP_PITCH,
  CHROME,
  MAX_COLLAPSED,
  expansionOrder,
  initialFocusWeek,
  layoutMonthRows,
  visibleChips,
  weekNeed,
  type MonthRowLayout,
} from '../monthRowLayout'

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0)

describe('weekNeed', () => {
  it('is the chrome plus one pitch per item of the busiest day', () => {
    expect(weekNeed([0, 1, 3, 2])).toBe(CHROME + 3 * CHIP_PITCH)
    expect(weekNeed([0, 0])).toBe(CHROME)
    expect(weekNeed([])).toBe(CHROME)
  })
})

describe('expansionOrder', () => {
  it('goes focus, later weeks nearest first, then earlier weeks nearest first', () => {
    expect(expansionOrder(2, 6)).toEqual([2, 3, 4, 5, 1, 0])
    expect(expansionOrder(0, 6)).toEqual([0, 1, 2, 3, 4, 5])
    expect(expansionOrder(5, 6)).toEqual([5, 4, 3, 2, 1, 0])
    expect(expansionOrder(1, 5)).toEqual([1, 2, 3, 4, 0])
  })
})

describe('layoutMonthRows', () => {
  const needs = [90, 90, 134, 90, 90, 90]

  it('always uses exactly the height it is given', () => {
    for (let h = 150; h <= 800; h += 7) {
      const { heights } = layoutMonthRows(h, needs, 2)
      expect(sum(heights)).toBeCloseTo(h, 5)
    }
  })

  it('collapses every row into dots when there is no spare height', () => {
    const { heights, rows } = layoutMonthRows(138, needs, 2)
    expect(heights.every((h) => h === 23)).toBe(true)
    expect(rows.every((r) => !r.expanded && r.tier === 'dots')).toBe(true)
  })

  it('keeps collapsed rows at the line tier ceiling while the focus row grows', () => {
    const { heights, rows } = layoutMonthRows(200, needs, 2)
    expect(heights[0]).toBe(MAX_COLLAPSED)
    expect(heights[2]).toBeGreaterThan(MAX_COLLAPSED)
    expect(rows[0].tier).toBe('line')
  })

  it('opens the focus week fully before the next one gets anything', () => {
    const h = 5 * MAX_COLLAPSED + 134 + 10
    const { heights } = layoutMonthRows(h, needs, 2)
    expect(heights[2]).toBe(134)
    // 6 rows share the height; the spare 10px after the focus row goes to the next week.
    expect(heights[3]).toBe(MAX_COLLAPSED + 10)
    expect(heights[1]).toBe(MAX_COLLAPSED)
    expect(heights[0]).toBe(MAX_COLLAPSED)
  })

  it('opens later weeks before earlier ones', () => {
    const h = 6 * MAX_COLLAPSED + (134 - MAX_COLLAPSED) + (90 - MAX_COLLAPSED) * 2
    const { heights } = layoutMonthRows(h, needs, 2)
    expect(heights[2]).toBe(134)
    expect(heights[3]).toBe(90)
    expect(heights[4]).toBe(90)
    expect(heights[5]).toBe(MAX_COLLAPSED)
    expect(heights[1]).toBe(MAX_COLLAPSED)
  })

  it('splits leftover space evenly once every row is fully open', () => {
    const total = sum(needs) + 60
    const { heights } = layoutMonthRows(total, needs, 2)
    needs.forEach((n, r) => expect(heights[r]).toBeCloseTo(n + 10, 5))
  })

  it('expands a row only once it reaches its expansion threshold', () => {
    const lonely = [60, 60, 60, 60, 60, 60]
    // Needs of 60 sit between EXPAND_FLOOR and EXPAND_CAP: expand at 60.
    expect(layoutMonthRows(5 * MAX_COLLAPSED + 59, lonely, 0).rows[0].expanded).toBe(false)
    expect(layoutMonthRows(5 * MAX_COLLAPSED + 60, lonely, 0).rows[0].expanded).toBe(true)
  })

  it('reserves at least one chip slot', () => {
    const { rows } = layoutMonthRows(138, needs, 0)
    expect(rows.every((r) => r.cap >= 1)).toBe(true)
  })

  it('clamps an out-of-range focus', () => {
    expect(layoutMonthRows(400, needs, 99).heights).toEqual(layoutMonthRows(400, needs, 5).heights)
    expect(layoutMonthRows(400, needs, -3).heights).toEqual(layoutMonthRows(400, needs, 0).heights)
  })

  it('handles an empty month', () => {
    expect(layoutMonthRows(400, [], 0)).toEqual({ heights: [], rows: [] })
  })

  it('never shows fewer items as the height grows', () => {
    // Day item counts per week; the busiest day sets `need`.
    const weeks: number[][] = [
      [2, 2, 3, 2, 2, 1, 3],
      [2, 2, 2, 2, 2, 1, 2],
      [3, 2, 2, 1, 4, 0, 0],
      [2, 2, 2, 2, 3, 0, 0],
      [1, 2, 2, 2, 2, 1, 1],
      [2, 1, 0, 0, 0, 0, 0],
    ]
    const weekNeeds = weeks.map(weekNeed)
    const visible = (layout: MonthRowLayout): number =>
      layout.rows.reduce((total, row, r) => {
        const perDay = weeks[r]
        if (row.expanded) {
          return total + sum(perDay.map((n) => visibleChips(n, row.cap).show))
        }
        // Collapsed: the dots tier draws no chip; the others draw the first item's chip.
        // Only chips count, as in the handoff's sweep (pips are a summary, not events).
        if (row.tier === 'dots') return total
        return total + perDay.filter((n) => n > 0).length
      }, 0)

    for (const focus of [0, 2, 5]) {
      let previous = -1
      for (let h = 240 - 34; h <= 720; h += 1) {
        const count = visible(layoutMonthRows(h, weekNeeds, focus))
        expect(count, `focus ${focus}, height ${h}`).toBeGreaterThanOrEqual(previous)
        previous = count
      }
    }
  })
})

describe('visibleChips', () => {
  it('shows everything that fits', () => {
    expect(visibleChips(3, 3)).toEqual({ show: 3, more: 0 })
    expect(visibleChips(0, 1)).toEqual({ show: 0, more: 0 })
  })

  it('reserves the last slot for "+N more" on overflow', () => {
    expect(visibleChips(4, 3)).toEqual({ show: 2, more: 2 })
    expect(visibleChips(2, 1)).toEqual({ show: 0, more: 2 })
  })
})

describe('initialFocusWeek', () => {
  const grid = (items: Record<number, number>): number[] =>
    Array.from({ length: 42 }, (_, i) => items[i] ?? 0)

  it('focuses the current week and selects today', () => {
    expect(initialFocusWeek(grid({ 15: 1 }), 14)).toEqual({ focus: 2, selected: 14 })
  })

  it('rolls forward when nothing is left from today to the end of the week', () => {
    // Today is Wed of week 1 (index 9); the only items sit before today and in week 3 (index 22).
    expect(initialFocusWeek(grid({ 7: 2, 22: 1, 24: 3 }), 9)).toEqual({ focus: 3, selected: 22 })
  })

  it('stays on the last week when no later week has items', () => {
    expect(initialFocusWeek(grid({}), 30)).toEqual({ focus: 5, selected: 35 })
  })
})
