import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  useMonthEventCapacity,
  fitMonthCell,
  pastWeekRowHeight,
  levelHeights,
  ITEM_HEIGHT,
  type MonthDayDemand,
} from '../useMonthEventCapacity'

/**
 * The hook reads real layout, so the grid is a stub element with a fixed
 * client height and a header of a known size, and ResizeObserver is faked so
 * the test drives the measurement itself.
 */
type ResizeCallback = () => void
let observers: ResizeCallback[] = []

function makeGrid(clientHeight: number, headerHeight = 30): HTMLElement {
  const header = document.createElement('div')
  header.setAttribute('data-component', 'calendar-grid-header')
  Object.defineProperty(header, 'offsetHeight', { value: headerHeight, configurable: true })

  const grid = document.createElement('div')
  Object.defineProperty(grid, 'clientHeight', { value: clientHeight, configurable: true })
  grid.appendChild(header)
  return grid
}

function measured(
  grid: HTMLElement,
  overrides: {
    weekCount?: number
    compressedWeekCount?: number
    enabled?: boolean
    rowHeightFloor?: number
    pastWeekDemand?: MonthDayDemand[][]
  } = {}
): ReturnType<typeof renderHook<ReturnType<typeof useMonthEventCapacity>, unknown>> {
  const rendered = renderHook(() =>
    useMonthEventCapacity({
      enabled: overrides.enabled ?? true,
      gridRef: { current: grid },
      headerSelector: '[data-component="calendar-grid-header"]',
      weekCount: overrides.weekCount ?? 5,
      compressedWeekCount: overrides.compressedWeekCount ?? 0,
      rowHeightFloor: overrides.rowHeightFloor ?? 0,
      pastWeekDemand: overrides.pastWeekDemand,
    })
  )
  act(() => {
    observers.forEach((fire) => fire())
  })
  return rendered
}

describe('useMonthEventCapacity', () => {
  beforeEach(() => {
    observers = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        cb: ResizeCallback
        constructor(cb: ResizeCallback) {
          this.cb = cb
        }
        observe(): void {
          observers.push(this.cb)
        }
        disconnect(): void {
          observers = observers.filter((fire) => fire !== this.cb)
        }
        unobserve(): void {}
      }
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports more content height for a taller grid', () => {
    // 5 weeks over 1000px of rows → 200px cells, less 45px of chrome.
    const short = measured(makeGrid(780))
    const tall = measured(makeGrid(1030))

    expect(short.result.current?.full.contentHeight).toBe(105)
    expect(tall.result.current?.full.contentHeight).toBe(155)
  })

  it('re-measures when the grid resizes', async () => {
    const grid = makeGrid(780)
    const { result } = measured(grid)
    expect(result.current?.full.contentHeight).toBe(105)

    Object.defineProperty(grid, 'clientHeight', { value: 1380, configurable: true })
    await act(async () => {
      observers.forEach((fire) => fire())
      // Measurements after the first wait for the size to settle.
      await new Promise((resolve) => setTimeout(resolve, 200))
    })
    expect(result.current?.full.contentHeight).toBe(225)
  })

  it('gives a compressed past week half the height of a full one', () => {
    const { result } = measured(makeGrid(900, 30), { weekCount: 5, compressedWeekCount: 2 })
    const { full, compressed } = result.current!
    expect(compressed.contentHeight).toBeLessThan(full.contentHeight)
    expect(compressed.contentHeight).toBeGreaterThan(0)
  })

  describe('past weeks sized to their content', () => {
    const empty: MonthDayDemand = { events: [], tasks: [] }
    const pills = (count: number): MonthDayDemand => ({
      events: Array<'compactEvent'>(count).fill('compactEvent'),
      tasks: [],
    })
    const week = (busiest: MonthDayDemand): MonthDayDemand[] => [
      busiest,
      empty,
      empty,
      empty,
      empty,
      empty,
      empty,
    ]

    it('shrinks a quiet week to its content and hands the rest to the weeks to come', () => {
      const grid = makeGrid(900, 30)
      const plain = measured(grid, { weekCount: 5, compressedWeekCount: 2 }).result.current!
      const sized = measured(grid, {
        weekCount: 5,
        compressedWeekCount: 2,
        pastWeekDemand: [week(pills(1)), week(empty)],
      }).result.current!

      // One pill: 45px of chrome + 20 + 2 spare. An empty week keeps the 50px minimum.
      expect(sized.pastWeeks.map((w) => w.height)).toEqual([67, 50])
      expect(sized.full.contentHeight).toBeGreaterThan(plain.full.contentHeight)
      // What it was given is enough for what it holds.
      expect(sized.pastWeeks[0].capacity.contentHeight).toBeGreaterThanOrEqual(20)
    })

    it('never grows a busy week past the compressed share', () => {
      const { result } = measured(makeGrid(900, 30), {
        weekCount: 5,
        compressedWeekCount: 2,
        pastWeekDemand: [week(pills(12)), week(empty)],
      })
      // 870px over 3 full + 2 half rows → 217.5px per full row, 108.75 per half.
      expect(result.current!.pastWeeks[0].height).toBeCloseTo(108.75)
    })

    it('leaves the weeks alone when there is no week to come to absorb the space', () => {
      const { result } = measured(makeGrid(900, 30), {
        weekCount: 2,
        compressedWeekCount: 2,
        pastWeekDemand: [week(empty), week(empty)],
      })
      expect(result.current!.pastWeeks).toEqual([])
    })

    it('does nothing unless asked', () => {
      const { result } = measured(makeGrid(900, 30), { weekCount: 5, compressedWeekCount: 2 })
      expect(result.current!.pastWeeks).toEqual([])
    })

    it('gives a quiet month back to its past weeks rather than one huge current week', () => {
      const { result } = measured(makeGrid(900, 30), {
        weekCount: 5,
        compressedWeekCount: 4,
        pastWeekDemand: [week(empty), week(empty), week(empty), week(empty)],
      })
      const { pastWeeks, full } = result.current!
      // 870px over 1 full + 4 half rows → 290px full, 145px half.
      // The week to come may grow to 1.25 × 290; the past weeks share the rest.
      expect(full.contentHeight).toBe(Math.floor(290 * 1.25) - 45)
      expect(pastWeeks.map((w) => w.height).every((h) => h > 50 && h <= 145)).toBe(true)
      expect(new Set(pastWeeks.map((w) => w.height)).size).toBe(1)
    })

    it('sizes by the busiest day, counting tasks and their gap', () => {
      const heights = ITEM_HEIGHT
      const busy: MonthDayDemand = { events: ['compactEvent', 'compactEvent'], tasks: ['task'] }
      // 45 chrome + (20 + 3 + 20) + 6 gap + 22 + 2 spare.
      expect(pastWeekRowHeight(week(busy), heights)).toBe(45 + 43 + 6 + 22 + 2)
    })
  })

  it('never reads a row as shorter than the min-height holding it open', () => {
    // 5 weeks over 250px of rows would be 50px cells, but the week-number
    // column keeps every row at 100px and the grid scrolls instead.
    const { result } = measured(makeGrid(280), { rowHeightFloor: 100 })
    expect(result.current?.full.contentHeight).toBe(55)
  })

  it('costs a row at the height one of its kind actually measures', () => {
    const grid = makeGrid(930)
    const pill = document.createElement('div')
    pill.setAttribute('data-row-kind', 'task')
    Object.defineProperty(pill, 'offsetHeight', { value: 31, configurable: true })
    grid.appendChild(pill)

    const { result } = measured(grid)
    expect(result.current?.full.itemHeights.task).toBe(31)
    // A kind the month doesn't contain keeps its seed rather than jittering.
    expect(result.current?.full.itemHeights.event).toBe(ITEM_HEIGHT.event)
  })

  it('reports nothing when disabled, so callers fall back to the setting', () => {
    const { result } = measured(makeGrid(930), { enabled: false })
    expect(result.current).toBeNull()
  })
})

