import { useEffect, useLayoutEffect, useRef } from 'react'

interface UsePinchScaleOptions {
  /** Fired when a two-finger pinch begins, before any scaling is reported. */
  onPinchStart?: () => void
  /** Fired as the fingers move, with the spread relative to where they started
   *  (>1 pinching out, <1 pinching in). */
  onPinch: (ratio: number) => void
  /** Gate the listener (e.g. only on mobile). Defaults to true. */
  enabled?: boolean
  /** Spread change (px) required before the gesture is treated as a pinch, so
   *  a two-finger swipe doesn't register as one. */
  threshold?: number
}

/**
 * Two-finger pinch on the given element, via native touch events.
 *
 * `useGestures` nominally offers a pinch, but it does not fire on touch: with
 * `pointer: { touch: true }` @use-gesture hands back `onTouchStart`/`onTouchMove`
 * handlers, while `useGestures` only ever forwards `onPointerDown`/`Move`/`Up`
 * and `onWheel`. So its pinch has only ever worked from a trackpad wheel, and
 * its single-finger drag never fires on touch at all.
 *
 * Reports a ratio rather than an absolute scale so the caller can apply it to
 * whatever value it held when the gesture began, which is what makes repeated
 * pinches accumulate instead of snapping back to a fixed starting point.
 */
export function usePinchScale(
  ref: React.RefObject<HTMLElement | null>,
  { onPinchStart, onPinch, enabled = true, threshold = 12 }: UsePinchScaleOptions
): void {
  // Latest-ref pattern, as in useTwoFingerSwipe — keeps the listeners bound
  // across the re-renders that scaling itself causes.
  const onPinchRef = useRef(onPinch)
  const onPinchStartRef = useRef(onPinchStart)
  useLayoutEffect(() => {
    onPinchRef.current = onPinch
    onPinchStartRef.current = onPinchStart
  }, [onPinch, onPinchStart])

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return

    let startSpread = 0
    let active = false

    const spread = (t: TouchList): number =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)

    const handleTouchStart = (e: TouchEvent): void => {
      if (e.touches.length !== 2) {
        active = false
        return
      }
      startSpread = spread(e.touches)
      active = false
    }

    const handleTouchMove = (e: TouchEvent): void => {
      if (e.touches.length !== 2 || startSpread === 0) return
      const current = spread(e.touches)

      if (!active) {
        if (Math.abs(current - startSpread) < threshold) return
        active = true
        onPinchStartRef.current?.()
      }

      // The element underneath scrolls horizontally, and two fingers moving
      // apart would otherwise pan it while the pinch is being applied.
      e.preventDefault()
      onPinchRef.current(current / startSpread)
    }

    const reset = (): void => {
      active = false
      startSpread = 0
    }

    el.addEventListener('touchstart', handleTouchStart, { passive: true })
    el.addEventListener('touchmove', handleTouchMove, { passive: false })
    el.addEventListener('touchend', reset)
    el.addEventListener('touchcancel', reset)

    return () => {
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchmove', handleTouchMove)
      el.removeEventListener('touchend', reset)
      el.removeEventListener('touchcancel', reset)
    }
    // Callbacks are read through the refs above, so they are deliberately not
    // dependencies — re-binding on every render would drop in-flight gestures.
  }, [ref, enabled, threshold])
}
