import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMonthEventCapacity } from '../useMonthEventCapacity'

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
  overrides: { weekCount?: number; compressedWeekCount?: number; enabled?: boolean } = {}
): ReturnType<typeof renderHook<ReturnType<typeof useMonthEventCapacity>, unknown>> {
  const rendered = renderHook(() =>
    useMonthEventCapacity({
      enabled: overrides.enabled ?? true,
      gridRef: { current: grid },
      headerSelector: '[data-component="calendar-grid-header"]',
      weekCount: overrides.weekCount ?? 5,
      compressedWeekCount: overrides.compressedWeekCount ?? 0,
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
        constructor(private cb: ResizeCallback) {}
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

  it('fits more events into a taller grid', () => {
    // 5 weeks over 730px of rows → ~146px cells: 45px of chrome leaves 101px,
    // and 29px rows (the last paying no 3px gap) fit three. At 570px the same
    // cells are 114px and only two fit.
    const short = measured(makeGrid(600))
    const tall = measured(makeGrid(760))

    expect(short.result.current?.full.rows).toBe(2)
    expect(tall.result.current?.full.rows).toBe(3)
  })

  it('re-measures when the grid resizes', async () => {
    const grid = makeGrid(600)
    const { result } = measured(grid)
    expect(result.current?.full.rows).toBe(2)

    Object.defineProperty(grid, 'clientHeight', { value: 1030, configurable: true })
    await act(async () => {
      observers.forEach((fire) => fire())
      // Measurements after the first are deferred a frame.
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    })
    expect(result.current?.full.rows).toBe(5)
  })

  it('holds a row back to make room for the "+N more" line', () => {
    // 760px of rows fits three cards, but not three and a rollup line.
    const { result } = measured(makeGrid(760))
    expect(result.current?.full.rows).toBe(3)
    expect(result.current?.full.rowsWithMore).toBe(2)
  })

  it('gives a compressed past week half the rows of a full one', () => {
    const { result } = measured(makeGrid(900, 30), { weekCount: 5, compressedWeekCount: 2 })
    const { full, compressed } = result.current!
    expect(compressed.rows).toBeLessThan(full.rows)
    expect(compressed.rows).toBeGreaterThanOrEqual(1)
  })

  it('never reports fewer than one row, however short the grid', () => {
    const { result } = measured(makeGrid(120))
    expect(result.current?.full.rows).toBe(1)
  })

  it('reports nothing when disabled, so callers fall back to the setting', () => {
    const { result } = measured(makeGrid(760), { enabled: false })
    expect(result.current).toBeNull()
  })
})
