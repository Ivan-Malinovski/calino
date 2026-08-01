import { useCallback, useEffect, useRef, useState } from 'react'
import { hapticIfEnabled } from '@/lib/haptics'

const LONG_PRESS_MS = 350
/** Movement before the long-press fires cancels it, so a swipe-to-dismiss
 *  or scroll that happens to start on a tile still wins the gesture. */
const LONG_PRESS_SLOP_PX = 8

interface Point {
  x: number
  y: number
}

export interface GridReorder {
  /** True once a long-press has armed reordering. Tiles jiggle in this mode. */
  reorderMode: boolean
  /** Index of the tile currently held, if any. */
  draggingIndex: number | null
  /** Translation to apply to the held tile so it tracks the finger. */
  dragDelta: Point
  /** Ref callback for the grid container. The hook binds one delegated
   *  pointerdown listener there and tracks the container's movement, so slot
   *  geometry stays correct while the sheet resizes. */
  registerGrid: (element: HTMLElement | null) => void
  exitReorderMode: () => void
  /** True if the gesture that just ended was a reorder, so the click that
   *  follows must not also navigate. */
  consumeDragClick: () => boolean
}

/**
 * Long-press-then-drag reordering for the mobile view grid.
 *
 * Slot geometry is measured once when a drag begins: cell positions are a
 * property of the grid, not of which view currently sits in them, so they
 * stay valid while tiles are reordered underneath. That lets the held tile
 * be positioned exactly — its offset is the finger's travel plus the
 * distance between the slot it started in and the slot it now occupies —
 * while every other tile animates between cells via framer's `layout`.
 */
