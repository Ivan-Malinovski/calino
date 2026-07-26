import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWindowDimension } from '../useWindow'

/**
 * R4.4: rAF-throttle window resize.
 *
 * Browsers fire `resize` 60+ times per second while the user is dragging
 * a window edge. The previous unthrottled setValue caused re-render
 * storms for components subscribing to window dimensions. The fix
 * coalesces multiple `resize` events into a single setValue per
 * animation frame.
 *
 * We don't stub requestAnimationFrame globally (React 19's
 * testing-library uses its own internal scheduler that may not pick
 * up globalThis overrides) — instead we test the observable behavior:
 * the hook's effect registers exactly one resize handler, and that
 * handler can be invoked to trigger the value update.
 */
describe('useWindowDimension — rAF throttle (R4.4)', () => {
  let addSpy: ReturnType<typeof vi.spyOn>
  let removeSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    addSpy = vi.spyOn(window, 'addEventListener')
    removeSpy = vi.spyOn(window, 'removeEventListener')
  })

  afterEach(() => {
    addSpy.mockRestore()
    removeSpy.mockRestore()
  })

  it('registers a single resize listener (rAF-throttled path)', () => {
    renderHook(() => useWindowDimension('innerWidth'))
    const resizeListeners = addSpy.mock.calls.filter(([type]: [string]) => type === 'resize')
    expect(resizeListeners).toHaveLength(1)
  })

  it('removes its resize listener on unmount', () => {
    const { unmount } = renderHook(() => useWindowDimension('innerWidth'))
    const resizeListeners = removeSpy.mock.calls.filter(([type]: [string]) => type === 'resize')
    expect(resizeListeners).toHaveLength(0)
    unmount()
    const resizeListenersAfter = removeSpy.mock.calls.filter(
      ([type]: [string]) => type === 'resize'
    )
    expect(resizeListenersAfter).toHaveLength(1)
  })

  it('update path is wrapped in rAF (uses requestAnimationFrame under the hood)', () => {
    // Direct behavioural test: assert the function we register is a
    // closure that internally schedules a rAF. We do this by stubbing
    // rAF, dispatching resize, and checking the stub was called exactly
    // once per "frame" — not once per resize event.
    //
    // We work around React's internal scheduler by stubbing on `globalThis`
    // (the hook reads `requestAnimationFrame` from the global, not via
    // import). For multiple resize events in a row before rAF fires, the
    // second-and-later events should be no-ops.
    let rafCount = 0
    const realRAF = globalThis.requestAnimationFrame
    const realCAF = globalThis.cancelAnimationFrame
    let pendingCb: FrameRequestCallback | null = null
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      rafCount++
      pendingCb = cb
      return rafCount
    }
    globalThis.cancelAnimationFrame = vi.fn()
    try {
      renderHook(() => useWindowDimension('innerWidth'))
      // Dispatch 5 resizes synchronously; the throttle should collapse
      // them into a single rAF.
      act(() => {
        for (let i = 0; i < 5; i++) {
          window.dispatchEvent(new Event('resize'))
        }
      })
      expect(rafCount).toBe(1)
      // Flush the pending rAF, then dispatch another resize — a new rAF
      // should be scheduled.
      act(() => {
        if (pendingCb) pendingCb(performance.now())
        window.dispatchEvent(new Event('resize'))
      })
      expect(rafCount).toBe(2)
    } finally {
      globalThis.requestAnimationFrame = realRAF
      globalThis.cancelAnimationFrame = realCAF
    }
  })
})
