import { useEffect, useRef, type RefObject, useLayoutEffect } from 'react'

interface UseHorizontalSwipeOptions {
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  /** Gate the listener (e.g. only on mobile, only while open/closed). Defaults to true. */
  enabled?: boolean
  /** Horizontal distance (px) the touch must travel. */
  threshold?: number
  /** Only start tracking a gesture that begins within this many px of the
   * viewport's left edge. Omit to allow starting anywhere on the target. */
  edgeZonePx?: number
}

/**
 * Single-finger horizontal swipe detection via raw touch events, in the same
 * style as useTwoFingerSwipe: a discrete gesture recognized once per touch
 * sequence past a distance threshold, not a live finger-following drag.
 *
 * `target: 'document'` is for edge-swipe-open, where a real overlay element
 * covering the edge would sit on top of other left-edge controls (e.g. the
 * header hamburger button) and risk swallowing taps — a passive document
 * listener filtered by starting x-coordinate has no hit-testing footprint.
 */
export function useHorizontalSwipe(
  target: RefObject<HTMLElement | null> | 'document',
  {
    onSwipeLeft,
    onSwipeRight,
    enabled = true,
    threshold = 50,
    edgeZonePx,
  }: UseHorizontalSwipeOptions
): void {
  const callbacksRef = useRef({ onSwipeLeft, onSwipeRight })
  useLayoutEffect(() => {
    callbacksRef.current = { onSwipeLeft, onSwipeRight }
  }, [onSwipeLeft, onSwipeRight])
  useEffect(() => {
    const el = target === 'document' ? document : target.current
    if (!el || !enabled) return

    let tracking = false
    let fired = false
    let startX = 0
    let startY = 0

    const handleTouchStart = (e: TouchEvent): void => {
      if (e.touches.length !== 1) {
        tracking = false
        return
      }
      const touch = e.touches[0]
      if (edgeZonePx !== undefined && touch.clientX > edgeZonePx) {
        tracking = false
        return
      }
      tracking = true
      fired = false
      startX = touch.clientX
      startY = touch.clientY
    }

    const handleTouchMove = (e: TouchEvent): void => {
      if (!tracking || fired || e.touches.length !== 1) return
      const touch = e.touches[0]
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY

      if (Math.abs(dx) < threshold) return
      if (Math.abs(dx) < Math.abs(dy) * 1.5) return

      fired = true
      if (dx < 0) callbacksRef.current.onSwipeLeft?.()
      else callbacksRef.current.onSwipeRight?.()
    }

    const reset = (): void => {
      tracking = false
      fired = false
    }

    el.addEventListener('touchstart', handleTouchStart as EventListener, { passive: true })
    el.addEventListener('touchmove', handleTouchMove as EventListener, { passive: true })
    el.addEventListener('touchend', reset)
    el.addEventListener('touchcancel', reset)

    return () => {
      el.removeEventListener('touchstart', handleTouchStart as EventListener)
      el.removeEventListener('touchmove', handleTouchMove as EventListener)
      el.removeEventListener('touchend', reset)
      el.removeEventListener('touchcancel', reset)
    }
    // onSwipeLeft/onSwipeRight are read via refs (updated above on every
    // render) so the listeners don't need to re-attach on every parent
    // re-render. Excluding them from deps is intentional.
  }, [target, enabled, threshold, edgeZonePx])
}