export function useGridReorder(
  tileCount: number,
  onReorder: (from: number, to: number) => void
): GridReorder {
  const gridRef = useRef<HTMLElement | null>(null)
  const [reorderMode, setReorderMode] = useState(false)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [dragDelta, setDragDelta] = useState<Point>({ x: 0, y: 0 })

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gesture = useRef<{
    startPoint: Point
    /** Slot rects by index, captured at drag start. */
    slots: DOMRect[]
    /** The grid container's box at that same moment. Slots are stored
     *  relative to it, so the sheet growing or animating doesn't invalidate
     *  them. */
    gridOrigin: DOMRect | null
    originIndex: number
    currentIndex: number
    active: boolean
  } | null>(null)
  const didDrag = useRef(false)

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  useEffect(() => clearLongPress, [clearLongPress])

  const exitReorderMode = useCallback(() => {
    clearLongPress()
    gesture.current = null
    setReorderMode(false)
    setDraggingIndex(null)
    setDragDelta({ x: 0, y: 0 })
  }, [clearLongPress])

  /** Cell rects in index order, read from the DOM rather than from a map of
   *  per-tile refs — the tiles carry their index as an attribute, so there is
   *  nothing to keep in sync. */
  const measureSlots = useCallback((): DOMRect[] => {
    const grid = gridRef.current
    if (!grid) return []
    const tiles = Array.from(grid.querySelectorAll<HTMLElement>('[data-tile-index]')).sort(
      (a, b) => Number(a.dataset.tileIndex) - Number(b.dataset.tileIndex)
    )
    if (tiles.length !== tileCount) return []
    return tiles.map((tile) => tile.getBoundingClientRect())
  }, [tileCount])


  const onTilePointerDown = useCallback(
    (event: PointerEvent) => {
      const element = (event.target as Element | null)?.closest<HTMLElement>('[data-tile-index]')
      if (!element) return
      const index = Number(element.dataset.tileIndex)
      const startPoint = { x: event.clientX, y: event.clientY }
      const pointerId = event.pointerId
      didDrag.current = false

      const beginDrag = (): void => {
        const slots = measureSlots()
        if (slots.length !== tileCount) return
        gesture.current = {
          startPoint,
          slots,
          gridOrigin: gridRef.current?.getBoundingClientRect() ?? null,
          originIndex: index,
          currentIndex: index,
          active: true,
        }
        didDrag.current = true
        setReorderMode(true)
        setDraggingIndex(index)
        try {
          element.setPointerCapture(pointerId)
        } catch {
          // Capture is a nicety; the window listeners below already keep the
          // gesture alive if the element goes away mid-drag.
        }
      }

      // Already in reorder mode: a press picks a tile up immediately, no
      // second long-press required.
      if (reorderMode) {
        beginDrag()
      } else {
        longPressTimer.current = setTimeout(() => {
          longPressTimer.current = null
          hapticIfEnabled('medium')
          beginDrag()
        }, LONG_PRESS_MS)
      }

      const handleMove = (moveEvent: PointerEvent): void => {
        if (moveEvent.pointerId !== pointerId) return
        const g = gesture.current

        if (!g?.active) {
          // Still waiting on the long-press — bail out if this turned into a
          // swipe.
          const dx = moveEvent.clientX - startPoint.x
          const dy = moveEvent.clientY - startPoint.y
          if (Math.hypot(dx, dy) > LONG_PRESS_SLOP_PX) clearLongPress()
          return
        }

        moveEvent.preventDefault()

        // How far the grid itself has travelled since the drag began. Entering
        // reorder mode inserts the "Drag to rearrange" bar and the pill springs
        // to its new height, so the grid keeps moving for a few hundred ms.
        //
        // The tiles cannot be re-measured to compensate: framer `layout`
        // animates them, so their boxes mid-shuffle are in-flight positions,
        // not cell positions. The container is not layout-animated, so its
        // movement is the honest correction to apply to the slots captured at
        // rest.
        const gridNow = gridRef.current?.getBoundingClientRect()
        const shift =
          gridNow && g.gridOrigin
            ? { x: gridNow.left - g.gridOrigin.left, y: gridNow.top - g.gridOrigin.top }
            : { x: 0, y: 0 }

        const origin = g.slots[g.originIndex]
        const current = g.slots[g.currentIndex]
        setDragDelta({
          x: moveEvent.clientX - g.startPoint.x + (origin.left - current.left) - shift.x,
          y: moveEvent.clientY - g.startPoint.y + (origin.top - current.top) - shift.y,
        })

        // Nearest cell centre rather than strict containment: the grid has
        // gaps between tiles, and requiring the finger to be *inside* a tile
        // made those gaps dead zones where a drop silently did nothing.
        let overIndex = -1
        let bestDistance = Infinity
        g.slots.forEach((rect, index) => {
          const dx = moveEvent.clientX - (rect.left + shift.x + rect.width / 2)
          const dy = moveEvent.clientY - (rect.top + shift.y + rect.height / 2)
          const distance = Math.hypot(dx, dy)
          if (distance < bestDistance) {
            bestDistance = distance
            overIndex = index
          }
        })

        // ...but not unboundedly: a finger dragged well clear of the grid
        // shouldn't keep reordering against the closest edge tile.
        const slot = g.slots[g.originIndex]
        const reach = Math.hypot(slot.width, slot.height)
        if (bestDistance > reach) overIndex = -1

        if (overIndex >= 0 && overIndex !== g.currentIndex) {
          onReorder(g.currentIndex, overIndex)
          g.currentIndex = overIndex
          // The held view has moved to a new slot, so the "which tile is
          // lifted" marker has to move with it. Left pointing at the slot the
          // drag started in, the offset gets applied to whichever tile has
          // since taken that position, and the tile actually under the finger
          // renders untransformed — it looks like it snaps back to its cell
          // on every swap.
          setDraggingIndex(overIndex)
          hapticIfEnabled('light')
        }
      }

      const handleUp = (upEvent: PointerEvent): void => {
        if (upEvent.pointerId !== pointerId) return
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleUp)
        clearLongPress()
        if (gesture.current?.active) {
          gesture.current = null
          setDraggingIndex(null)
          setDragDelta({ x: 0, y: 0 })
          // Stay in reorder mode so several tiles can be moved in a row;
          // tapping outside or the Done control leaves it.
        }
      }

      window.addEventListener('pointermove', handleMove, { passive: false })
      window.addEventListener('pointerup', handleUp)
      window.addEventListener('pointercancel', handleUp)
    },
    [reorderMode, tileCount, measureSlots, onReorder, clearLongPress]
  )

  const consumeDragClick = useCallback((): boolean => {
    if (!didDrag.current) return false
    didDrag.current = false
    return true
  }, [])

  // Always call the freshest handler from a listener we only bind once.
  const handlerRef = useRef(onTilePointerDown)
  useEffect(() => {
    handlerRef.current = onTilePointerDown
  }, [onTilePointerDown])

  const gridListener = useRef<((event: PointerEvent) => void) | null>(null)

  /**
   * Ref callback for the grid container.
   *
   * One delegated pointerdown listener covers every tile, with the index
   * read from the tile's own `data-tile-index`. Binding natively here (rather
   * than via a React `onPointerDown` on each tile) keeps the handler
   * independent of React's event delegation and of the framer drag gesture on
   * the surrounding sheet, and leaves no per-tile ref bookkeeping to drift.
   */
  const registerGrid = useCallback((element: HTMLElement | null): void => {
    if (gridRef.current && gridListener.current) {
      gridRef.current.removeEventListener('pointerdown', gridListener.current)
      gridListener.current = null
    }
    gridRef.current = element
    if (!element) return

    const listener = (event: PointerEvent): void => handlerRef.current(event)
    element.addEventListener('pointerdown', listener)
    gridListener.current = listener
  }, [])

  useEffect(() => {
    return () => {
      if (gridRef.current && gridListener.current) {
        gridRef.current.removeEventListener('pointerdown', gridListener.current)
      }
    }
  }, [])

  return {
    reorderMode,
    draggingIndex,
    dragDelta,
    registerGrid,
    exitReorderMode,
    consumeDragClick,
  }
}