describe('fitMonthCell', () => {
  const full = ITEM_HEIGHT.event
  const pill = ITEM_HEIGHT.compactEvent
  const task = ITEM_HEIGHT.task

  it('shows everything when everything fits, with no room held back', () => {
    // Two full cards and a task: 42 + 3 + 42 + 6 + 24 = 117.
    expect(fitMonthCell(117, [full, full], [task])).toEqual({ eventLimit: 2, taskLimit: 1 })
  })

  it('fits far more pills than cards into the same cell', () => {
    const cards = fitMonthCell(150, Array(8).fill(full), [])
    const pills = fitMonthCell(150, Array(8).fill(pill), [])
    expect(cards.eventLimit).toBe(2)
    expect(pills.eventLimit).toBe(5)
  })

  it('does not roll up a short pill-and-task day that still has room', () => {
    // The bug this replaced: one pill plus one task counted as two 45px rows,
    // so a 105px cell rolled up with 50px to spare.
    expect(fitMonthCell(105, [pill], [task])).toEqual({ eventLimit: 1, taskLimit: 1 })
  })

  it('holds room back for the "+N more" line once something overflows', () => {
    // 130px fits three cards exactly (42*3 + 3*2 = 132 does not, 129 does at
    // two) — the rollup line costs the third its place.
    const tight = fitMonthCell(132, Array(4).fill(full), [])
    expect(tight.eventLimit).toBe(2)
  })

  it('keeps one task visible however many events the day has', () => {
    const fit = fitMonthCell(120, Array(6).fill(full), [task, task])
    expect(fit.taskLimit).toBeGreaterThanOrEqual(1)
    expect(fit.eventLimit).toBeGreaterThanOrEqual(1)
  })

  it('shows at least one of each, however short the cell', () => {
    expect(fitMonthCell(10, [full, full], [task])).toEqual({ eventLimit: 1, taskLimit: 1 })
  })

  it('claims no task row on a day with no tasks', () => {
    expect(fitMonthCell(150, Array(5).fill(full), []).taskLimit).toBe(0)
  })
})

describe('levelHeights', () => {
  it('raises the shortest rows first', () => {
    const [a, b] = levelHeights([50, 100], 200, 50)
    expect(a).toBeCloseTo(100)
    expect(b).toBeCloseTo(100)
  })

  it('spreads what is left over evenly once the rows are level', () => {
    const [a, b] = levelHeights([50, 100], 200, 100)
    expect(a).toBeCloseTo(125)
    expect(b).toBeCloseTo(125)
  })

  it('stops at the cap', () => {
    expect(levelHeights([50, 100], 120, 1000)).toEqual([120, 120])
  })

  it('leaves rows alone with nothing to spend', () => {
    expect(levelHeights([50, 100], 200, 0)).toEqual([50, 100])
  })
})
