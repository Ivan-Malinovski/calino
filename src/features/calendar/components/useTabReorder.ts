import { useCallback, useRef, useState } from 'react'

const DRAG_THRESHOLD_PX = 6

interface TabReorderState {
  /** Id of the item currently being dragged, if any. */
  draggingId: string | null
  /** Index the dragged view would land on if dropped now. */
  targetIndex: number | null
  /** Pixels the dragged tab has travelled from its resting position. */
  dragOffset: number
}

export interface TabReorder extends TabReorderState {
  onTabPointerDown: (event: React.PointerEvent<HTMLElement>, index: number) => void
  /** True if the gesture that just ended was a drag, so the click that
   *  follows pointerup should not also switch views. */
  consumeDragClick: () => boolean
  /** Horizontal shift to apply to the tab at `index`, in px. */
  shiftFor: (index: number) => number
  /** Alt+Arrow keyboard equivalent. Returns true if it handled the key. */
  onTabKeyDown: (event: React.KeyboardEvent, index: number) => boolean
}

/**
 * Drag-to-reorder for the desktop view tab strip.
 *
 * Pointer-driven rather than HTML5 drag-and-drop: the tabs are buttons that
 * must stay clickable, and the native drag image/dragover model gives no
 * good way to animate neighbours making room.
 *
 * Nothing in the DOM order changes mid-drag. The dragged tab follows the
 * pointer via transform and its neighbours shift by one tab-width, so the
 * whole gesture is transform-only — the reorder is committed to the store
 * once, on drop.
 */
export function useTabReorder(
  items: { id: string; label: string }[],
  tabRefs: React.RefObject<Map<string, HTMLElement>>,
  onReorder: (from: number, to: number) => void,
  enabled: boolean,
  announce: (message: string) => void
): TabReorder {
  const [state, setState] = useState<TabReorderState>({
    draggingId: null,
    targetIndex: null,
    dragOffset: 0,
  })

  const gesture = useRef<{
    startX: number
    fromIndex: number
    dragging: boolean
    pointerId: number
    element: HTMLElement
  } | null>(null)
  const didDrag = useRef(false)

  // Width one tab occupies including the gap to the next — the distance a
  // neighbour shifts to make room. Measured from real geometry rather than
  // assumed, since tab widths vary with their labels.
  const slotWidth = useCallback(
    (index: number): number => {
      const tab = tabRefs.current?.get(items[index]?.id)
      if (!tab) return 0
      const next = tabRefs.current?.get(items[index + 1]?.id)
      const prev = tabRefs.current?.get(items[index - 1]?.id)
      if (next) return next.offsetLeft - tab.offsetLeft
      if (prev) return tab.offsetLeft - prev.offsetLeft
      return tab.offsetWidth
    },
    [items, tabRefs]
  )

  const finish = useCallback(() => {
    const g = gesture.current
    gesture.current = null
    setState((prev) => {
      if (g?.dragging && prev.targetIndex !== null && prev.targetIndex !== g.fromIndex) {
        onReorder(g.fromIndex, prev.targetIndex)
      }
      return { draggingId: null, targetIndex: null, dragOffset: 0 }
    })
  }, [onReorder])

  const onTabPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>, index: number) => {
      // Left button only, and never on touch — the mobile switcher is the
      // nav pill's grid, which has its own long-press reorder.
      if (!enabled || event.button !== 0 || event.pointerType === 'touch') return

      const element = event.currentTarget
      gesture.current = {
        startX: event.clientX,
        fromIndex: index,
        dragging: false,
        pointerId: event.pointerId,
        element,
      }
      didDrag.current = false

      const handleMove = (moveEvent: PointerEvent): void => {
        const g = gesture.current
        if (!g || moveEvent.pointerId !== g.pointerId) return
        const dx = moveEvent.clientX - g.startX

        if (!g.dragging) {
          if (Math.abs(dx) < DRAG_THRESHOLD_PX) return
          g.dragging = true
          didDrag.current = true
          g.element.setPointerCapture(g.pointerId)
        }

        // Walk outwards from the origin, accumulating slot widths until the
        // travelled distance no longer covers the next neighbour.
        let target = g.fromIndex
        if (dx > 0) {
          let covered = 0
          for (let i = g.fromIndex + 1; i < items.length; i++) {
            covered += slotWidth(i)
            if (dx > covered - slotWidth(i) / 2) target = i
            else break
          }
        } else {
          let covered = 0
          for (let i = g.fromIndex - 1; i >= 0; i--) {
            covered += slotWidth(i)
            if (-dx > covered - slotWidth(i) / 2) target = i
            else break
          }
        }

        setState({ draggingId: items[g.fromIndex].id, targetIndex: target, dragOffset: dx })
      }

      const handleUp = (upEvent: PointerEvent): void => {
        if (upEvent.pointerId !== gesture.current?.pointerId) return
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleUp)
        finish()
      }

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
      window.addEventListener('pointercancel', handleUp)
    },
    [enabled, items, slotWidth, finish]
  )

  const consumeDragClick = useCallback((): boolean => {
    if (!didDrag.current) return false
    didDrag.current = false
    return true
  }, [])

  const shiftFor = useCallback(
    (index: number): number => {
      const { draggingId, targetIndex, dragOffset } = state
      if (draggingId === null || targetIndex === null) return 0
      const fromIndex = items.findIndex((i) => i.id === draggingId)
      if (fromIndex < 0) return 0
      if (index === fromIndex) return dragOffset
      // Neighbours between the origin and the drop target step one slot
      // towards the gap the dragged tab left behind.
      if (fromIndex < targetIndex && index > fromIndex && index <= targetIndex) {
        return -slotWidth(fromIndex)
      }
      if (fromIndex > targetIndex && index < fromIndex && index >= targetIndex) {
        return slotWidth(fromIndex)
      }
      return 0
    },
    [state, items, slotWidth]
  )

  const onTabKeyDown = useCallback(
    (event: React.KeyboardEvent, index: number): boolean => {
      // Keyboard parity for the drag gesture — without it reordering would
      // be unreachable without a pointer.
      if (!enabled || !event.altKey) return false
      const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
      if (delta === 0) return false

      const to = index + delta
      if (to < 0 || to >= items.length) return true // absorb, but nothing to do

      event.preventDefault()
      onReorder(index, to)
      announce(`${items[index].label} moved to position ${to + 1} of ${items.length}`)
      return true
    },
    [enabled, items, onReorder, announce]
  )

  return { ...state, onTabPointerDown, consumeDragClick, shiftFor, onTabKeyDown }
}
