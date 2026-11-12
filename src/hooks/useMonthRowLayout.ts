import { useCallback, useLayoutEffect, useMemo, useState, type RefObject } from 'react'
import { layoutMonthRows, type MonthRowLayout } from '@/features/calendar/lib/monthRowLayout'

interface Options {
  enabled: boolean
  /** The scrolling month grid; its height minus the weekday header is what the rows share. */
  gridRef: RefObject<HTMLElement | null>
  headerSelector: string
  /** Per-week height needed to show every item (see `weekNeed`). */
  needs: readonly number[]
  /** Index of the focused week. */
  focus: number
}

/**
 * Derives the height and rendering state of every week row from the height the
 * month grid is actually given. Returns `null` when disabled or before the
 * first measurement, so callers fall back to the flex layout.
 *
 * Reads the grid's allocated height, never its rendered rows: the rows are
 * sized from this value, so measuring them would make the layout chase itself.
 */
export function useMonthRowLayout({
  enabled,
  gridRef,
  headerSelector,
  needs,
  focus,
}: Options): MonthRowLayout | null {
  const [bodyHeight, setBodyHeight] = useState(0)

  const measure = useCallback((): void => {
    const grid = gridRef.current
    if (!grid) return
    const header = grid.querySelector<HTMLElement>(headerSelector)
    const next = Math.max(0, grid.clientHeight - (header?.offsetHeight ?? 0))
    setBodyHeight((previous) => (previous === next ? previous : next))
  }, [gridRef, headerSelector])

  useLayoutEffect(() => {
    if (!enabled) return
    measure()
    const grid = gridRef.current
    if (!grid || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(grid)
    return () => observer.disconnect()
  }, [enabled, gridRef, measure])

  return useMemo(
    () => (enabled && bodyHeight > 0 ? layoutMonthRows(bodyHeight, needs, focus) : null),
    [enabled, bodyHeight, needs, focus]
  )
}
