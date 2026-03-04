import { useCallback, useRef, useState } from 'react'
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
  const hasMoved = useRef(false)
  const currentGesture = useRef<
    'idle' | 'detecting' | 'swiping' | 'pinching' | 'dragging' | 'longPress'
  >('idle')

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  const bind = useDrag(
    (state) => {
      const {
        active,
        first,
        last,
        movement: [mx, my],
      } = state
      const event = state.event as unknown as { clientX: number; clientY: number }
      const clientX = event.clientX
      const clientY = event.clientY

      if (first) {
        currentGesture.current = 'detecting'
        setGestureState('detecting')
        hasMoved.current = false
        touchStartPos.current = { x: clientX, y: clientY }

        longPressTimer.current = setTimeout(() => {
          if (!hasMoved.current && currentGesture.current === 'detecting') {
            currentGesture.current = 'longPress'
            setGestureState('longPress')
            onLongPress?.({ x: clientX, y: clientY })
          }
        }, longPressDelay)
      }

      const movedDistance = Math.sqrt(mx * mx + my * my)

      if (active && movedDistance > 8 && !hasMoved.current) {
        clearLongPressTimer()
        hasMoved.current = true

        const isHorizontalSwipe = Math.abs(mx) > Math.abs(my)

        if (isHorizontalSwipe && Math.abs(mx) > swipeThreshold) {
          currentGesture.current = 'swiping'
          setGestureState('swiping')
          lastDirection.current = mx > 0 ? 'right' : 'left'
        } else if (!isHorizontalSwipe && Math.abs(my) > swipeThreshold) {
          currentGesture.current = 'swiping'
          setGestureState('swiping')
          lastDirection.current = my > 0 ? 'down' : 'up'
        } else {
          currentGesture.current = 'dragging'
          setGestureState('dragging')
          onDragStart?.()
        }
      }

      if (last) {
        clearLongPressTimer()

        if (currentGesture.current === 'swiping' && lastDirection.current) {
          onSwipe?.(lastDirection.current)
        } else if (currentGesture.current === 'dragging') {
          onDragEnd?.({ x: clientX, y: clientY })
        } else if (currentGesture.current === 'detecting' && touchStartPos.current) {
          const tapDistance = Math.sqrt(
            Math.pow(clientX - touchStartPos.current.x, 2) +
              Math.pow(clientY - touchStartPos.current.y, 2)
          )
          if (tapDistance < 10) {
            onTap?.(touchStartPos.current)
          }
        }

        currentGesture.current = 'idle'
        setGestureState('idle')
        lastDirection.current = null
        touchStartPos.current = null
      }
    },
    {
      pointer: { touch: true },
      filterTaps: false,
      threshold: 0,
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
        const clampedScale = Math.min(Math.max(scale, pinchScaleRange.min), pinchScaleRange.max)
        onPinch?.(clampedScale, scale - 1)
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

      if (e.pointerType === 'touch' && nativeEvent.touches?.length === 2) {
        pinchBind.onPointerDown?.(e)
      } else if (e.pointerType === 'touch') {
        touchStartPos.current = { x: e.clientX, y: e.clientY }
        longPressTimer.current = setTimeout(() => {
          if (!hasMoved.current && currentGesture.current === 'detecting') {
            currentGesture.current = 'longPress'
            setGestureState('longPress')
            onLongPress?.({ x: e.clientX, y: e.clientY })
          }
        }, longPressDelay)
      }
      bind.onPointerDown?.(e)
    },
    [bind, pinchBind, longPressDelay, onLongPress, clearLongPressTimer]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const nativeEvent = e.nativeEvent as unknown as {
        touches?: Array<{ clientX: number; clientY: number }>
      }

      if (e.pointerType === 'touch' && nativeEvent.touches?.length === 2) {
        pinchBind.onPointerMove?.(e)
      }

      if (touchStartPos.current) {
        const dx = Math.abs(e.clientX - touchStartPos.current.x)
        const dy = Math.abs(e.clientY - touchStartPos.current.y)
        if (dx > 8 || dy > 8) {
          hasMoved.current = true
          clearLongPressTimer()
        }
      }

      bind.onPointerMove?.(e)
    },
    [bind, pinchBind, clearLongPressTimer]
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      clearLongPressTimer()

      const nativeEvent = e.nativeEvent as unknown as {
        changedTouches?: Array<{ clientX: number; clientY: number }>
        touches?: Array<{ clientX: number; clientY: number }>
      }

      if (e.pointerType === 'touch' && nativeEvent.changedTouches?.length === 1) {
        if (!hasMoved.current && touchStartPos.current && currentGesture.current !== 'longPress') {
          const touchEndX = e.clientX
          const touchEndY = e.clientY
          const distance = Math.sqrt(
            Math.pow(touchEndX - touchStartPos.current.x, 2) +
              Math.pow(touchEndY - touchStartPos.current.y, 2)
          )
          if (distance < 10) {
            onTap?.(touchStartPos.current)
          }
        }
      }

      if (e.pointerType === 'touch' && (!nativeEvent.touches || nativeEvent.touches.length === 0)) {
        pinchBind.onPointerUp?.(e)
      }

      bind.onPointerUp?.(e)

      setTimeout(() => {
        currentGesture.current = 'idle'
        setGestureState('idle')
        touchStartPos.current = null
        hasMoved.current = false
      }, 50)
    },
    [bind, pinchBind, clearLongPressTimer, onTap]
  )

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      pinchBind.onWheel?.(e)
    },
    [pinchBind]
  )

  return {
    bind: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onWheel: handleWheel,
    },
    gestureState,
  }
}
