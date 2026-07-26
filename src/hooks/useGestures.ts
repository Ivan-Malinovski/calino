import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDrag, usePinch } from '@use-gesture/react'

export interface UseGesturesOptions {
  onLongPress?: (position: { x: number; y: number }) => void
  onSwipe?: (direction: 'left' | 'right' | 'up' | 'down') => void
  onPinch?: (scale: number, offset: number) => void
  onTap?: (position: { x: number; y: number }) => void
  onDragStart?: () => void
  onDragEnd?: (position: { x: number; y: number }) => void
  longPressDelay?: number
  swipeThreshold?: number
  pinchScaleRange?: { min: number; max: number }
}

export interface UseGesturesReturn {
  bind: Record<string, unknown>
  gestureState: 'idle' | 'detecting' | 'swiping' | 'pinching' | 'dragging' | 'longPress'
}

export function useGestures({
  onLongPress,
  onSwipe,
  onPinch,
  onTap,
  onDragStart,
  onDragEnd,
  longPressDelay = 400,
  swipeThreshold = 50,
  pinchScaleRange = { min: 0.7, max: 1.5 },
}: UseGesturesOptions = {}): UseGesturesReturn {
  const [gestureState, setGestureState] = useState<
    'idle' | 'detecting' | 'swiping' | 'pinching' | 'dragging' | 'longPress'
  >('idle')
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchStartPos = useRef<{ x: number; y: number } | null>(null)
  const lastDirection = useRef<'left' | 'right' | 'up' | 'down' | null>(null)
  const currentGesture = useRef<
    'idle' | 'detecting' | 'swiping' | 'pinching' | 'dragging' | 'longPress'
  >('idle')
  const mountedRef = useRef(true)

  // Store callbacks in refs to avoid stale closures (@use-gesture/react captures once)
  const onLongPressRef = useRef(onLongPress)
  const onSwipeRef = useRef(onSwipe)
  const onPinchRef = useRef(onPinch)
  const onTapRef = useRef(onTap)
  const onDragStartRef = useRef(onDragStart)
  const onDragEndRef = useRef(onDragEnd)
  const longPressDelayRef = useRef(longPressDelay)
  const swipeThresholdRef = useRef(swipeThreshold)
  const pinchScaleRangeRef = useRef(pinchScaleRange)

  // Sync all refs in a single effect (avoids 9 separate subscriptions)
  useEffect(() => {
    onLongPressRef.current = onLongPress
    onSwipeRef.current = onSwipe
    onPinchRef.current = onPinch
    onTapRef.current = onTap
    onDragStartRef.current = onDragStart
    onDragEndRef.current = onDragEnd
    longPressDelayRef.current = longPressDelay
    swipeThresholdRef.current = swipeThreshold
    pinchScaleRangeRef.current = pinchScaleRange
  }, [
    onLongPress,
    onSwipe,
    onPinch,
    onTap,
    onDragStart,
    onDragEnd,
    longPressDelay,
    swipeThreshold,
    pinchScaleRange,
  ])

  // Cleanup long press timer on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current)
        longPressTimer.current = null
      }
    }
  }, [])

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  // @use-gesture/react handles the distance/velocity thresholds internally via
  // its `threshold` and `swipe` config options — we no longer duplicate them
  // here. We just translate the gesture state to our legacy `gestureState`
  // and forward callbacks to the consumer.
  const bind = useDrag(
    (state) => {
      const {
        active,
        first,
        last,
        movement: [mx, my],
        swipe: [sx, sy],
        intentional,
      } = state
      const event = state.event as unknown as { clientX: number; clientY: number }
      const clientX = event.clientX
      const clientY = event.clientY

      if (first) {
        currentGesture.current = 'detecting'
        setGestureState('detecting')
        touchStartPos.current = { x: clientX, y: clientY }

        longPressTimer.current = setTimeout(() => {
          if (currentGesture.current === 'detecting') {
            currentGesture.current = 'longPress'
            setGestureState('longPress')
            onLongPressRef.current?.({ x: clientX, y: clientY })
          }
        }, longPressDelayRef.current)
      }

      if (active && intentional) {
        clearLongPressTimer()

        if (sx !== 0 || sy !== 0) {
          // The library has detected a swipe past the configured distance/velocity.
          currentGesture.current = 'swiping'
          setGestureState('swiping')
          if (sx !== 0) lastDirection.current = sx > 0 ? 'right' : 'left'
          else if (sy !== 0) lastDirection.current = sy > 0 ? 'down' : 'up'
        } else if (currentGesture.current === 'detecting') {
          // Moved past the threshold but not a swipe → drag.
          currentGesture.current = 'dragging'
          setGestureState('dragging')
          onDragStartRef.current?.()
        }
      }

      if (last) {
        clearLongPressTimer()

        if (currentGesture.current === 'swiping' && lastDirection.current) {
          onSwipeRef.current?.(lastDirection.current)
        } else if (currentGesture.current === 'dragging') {
          onDragEndRef.current?.({ x: clientX, y: clientY })
        } else if (currentGesture.current === 'detecting' && touchStartPos.current) {
          // Tap: short, deliberate press with no significant movement.
          // The lib's filterTaps handles the distance check; we just need to
          // know the gesture ended without entering drag/swipe/long-press.
          const tapDistance = Math.sqrt(
            Math.pow(clientX - touchStartPos.current.x, 2) +
              Math.pow(clientY - touchStartPos.current.y, 2)
          )
          if (tapDistance < 10) {
            onTapRef.current?.(touchStartPos.current)
          }
        }

        currentGesture.current = 'idle'
        setGestureState('idle')
        lastDirection.current = null
        touchStartPos.current = null
      }

      // Suppress unused-parameter warnings; we keep mx/my for now in case
      // consumers want to read them via a future refactor.
      void mx
      void my
    },
    {
      pointer: { touch: true },
      filterTaps: true,
      threshold: 8,
      swipe: {
        distance: swipeThreshold,
      },
    }
  ) as unknown as {
    onPointerDown?: (e: React.PointerEvent) => void
    onPointerMove?: (e: React.PointerEvent) => void
    onPointerUp?: (e: React.PointerEvent) => void
  }

  const pinchBind = usePinch(
    (state) => {
      const {
        offset: [scale],
        active,
        first,
        last,
      } = state

      if (first) {
        currentGesture.current = 'pinching'
        setGestureState('pinching')
        clearLongPressTimer()
      }

      if (active || last) {
        const pr = pinchScaleRangeRef.current
        const clampedScale = Math.min(Math.max(scale, pr.min), pr.max)
        onPinchRef.current?.(clampedScale, scale - 1)
      }

      if (last) {
        currentGesture.current = 'idle'
        setGestureState('idle')
      }
    },
    {
      pointer: { touch: true },
      scaleBounds: { min: pinchScaleRange.min, max: pinchScaleRange.max },
    }
  ) as unknown as {
    onPointerDown?: (e: React.PointerEvent) => void
    onPointerMove?: (e: React.PointerEvent) => void
    onPointerUp?: (e: React.PointerEvent) => void
    onWheel?: (e: React.WheelEvent) => void
  }

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const nativeEvent = e.nativeEvent as unknown as {
        touches?: Array<{ clientX: number; clientY: number }>
      }

      // 2-finger touch: only route to pinch, skip drag binding to avoid conflicts
      if (e.pointerType === 'touch' && nativeEvent.touches?.length === 2) {
        pinchBind.onPointerDown?.(e)
        return
      }

      // 1-finger touch: only route to drag
      if (e.pointerType === 'touch') {
        bind.onPointerDown?.(e)
        return
      }

      // Mouse or other pointer types: route to drag
      bind.onPointerDown?.(e)
    },
    [bind, pinchBind]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const nativeEvent = e.nativeEvent as unknown as {
        touches?: Array<{ clientX: number; clientY: number }>
      }

      if (e.pointerType === 'touch' && nativeEvent.touches?.length === 2) {
        pinchBind.onPointerMove?.(e)
      }

      bind.onPointerMove?.(e)
    },
    [bind, pinchBind]
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      clearLongPressTimer()

      const nativeEvent = e.nativeEvent as unknown as {
        changedTouches?: Array<{ clientX: number; clientY: number }>
        touches?: Array<{ clientX: number; clientY: number }>
      }

      if (e.pointerType === 'touch' && (!nativeEvent.touches || nativeEvent.touches.length === 0)) {
        pinchBind.onPointerUp?.(e)
      }

      bind.onPointerUp?.(e)

      setTimeout(() => {
        if (!mountedRef.current) return
        currentGesture.current = 'idle'
        setGestureState('idle')
        touchStartPos.current = null
      }, 50)
    },
    [bind, pinchBind, clearLongPressTimer]
  )

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      pinchBind.onWheel?.(e)
    },
    [pinchBind]
  )

  return useMemo(
    () => ({
      bind: {
        onPointerDown: handlePointerDown,
        onPointerMove: handlePointerMove,
        onPointerUp: handlePointerUp,
        onWheel: handleWheel,
      },
      gestureState,
    }),
    [handlePointerDown, handlePointerMove, handlePointerUp, handleWheel, gestureState]
  )
}
