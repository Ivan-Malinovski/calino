import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

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
 * One event row: a month-view `EventCard` (42px measured — title and time on
 * their own lines) plus the 3px `.events` gap above it. Derived from the
 * rendered card rather than added up from the CSS, which came out at 29 and
 * badly overestimated how many fit. Compact cards and dots are shorter, so
 * this errs towards leaving a gap rather than overflowing the cell.
 */
const ROW_HEIGHT = 45

/** The `.events` gap, which the last row in a cell doesn't pay for. */
const ROW_GAP = 3

/** The `.moreEvents` button (16px measured) and the gap above it. */
const MORE_ROW_HEIGHT = 19

/** How long the grid has to hold a new size before the count follows it. */
const RESIZE_SETTLE_MS = 150

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
    if (!enabled || !grid || weekCount <= 0) return
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
  }, [enabled, gridRef, headerSelector, weekCount, compressedWeekCount])

  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // The first measurement has to land before the browser paints. Taking it
  // from the ResizeObserver's initial callback instead let the grid paint once
  // at the fallback count and then reflow, which moves every card in the month
  // a frame after it appears — enough to make a click that was already in
  // flight land on a card that has since moved or been replaced.
  useLayoutEffect(measure, [measure])

  useEffect(() => {
    const grid = gridRef.current
    if (!enabled || !grid || typeof ResizeObserver === 'undefined') return
    // Skip the callback `observe` fires immediately — the layout effect above
    // already took that one.
    //
    // Later ones settle before being acted on. Dragging a window edge fires
    // the observer far more often than the row count can change, and more
    // importantly a transient shift (a banner appearing, a scrollbar coming
    // and going) would otherwise re-lay-out every card in the month for a
    // frame — which yanks cards out from under a click already in flight.
    let seenInitialCallback = false
    const observer = new ResizeObserver(() => {
      if (!seenInitialCallback) {
        seenInitialCallback = true
        return
      }
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(measure, RESIZE_SETTLE_MS)
    })
    observer.observe(grid)
    return () => {
      observer.disconnect()
      clearTimeout(timerRef.current)
    }
  }, [enabled, gridRef, measure])

  return enabled ? capacity : null
}
