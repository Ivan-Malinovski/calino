import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createRef } from 'react'
import { useScrollInput } from '../useScrollInput'

describe('useScrollInput', () => {
  let addEventListenerSpy: ReturnType<typeof vi.fn>
  let removeEventListenerSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    addEventListenerSpy = vi.spyOn(document, 'addEventListener')
    removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** Helper to get the registered wheel handler */
  function getWheelHandler(): EventListener {
    const wheelCall = addEventListenerSpy.mock.calls.find((call) => call[0] === 'wheel')
    expect(wheelCall).toBeDefined()
    return wheelCall![1] as EventListener
  }

  /** Helper to create a wheel event targeting a specific element */
  function createWheelEvent(target: HTMLElement, deltaY: number): WheelEvent {
    const event = new WheelEvent('wheel', {
      deltaY,
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperty(event, 'target', { value: target })
    return event
  }

  // ------------------------------------------------------------------
  // Bug 57: React-controlled input compatibility
  // ------------------------------------------------------------------
  describe('Bug 57: DOM mutation bypasses React onChange', () => {
    it('dispatches "input" event (not "change") so React onChange fires', () => {
      const ref = createRef<HTMLInputElement>()
      const inputEl = document.createElement('input')
      inputEl.type = 'time'
      inputEl.value = '09:00'
      ;(ref as any).current = inputEl

      const eventSpy = vi.spyOn(inputEl, 'dispatchEvent')

      renderHook(() => useScrollInput([ref]))

      const handler = getWheelHandler()
      handler(createWheelEvent(inputEl, -150))

      // Should dispatch 'input' event, not 'change'
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'input',
          bubbles: true,
        })
      )
      // Verify it was NOT a 'change' event
      const changeCalls = eventSpy.mock.calls.filter((call: [Event]) => call[0].type === 'change')
      expect(changeCalls).toHaveLength(0)
    })

    it('updates the input value correctly (verifies native setter is used)', () => {
      const ref = createRef<HTMLInputElement>()
      const inputEl = document.createElement('input')
      inputEl.type = 'date'
      inputEl.value = '2025-06-01'
      ;(ref as any).current = inputEl

      renderHook(() => useScrollInput([ref]))

      const handler = getWheelHandler()
      // Negative deltaY = scroll up = next day
      handler(createWheelEvent(inputEl, -150))

      // The value should be updated via the native setter
      expect(inputEl.value).toBe('2025-06-02')
    })

    it('updates time value correctly via native setter', () => {
      const ref = createRef<HTMLInputElement>()
      const inputEl = document.createElement('input')
      inputEl.type = 'time'
      inputEl.value = '09:00'
      ;(ref as any).current = inputEl

      renderHook(() => useScrollInput([ref]))

      const handler = getWheelHandler()
      // Negative deltaY = scroll up = dir=1 = increment time by 15 min
      handler(createWheelEvent(inputEl, -150))

      expect(inputEl.value).toBe('09:15')
    })
  })

  // ------------------------------------------------------------------
  // Basic functionality
  // ------------------------------------------------------------------
  describe('basic functionality', () => {
    it('registers wheel event listener in capture phase on mount', () => {
      const ref = createRef<HTMLInputElement>()

      renderHook(() => useScrollInput([ref]))

      expect(addEventListenerSpy).toHaveBeenCalledWith('wheel', expect.any(Function), {
        passive: false,
        capture: true,
      })
    })

    it('removes wheel event listener on unmount', () => {
      const ref = createRef<HTMLInputElement>()

      const { unmount } = renderHook(() => useScrollInput([ref]))

      unmount()

      expect(removeEventListenerSpy).toHaveBeenCalledWith('wheel', expect.any(Function), {
        capture: true,
      })
    })

    it('increments date when scrolling up (negative deltaY)', () => {
      const ref = createRef<HTMLInputElement>()
      const inputEl = document.createElement('input')
      inputEl.type = 'date'
      inputEl.value = '2025-06-15'
      ;(ref as any).current = inputEl

      renderHook(() => useScrollInput([ref]))

      const handler = getWheelHandler()
      handler(createWheelEvent(inputEl, -150))

      expect(inputEl.value).toBe('2025-06-16')
    })

    it('decrements date when scrolling down (positive deltaY)', () => {
      const ref = createRef<HTMLInputElement>()
      const inputEl = document.createElement('input')
      inputEl.type = 'date'
      inputEl.value = '2025-06-15'
      ;(ref as any).current = inputEl

      renderHook(() => useScrollInput([ref]))

      const handler = getWheelHandler()
      handler(createWheelEvent(inputEl, 150))

      expect(inputEl.value).toBe('2025-06-14')
    })

    it('increments time by 15 minutes when scrolling up on time input', () => {
      const ref = createRef<HTMLInputElement>()
      const inputEl = document.createElement('input')
      inputEl.type = 'time'
      inputEl.value = '09:30'
      ;(ref as any).current = inputEl

      renderHook(() => useScrollInput([ref]))

      const handler = getWheelHandler()
      // Negative deltaY = scroll up = dir=1 = forward in time
      handler(createWheelEvent(inputEl, -150))

      expect(inputEl.value).toBe('09:45')
    })

    it('decrements time by 15 minutes when scrolling down on time input', () => {
      const ref = createRef<HTMLInputElement>()
      const inputEl = document.createElement('input')
      inputEl.type = 'time'
      inputEl.value = '09:30'
      ;(ref as any).current = inputEl

      renderHook(() => useScrollInput([ref]))

      const handler = getWheelHandler()
      // Positive deltaY = scroll down = dir=-1 = backward in time
      handler(createWheelEvent(inputEl, 150))

      expect(inputEl.value).toBe('09:15')
    })

    it('wraps time past midnight (scrolling down from 00:00)', () => {
      const ref = createRef<HTMLInputElement>()
      const inputEl = document.createElement('input')
      inputEl.type = 'time'
      inputEl.value = '00:00'
      ;(ref as any).current = inputEl

      renderHook(() => useScrollInput([ref]))

      const handler = getWheelHandler()
      handler(createWheelEvent(inputEl, 150))

      expect(inputEl.value).toBe('23:45')
    })

    it('wraps time past midnight (scrolling up from 23:45)', () => {
      const ref = createRef<HTMLInputElement>()
      const inputEl = document.createElement('input')
      inputEl.type = 'time'
      inputEl.value = '23:45'
      ;(ref as any).current = inputEl

      renderHook(() => useScrollInput([ref]))

      const handler = getWheelHandler()
      handler(createWheelEvent(inputEl, -150))

      expect(inputEl.value).toBe('00:00')
    })

    it('ignores wheel events on non-date/time inputs', () => {
      const ref = createRef<HTMLInputElement>()
      const inputEl = document.createElement('input')
      inputEl.type = 'text'
      inputEl.value = 'hello'
      ;(ref as any).current = inputEl

      renderHook(() => useScrollInput([ref]))

      const handler = getWheelHandler()
      handler(createWheelEvent(inputEl, -150))

      // Should not modify the input
      expect(inputEl.value).toBe('hello')
    })

    it('ignores wheel events on elements outside managed inputs', () => {
      const ref = createRef<HTMLInputElement>()
      const inputEl = document.createElement('input')
      inputEl.type = 'date'
      inputEl.value = '2025-06-01'
      ;(ref as any).current = inputEl

      const otherEl = document.createElement('div')

      renderHook(() => useScrollInput([ref]))

      const handler = getWheelHandler()
      handler(createWheelEvent(otherEl, -150))

      // input value should be unchanged
      expect(inputEl.value).toBe('2025-06-01')
    })

    it('prevents default and stops propagation for managed inputs', () => {
      const ref = createRef<HTMLInputElement>()
      const inputEl = document.createElement('input')
      inputEl.type = 'date'
      inputEl.value = '2025-06-01'
      ;(ref as any).current = inputEl

      renderHook(() => useScrollInput([ref]))

      const handler = getWheelHandler()
      const event = createWheelEvent(inputEl, -150)
      const preventSpy = vi.spyOn(event, 'preventDefault')
      const stopSpy = vi.spyOn(event, 'stopPropagation')

      handler(event)

      expect(preventSpy).toHaveBeenCalled()
      expect(stopSpy).toHaveBeenCalled()
    })

    it('handles zero deltaY by doing nothing', () => {
      const ref = createRef<HTMLInputElement>()
      const inputEl = document.createElement('input')
      inputEl.type = 'date'
      inputEl.value = '2025-06-01'
      ;(ref as any).current = inputEl

      renderHook(() => useScrollInput([ref]))

      const handler = getWheelHandler()
      handler(createWheelEvent(inputEl, 0))

      expect(inputEl.value).toBe('2025-06-01')
    })
  })
})
