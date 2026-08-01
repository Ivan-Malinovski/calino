import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * How many event rows a month-view day cell can physically hold.
 *
 * The alternative — a fixed "show N then roll up" count — is wrong at both
 * ends: on a short window three cards overflow the cell, and on a tall one a
 * day with five events still says "+2 more" next to a stretch of empty cell.
 *
 * The arithmetic runs off the grid's *allocated* height rather than its
 * rendered rows on purpose. A rendered row grows with its content, so feeding
 * that back into the count would let capacity chase itself: more room → more
 * cards → taller row → more room. The scroll container's client height is
 * fixed by the viewport, so dividing it between the week rows the same way
 * flexbox does gives a number that can only change when the window does.
 */

/** `.compressedWeek { flex: 0.5 }` in CalendarGrid.module.css. */
const COMPRESSED_WEEK_FLEX = 0.5

/**
 * Everything in a day cell that isn't an event row: `.day` padding (5px twice),
 * its bottom border, and the `.dayHeader` — a 28px `.dayNumber` plus its 6px
 * margin.
 */
const CELL_CHROME = 45

/**
 * One event row: an `EventCard` (3+4 padding, 1px border twice, one 13px/1.3
 * line) plus the 3px `.events` gap above it. Cards that render compact are
 * shorter, so this errs towards leaving a gap rather than overflowing.
 */
const ROW_HEIGHT = 29

/** The `.events` gap, which the last row in a cell doesn't pay for. */
const ROW_GAP = 3

/** The `.moreEvents` button: 11.5px/normal text with 2px padding twice. */
const MORE_ROW_HEIGHT = 19

/** Rows a cell fits, with and without a "+N more" line to make room for. */
export interface MonthCellCapacity {
  rows: number
  rowsWithMore: number
}

export interface MonthEventCapacity {
  full: MonthCellCapacity
  compressed: MonthCellCapacity
}

function fit(cellHeight: number, reserved: number): number {
  // The bottom row pays no gap, so hand it back before dividing.
  const usable = cellHeight - CELL_CHROME - reserved + ROW_GAP
  return Math.max(1, Math.min(12, Math.floor(usable / ROW_HEIGHT)))
}

/**
 * Measures the month grid and reports how many event rows fit a day cell.
 * Returns null while unmeasured or when `enabled` is false, which callers read
 * as "use the fixed setting instead".
 *
 * @param gridRef the `.grid` scroll container, whose height the viewport fixes
 * @param headerSelector matches the weekday header row inside it
 */
export function useMonthEventCapacity({
  enabled,
  gridRef,
  headerSelector,
  weekCount,
  compressedWeekCount,
}: {
  enabled: boolean
  gridRef: React.RefObject<HTMLElement | null>
  headerSelector: string
  weekCount: number
  compressedWeekCount: number
}): MonthEventCapacity | null {
  const [capacity, setCapacity] = useState<MonthEventCapacity | null>(null)

  const measure = useCallback((): void => {
    const grid = gridRef.current
    if (!grid || weekCount <= 0) return
    const header = grid.querySelector<HTMLElement>(headerSelector)
    const available = grid.clientHeight - (header?.offsetHeight ?? 0)
    if (available <= 0) return

    // Same split flexbox makes: every week row is `flex: 1` except compressed
    // past weeks at `flex: 0.5`.
    const compressed = Math.min(compressedWeekCount, weekCount)
    const weight = weekCount - compressed + compressed * COMPRESSED_WEEK_FLEX
    const fullHeight = available / weight
    const compressedHeight = fullHeight * COMPRESSED_WEEK_FLEX

    const next: MonthEventCapacity = {
      full: { rows: fit(fullHeight, 0), rowsWithMore: fit(fullHeight, MORE_ROW_HEIGHT) },
      compressed: {
        rows: fit(compressedHeight, 0),
        rowsWithMore: fit(compressedHeight, MORE_ROW_HEIGHT),
      },
    }
    setCapacity((prev) =>
      prev &&
      prev.full.rows === next.full.rows &&
      prev.full.rowsWithMore === next.full.rowsWithMore &&
      prev.compressed.rows === next.compressed.rows &&
      prev.compressed.rowsWithMore === next.compressed.rowsWithMore
        ? prev
        : next
    )
  }, [gridRef, headerSelector, weekCount, compressedWeekCount])

  const rafRef = useRef(0)

  useEffect(() => {
    const grid = gridRef.current
    if (!enabled || !grid || typeof ResizeObserver === 'undefined') return
    // ResizeObserver fires once on observe, which is the first measurement —
    // taken straight through so the grid doesn't paint a frame of the fallback
    // count first. Later ones coalesce to a frame: dragging a window edge
    // fires the observer far more often than the row count can change.
    let measured = false
    const observer = new ResizeObserver(() => {
      if (!measured) {
        measured = true
        measure()
        return
      }
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(measure)
    })
    observer.observe(grid)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(rafRef.current)
    }
  }, [enabled, gridRef, measure])

  return enabled ? capacity : null
}
