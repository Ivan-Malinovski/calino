import { useEffect, useRef, useLayoutEffect } from 'react'

interface UseTwoFingerSwipeOptions {
  /** Fired once per gesture when a horizontal two-finger swipe is detected. */
  onSwipe: (direction: 'left' | 'right') => void
  /** Gate the listener (e.g. only on mobile). Defaults to true. */
  enabled?: boolean
  /** Horizontal distance (px) the two-finger centroid must travel. */
  threshold?: number
}

/**
 * Detects a horizontal *two-finger* swipe on the given element using native
 * touch events. This intentionally sits alongside the single-finger
 * `@use-gesture` handlers (which own one-finger swipes for date navigation and
 * two-finger pinch for zoom) without conflicting: we only fire when both
 * fingers travel horizontally together while their spread stays roughly
 * constant, which lets us tell a swipe apart from a pinch.
 */
export function useTwoFingerSwipe(
  ref: React.RefObject<HTMLElement | null>,
  { onSwipe, enabled = true, threshold = 60 }: UseTwoFingerSwipeOptions
): void {
  const onSwipeRef = useRef(onSwipe)
  // Re-assign on every render so the ref always points at the latest
  // callback without forcing the effect to re-bind the touch listeners
  // every time the parent passes a new onSwipe (the canonical
  // "latest ref" pattern from the React docs).
  useLayoutEffect(() => {
    onSwipeRef.current = onSwipe
  }, [onSwipe])
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return

    let tracking = false
    let fired = false
    let startCenterX = 0
    let startCenterY = 0
    let startSpread = 0

    const spread = (t: TouchList): number =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const centerX = (t: TouchList): number => (t[0].clientX + t[1].clientX) / 2
    const centerY = (t: TouchList): number => (t[0].clientY + t[1].clientY) / 2

    const reset = (): void => {
      tracking = false
      fired = false
    }

    const handleTouchStart = (e: TouchEvent): void => {
      if (e.touches.length === 2) {
        tracking = true
        fired = false
        startCenterX = centerX(e.touches)
        startCenterY = centerY(e.touches)
        startSpread = spread(e.touches)
      } else {
        // A different finger count invalidates the two-finger gesture.
        tracking = false
      }
    }

    const handleTouchMove = (e: TouchEvent): void => {
      if (!tracking || fired || e.touches.length !== 2) return
      const dx = centerX(e.touches) - startCenterX
      const dy = centerY(e.touches) - startCenterY
      const spreadDelta = Math.abs(spread(e.touches) - startSpread)

      // Reject pinches (spread changed a lot) and mostly-vertical motion.
      if (spreadDelta > threshold) return
      if (Math.abs(dx) < threshold) return
      if (Math.abs(dx) < Math.abs(dy) * 1.5) return

      fired = true
      onSwipeRef.current(dx < 0 ? 'left' : 'right')
    }

    el.addEventListener('touchstart', handleTouchStart, { passive: true })
    el.addEventListener('touchmove', handleTouchMove, { passive: true })
    el.addEventListener('touchend', reset)
    el.addEventListener('touchcancel', reset)

    return () => {
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchmove', handleTouchMove)
      el.removeEventListener('touchend', reset)
      el.removeEventListener('touchcancel', reset)
    }
    // onSwipe is read via onSwipeRef.current (updated on every render at
    // line 27) so the touch listeners don't need to re-attach on every
    // parent re-render. Excluding it from deps is intentional.
  }, [ref, enabled, threshold])
}
