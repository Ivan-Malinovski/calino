import type { RefObject } from 'react'
import { useCallback, useState } from 'react'

/** The CSS selector a grid cell must match to take part in roving focus. */
export type RovingGridCellSelector = string

/** Result of moving focus from the active cell towards a target cell. */
export type RovingMoveResult =
  | { ok: true; target: HTMLElement }
  | { ok: false; reason: 'no-cell' | 'no-target' }

/**
 * Roving-tabindex arrow navigation for a grid of focusable cells.
 *
 * Mirrors the month view's `handleGridKeyDown` (arrow keys move DOM focus and
 * the single roving tab stop; the active cell drops to `tabindex=-1` and the
 * newly focused cell becomes `tabindex=0`, so Tab enters the grid once rather
 * than once per cell).
 *
 * All three functions are stable across renders (the selector and container
 * ref are read lazily), so a grid can hand them to memoized children without
 * breaking their memo.
 *
 * @param containerRef The element that owns the keydown listener (the same
 *   element passed to `moveFocus`).
 * @param cellSelector CSS selector matching the navigable cells.
 * @param getDelta Key → index delta applied to the flattened cell list.
 *   `null` means the key is not a grid-navigation key and should be left for
 *   other handlers.
 */
export function useRovingGrid(
  containerRef: RefObject<HTMLElement | null>,
  cellSelector: RovingGridCellSelector,
  getDelta: (key: string) => number | null
): {
  /** Call as the `onKeyDown` handler of the grid container. */
  handleKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void
  /** The element that should carry `tabindex=0`; all others use `-1`. */
  focusAnchor: HTMLElement | null
  /** Update the anchor after the grid's cells change (e.g. re-render). */
  setFocusAnchor: (element: HTMLElement | null) => void
  /**
   * Move DOM focus and the roving tab stop from the cell currently under the
   * focus (or, failing that, the anchor cell) towards `delta` cells away.
   * Returns `{ ok: false, reason: 'no-target' }` when movement is blocked by
   * the grid edge, which callers use to trigger wrap-around paging.
   */
  moveFocus: (delta: number) => RovingMoveResult
} {
  const [focusAnchor, setFocusAnchor] = useState<HTMLElement | null>(null)

  const moveFocus = useCallback(
    (delta: number): RovingMoveResult => {
      const container = containerRef.current
      if (!container) return { ok: false, reason: 'no-target' }
      const cells = Array.from(container.querySelectorAll<HTMLElement>(cellSelector))
      const active = document.activeElement as HTMLElement | null
      const cell = active && container.contains(active) ? active.closest(cellSelector) : null
      const idx = cell ? cells.indexOf(cell as HTMLElement) : -1
      // Start from the anchor when the focus is elsewhere (e.g. moved by a
      // click) so the first keypress still moves relative to the grid.
      const base = idx !== -1 ? idx : focusAnchor ? cells.indexOf(focusAnchor) : -1
      if (base === -1) return { ok: false, reason: 'no-cell' }
      const target = cells[base + delta]
      if (!target) return { ok: false, reason: 'no-target' }
      cells[base].tabIndex = -1
      target.tabIndex = 0
      target.focus()
      setFocusAnchor(target)
      return { ok: true, target }
    },
    [containerRef, cellSelector, focusAnchor]
  )
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>): void => {
      const delta = getDelta(e.key)
      if (delta === null) return
      const container = e.currentTarget
      const active = document.activeElement as HTMLElement | null
      const cell = active?.closest(cellSelector) as HTMLElement | null
      if (!cell || !container.contains(cell)) return
      // Stop the window-level handlers (e.g. ↑/↓ paging the month) from also
      // firing while a grid cell owns keyboard focus.
      e.preventDefault()
      e.stopPropagation()
      const result = moveFocus(delta)
      if (!result.ok && result.reason === 'no-target') {
        // At the grid edge: the caller may want to page to the next week.
        e.currentTarget.dataset.rovingAtEdge = e.key
      } else {
        delete e.currentTarget.dataset.rovingAtEdge
      }
    },
    [cellSelector, getDelta, moveFocus]
  )

  return { handleKeyDown, focusAnchor, setFocusAnchor, moveFocus }
}
