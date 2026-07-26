import { useMemo, useState, useRef } from 'react'
import { useIsMobile } from './useIsMobile'
import { useReducedMotion } from './useReducedMotion'

export interface DateChangeMotion {
  initial: false | { opacity: number; x?: number; y?: number }
  animate: { opacity: number; x?: number; y?: number }
  exit: { opacity: number; transition: { duration: number } }
  transition: { duration: number; ease?: readonly [number, number, number, number] }
}

/**
 * Motion props for a view whose content is replaced when the calendar moves to
 * another date, leaning in the direction of travel.
 *
 * `marker` is whatever identifies the rendered period — a `yyyy-MM` month, a
 * `yyyy-MM-dd` day. Direction is derived by comparing it against the previous
 * one rather than being reported by whichever control did the navigating:
 * dates change from the header chevrons, the wheel, the keyboard, the
 * mini-calendar, and App.tsx's mobile swipe handler, and anything each caller
 * has to remember to wire up ends up wrong for the one that was missed.
 *
 * Only the incoming content animates. `AnimatePresence mode="wait"` runs the
 * exit to completion first, so any exit duration both delays this behind the
 * header title and plays the *outgoing* element's direction — that element
 * still holds the previous render's props.
 */
export function useDateChangeMotion(marker: string): DateChangeMotion {
  const isMobile = useIsMobile()
  const prefersReducedMotion = useReducedMotion()

  // Adjusted during render, not in an effect: framer reads `initial` when the
  // new child mounts, and an effect would land a render too late.
  const [prevMarker, setPrevMarker] = useState(marker)
  const [direction, setDirection] = useState<'next' | 'prev'>('next')
  const [isFastDesktop, setIsFastDesktop] = useState(false)
  const lastChangeTime = useRef(Date.now())

  // A mount is not a date change. The enclosing AnimatePresence doesn't set
  // `initial={false}`, so without this the slide fires when the view first
  // mounts — i.e. on every switch INTO month or agenda, where it ran on top of
  // ViewLoader's cross-fade and the view's own (expensive) first render, three
  // things contending for the same frames. Nothing has moved yet at that
  // point, so there is no direction of travel to lean into.
  const [hasChanged, setHasChanged] = useState(false)

  if (prevMarker !== marker) {
    setDirection(marker > prevMarker ? 'next' : 'prev')
    setPrevMarker(marker)
    setHasChanged(true)
    const now = Date.now()
    setIsFastDesktop(!isMobile && now - lastChangeTime.current < 750)
    lastChangeTime.current = now
  }

  return useMemo(() => {
    const forward = direction === 'next'
    const exit = { opacity: 0, transition: { duration: 0 } }
    if (!hasChanged || prefersReducedMotion || (isFastDesktop && !isMobile)) {
      return {
        initial: false,
        animate: { opacity: 1, x: 0, y: 0 },
        exit,
        transition: { duration: 0 },
      }
    }
    if (isMobile) {
      // Horizontal, to match the swipe that drives it on a phone.
      const travel = 28
      return {
        initial: { opacity: 0, x: forward ? travel : -travel },
        animate: { opacity: 1, x: 0 },
        exit,
        transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const },
      }
    }
    // Desktop navigates by scroll, so the motion follows that axis instead.
    // We use a longer duration (0.3s) and travel distance (24px) so it reads
    // as a smooth slide rather than a rapid blink/strobe.
    return {
      initial: { opacity: 0, y: forward ? -24 : 24 },
      animate: { opacity: 1, x: 0, y: 0 },
      exit,
      transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const },
    }
  }, [direction, isMobile, prefersReducedMotion, isFastDesktop, hasChanged])
}

