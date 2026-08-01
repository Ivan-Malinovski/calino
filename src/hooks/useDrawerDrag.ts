import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

interface UseDrawerDragOptions {
  /** Called once the gesture commits to closing, after the panel has animated out. */
  onClose?: () => void
  /** The scrim, dimmed in step with the drag. Optional. */
  overlayRef?: RefObject<HTMLElement | null>
  /** Class applied to the panel while a drag is live, to suspend its CSS transition. */
  draggingClass: string
  enabled?: boolean
  /** Fraction of the panel's width past which release commits to closing. */
  closeRatio?: number
  /** px/ms leftward at release that commits to closing regardless of distance. */
  velocityThreshold?: number
}

/** Must match the panel's own `transition: transform` duration. */
const SETTLE_MS = 300
/** Movement before the gesture locks to an axis — below this we don't know the intent. */
const AXIS_LOCK_PX = 8

/**
 * Finger-following drawer dismissal: the panel tracks the touch in real time
 * and either snaps back or completes its exit on release.
 *
 * Deliberately not built on `useHorizontalSwipe`, which recognizes a discrete
 * gesture once past a threshold and leaves the panel motionless until then.
 *
 * Styles are written straight to the nodes rather than through React state —
 * a re-render per touchmove would drop frames on the exact interaction whose
 * whole point is that it feels attached to the finger.
 */
export function useDrawerDrag(
  panelRef: RefObject<HTMLElement | null>,
  {
    onClose,
    overlayRef,
    draggingClass,
    enabled = true,
    closeRatio = 0.35,
    velocityThreshold = 0.5,
  }: UseDrawerDragOptions
): void {
  const onCloseRef = useRef(onClose)
  useLayoutEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const panel = panelRef.current
    if (!panel || !enabled) return

    let startX = 0
    let startY = 0
    let lastX = 0
    let lastT = 0
    let dx = 0
    let axis: 'none' | 'horizontal' | 'vertical' = 'none'
    let tracking = false
    let settleTimer: ReturnType<typeof setTimeout> | undefined

    const overlay = (): HTMLElement | null => overlayRef?.current ?? null

    const paint = (offset: number): void => {
      panel.style.transform = `translateX(${offset}px)`
      const scrim = overlay()
      if (scrim) {
        // Fade the scrim in proportion to how far the panel has travelled.
        scrim.style.opacity = String(Math.max(0, 1 + offset / panel.offsetWidth))
      }
    }

    const release = (): void => {
      tracking = false
      axis = 'none'
      panel.classList.remove(draggingClass)
    }

    const handleTouchStart = (e: TouchEvent): void => {
      if (e.touches.length !== 1) {
        tracking = false
        return
      }
      const touch = e.touches[0]
      tracking = true
      axis = 'none'
      dx = 0
      startX = lastX = touch.clientX
      startY = touch.clientY
      lastT = e.timeStamp
    }

    const handleTouchMove = (e: TouchEvent): void => {
      if (!tracking || e.touches.length !== 1) return
      const touch = e.touches[0]
      const totalX = touch.clientX - startX
      const totalY = touch.clientY - startY

      if (axis === 'none') {
        if (Math.abs(totalX) < AXIS_LOCK_PX && Math.abs(totalY) < AXIS_LOCK_PX) return
        // Vertical wins ties: the panel's content scrolls, and stealing that
        // would be far more annoying than a missed dismissal.
        axis = Math.abs(totalX) > Math.abs(totalY) * 1.2 ? 'horizontal' : 'vertical'
        if (axis === 'horizontal') panel.classList.add(draggingClass)
      }
      if (axis !== 'horizontal') return

      // Rightward drag has nowhere to go — the drawer is already fully open.
      // Damp it rather than ignoring it, so the panel still feels alive.
      dx = totalX < 0 ? totalX : totalX * 0.2
      lastX = touch.clientX
      lastT = e.timeStamp
      paint(dx)
    }

    const handleTouchEnd = (e: TouchEvent): void => {
      if (!tracking || axis !== 'horizontal') {
        release()
        return
      }

      const dt = Math.max(1, e.timeStamp - lastT)
      const velocity = (lastX - startX) / dt
      const shouldClose = dx < -panel.offsetWidth * closeRatio || velocity < -velocityThreshold

      release()

      if (shouldClose) {
        // Carry the panel the rest of the way out under its own CSS transition,
        // then unmount. Clearing the inline transform first would snap it back
        // to open for a frame.
        panel.style.transform = 'translateX(-100%)'
        const scrim = overlay()
        if (scrim) scrim.style.opacity = '0'
        settleTimer = setTimeout(() => {
          panel.style.transform = ''
          if (scrim) scrim.style.opacity = ''
          onCloseRef.current?.()
        }, SETTLE_MS)
      } else {
        panel.style.transform = ''
        const scrim = overlay()
        if (scrim) scrim.style.opacity = ''
      }
    }

    const handleTouchCancel = (): void => {
      release()
      panel.style.transform = ''
      const scrim = overlay()
      if (scrim) scrim.style.opacity = ''
    }

    panel.addEventListener('touchstart', handleTouchStart, { passive: true })
    panel.addEventListener('touchmove', handleTouchMove, { passive: true })
    panel.addEventListener('touchend', handleTouchEnd)
    panel.addEventListener('touchcancel', handleTouchCancel)

    return () => {
      if (settleTimer) clearTimeout(settleTimer)
      panel.classList.remove(draggingClass)
      panel.style.transform = ''
      const scrim = overlay()
      if (scrim) scrim.style.opacity = ''
      panel.removeEventListener('touchstart', handleTouchStart)
      panel.removeEventListener('touchmove', handleTouchMove)
      panel.removeEventListener('touchend', handleTouchEnd)
      panel.removeEventListener('touchcancel', handleTouchCancel)
    }
    // onClose is read through a ref so the listeners survive parent re-renders.
  }, [panelRef, overlayRef, draggingClass, enabled, closeRatio, velocityThreshold])
}
