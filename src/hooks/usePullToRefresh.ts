import { useEffect, useRef, useState, type RefObject } from 'react'
import { toast } from 'sonner'
import { hapticIfEnabled } from '@/lib/haptics'

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>
  /** Gate the listener (e.g. only on mobile). Defaults to true. */
  enabled?: boolean
  /** Damped pull distance (px) required to trigger a refresh on release. */
  threshold?: number
}

interface UsePullToRefreshResult {
  /** Live damped pull distance while dragging, 0 when idle. Drives the indicator. */
  pullDistance: number
  isRefreshing: boolean
}

const MAX_PULL_DISTANCE = 100
const RESISTANCE = 0.5

/** Walks up from the touch target to find the nearest actually-scrollable
 * ancestor (within `boundary`) and returns its scrollTop. `main` itself has
 * `overflow: hidden` — each view (DayView, AgendaView, etc.) owns its own
 * inner scroll container — so checking `boundary.scrollTop` directly would
 * always read 0 and let the pull gesture hijack an in-progress inner scroll. */
function findScrollTop(target: EventTarget | null, boundary: HTMLElement): number {
  let el = target instanceof HTMLElement ? target : null
  while (el && el !== boundary.parentElement) {
    if (el.scrollHeight > el.clientHeight + 1) return el.scrollTop
    el = el.parentElement
  }
  return 0
}

/** Elements that own a competing vertical drag gesture (e.g. the month/agenda
 * split resize handles) opt out by setting `data-no-pull-refresh`. Without
 * this, dragging such a handle downwards also pulls the whole view and fires
 * a sync on release. */
function isOptedOut(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-no-pull-refresh]') !== null
}

/**
 * Pull-to-refresh via raw touch events, in the same raw-listener style as
 * useTwoFingerSwipe/useHorizontalSwipe rather than a gesture library. Unlike
 * those (discrete, fire-once gestures), this reports a live damped distance
 * via state so a visual indicator can track the finger while dragging.
 *
 * Only starts tracking when the target's own scrollTop is 0, so it doesn't
 * fight page/list scrolling further down.
 */
export function usePullToRefresh(
  target: RefObject<HTMLElement | null>,
  { onRefresh, enabled = true, threshold = 60 }: UsePullToRefreshOptions
): UsePullToRefreshResult {
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const onRefreshRef = useRef(onRefresh)
  useEffect(() => {
    onRefreshRef.current = onRefresh
  })
  const isRefreshingRef = useRef(false)

  useEffect(() => {
    const el = target.current
    if (!el || !enabled) return

    let tracking = false
    let hapticFired = false
    let startY = 0
    let startX = 0
    let axisLocked = false
    let currentPull = 0

    const setPull = (value: number): void => {
      currentPull = value
      setPullDistance(value)
    }

    const handleTouchStart = (e: TouchEvent): void => {
      if (
        isRefreshingRef.current ||
        e.touches.length !== 1 ||
        isOptedOut(e.target) ||
        findScrollTop(e.target, el) > 0
      ) {
        tracking = false
        return
      }
      tracking = true
      hapticFired = false
      axisLocked = false
      startY = e.touches[0].clientY
      startX = e.touches[0].clientX
    }

    const handleTouchMove = (e: TouchEvent): void => {
      if (!tracking || e.touches.length !== 1) return

      const dx = e.touches[0].clientX - startX
      const dy = e.touches[0].clientY - startY

      if (!axisLocked && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
        if (Math.abs(dx) > Math.abs(dy)) {
          tracking = false
          setPull(0)
          return
        }
        axisLocked = true
      }

      if (dy <= 0) {
        setPull(0)
        return
      }
      const damped = Math.min(dy * RESISTANCE, MAX_PULL_DISTANCE)
      setPull(damped)
      if (damped >= threshold && !hapticFired) {
        hapticFired = true
        hapticIfEnabled('light')
      }
    }

    const handleTouchEnd = (): void => {
      if (!tracking) return
      tracking = false

      const pulled = currentPull
      setPull(0)
      if (pulled >= threshold && !isRefreshingRef.current) {
        isRefreshingRef.current = true
        setIsRefreshing(true)
        void onRefreshRef
          .current()
          .catch(() => {
            toast.error('Sync failed')
          })
          .finally(() => {
            isRefreshingRef.current = false
            setIsRefreshing(false)
          })
      }
    }

    el.addEventListener('touchstart', handleTouchStart, { passive: true })
    el.addEventListener('touchmove', handleTouchMove, { passive: true })
    el.addEventListener('touchend', handleTouchEnd)
    el.addEventListener('touchcancel', handleTouchEnd)

    return () => {
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchmove', handleTouchMove)
      el.removeEventListener('touchend', handleTouchEnd)
      el.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [target, enabled, threshold])

  return { pullDistance, isRefreshing }
}
