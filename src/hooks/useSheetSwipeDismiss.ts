import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { animate, useMotionValue, type MotionValue } from 'framer-motion'

interface SheetSwipeOptions {
  /** Gate the whole gesture — pass `isMobile && !isDesktopLayout` etc. */
  enabled: boolean
  /** Whether the sheet is currently mounted/open; drives the entrance. */
  open: boolean
  /** The element that moves: the sheet itself. */
  sheetRef: RefObject<HTMLElement | null>
  /** Optional inner scroll container; a swipe there only counts at scroll top. */
  scrollRef?: RefObject<HTMLElement | null>
  /** Called once the sheet has been swiped away (after the exit animation). */
  onDismiss: () => void
  reducedMotion: boolean
}

/** px of downward travel before the swipe is ours. */
const CLAIM_DISTANCE = 8
/** How far off-axis a move may wander before it's clearly meant for something else. */
const AXIS_SLOP = 10
const DISMISS_OFFSET = 120
/** px/ms — a flick this fast dismisses regardless of distance. */
const DISMISS_VELOCITY = 0.6

/**
 * Swipe-down-to-dismiss for a mobile sheet, plus the matching slide-up
 * entrance, both driven through one motion value bound to the sheet's `y`.
 *
 * This owns the raw touch stream rather than using framer's `drag`, because
 * framer listens passively and Android's WebView reclaims the gesture partway
 * through — the sheet moves a few pixels and then snaps back when the browser
 * fires pointercancel. Calling `preventDefault()` non-passively the moment the
 * swipe is ours is what actually stops the WebView from taking it, and it's
 * also the only way to start a swipe from inside a scrollable region.
 *
 * Entrance shares the same motion value deliberately: `animate()` on a value
 * this hook already owns hands over cleanly to a drag, whereas a CSS keyframe
 * on the same element's transform fights it.
 */
export function useSheetSwipeDismiss({
  enabled,
  open,
  sheetRef,
  scrollRef,
  onDismiss,
  reducedMotion,
}: SheetSwipeOptions): MotionValue<number> {
  const y = useMotionValue(0)

  // Read through a ref so a caller's inline callback doesn't tear down and
  // re-attach the touch listeners on every render.
  const onDismissRef = useRef(onDismiss)
  useEffect(() => {
    onDismissRef.current = onDismiss
  })

  useLayoutEffect(() => {
    if (!open) return
    if (!enabled || reducedMotion) {
      y.set(0)
      return
    }
    y.set(window.innerHeight)
    const controls = animate(y, 0, { type: 'spring', stiffness: 340, damping: 36, mass: 0.9 })
    return () => controls.stop()
  }, [open, enabled, reducedMotion, y])

  useEffect(() => {
    const sheet = sheetRef.current
    if (!sheet || !enabled || !open) return

    let startX = 0
    let startY = 0
    let lastY = 0
    let lastT = 0
    let velocity = 0
    let eligible = false
    let claimed = false

    const onStart = (e: TouchEvent): void => {
      eligible = false
      claimed = false
      if (e.touches.length !== 1) return
      const target = e.target as HTMLElement
      // Controls with gestures of their own would lose them to the sheet.
      if (target.closest('textarea, select, input[type="range"]')) return
      // A live text selection has drag handles of its own — a touch that starts
      // on one is the user adjusting the selection, not dismissing the sheet.
      const selection = window.getSelection()
      if (
        selection &&
        !selection.isCollapsed &&
        selection.anchorNode &&
        sheet.contains(selection.anchorNode)
      )
        return
      // Inside a scroll region a swipe is only ours when there's nothing left
      // to scroll up into — otherwise this is an ordinary scroll.
      const scroller = scrollRef?.current
      if (scroller?.contains(target) && scroller.scrollTop > 0) return
      const touch = e.touches[0]
      startX = touch.clientX
      startY = touch.clientY
      lastY = touch.clientY
      lastT = e.timeStamp
      velocity = 0
      eligible = true
    }

    const onMove = (e: TouchEvent): void => {
      if (!eligible) return
      const touch = e.touches[0]
      const dy = touch.clientY - startY
      const dx = touch.clientX - startX
      if (!claimed) {
        if (dy < 0 || Math.abs(dx) > AXIS_SLOP) {
          eligible = false
          return
        }
        if (dy < CLAIM_DISTANCE) return
        claimed = true
      }
      // Keeping the gesture requires cancelling the browser's default on
      // every move, not just the first.
      if (e.cancelable) e.preventDefault()
      const dt = e.timeStamp - lastT
      if (dt > 0) velocity = (touch.clientY - lastY) / dt
      lastY = touch.clientY
      lastT = e.timeStamp
      y.set(dy - CLAIM_DISTANCE)
    }

    const onEnd = (): void => {
      if (!claimed) {
        eligible = false
        return
      }
      eligible = false
      claimed = false
      if (y.get() > DISMISS_OFFSET || velocity > DISMISS_VELOCITY) {
        if (reducedMotion) {
          onDismissRef.current()
          return
        }
        animate(y, window.innerHeight, { duration: 0.18, ease: 'easeIn' })
        setTimeout(() => onDismissRef.current(), 180)
      } else {
        animate(y, 0, { type: 'spring', stiffness: 480, damping: 38 })
      }
    }

    // Non-passive: `preventDefault()` in onMove is the whole point.
    sheet.addEventListener('touchstart', onStart, { passive: true })
    sheet.addEventListener('touchmove', onMove, { passive: false })
    sheet.addEventListener('touchend', onEnd)
    sheet.addEventListener('touchcancel', onEnd)
    return () => {
      sheet.removeEventListener('touchstart', onStart)
      sheet.removeEventListener('touchmove', onMove)
      sheet.removeEventListener('touchend', onEnd)
      sheet.removeEventListener('touchcancel', onEnd)
    }
  }, [enabled, open, reducedMotion, sheetRef, scrollRef, y])

  return y
}
