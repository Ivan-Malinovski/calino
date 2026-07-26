import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useDateChangeMotion } from '../useDateChangeMotion'

vi.mock('../useIsMobile', () => ({ useIsMobile: vi.fn(() => true) }))
vi.mock('../useReducedMotion', () => ({ useReducedMotion: vi.fn(() => false) }))

const { useIsMobile } = await import('../useIsMobile')
const { useReducedMotion } = await import('../useReducedMotion')

describe('useDateChangeMotion', () => {
  beforeEach(() => {
    vi.mocked(useIsMobile).mockReturnValue(true)
    vi.mocked(useReducedMotion).mockReturnValue(false)
  })

  it('does not animate on mount — a mount is not a date change', () => {
    // The enclosing AnimatePresence doesn't set initial={false}, so a truthy
    // `initial` here fires the slide every time the view mounts (i.e. on every
    // switch into month/agenda), on top of the view's own first render.
    const { result } = renderHook(() => useDateChangeMotion('2026-07'))
    expect(result.current.initial).toBe(false)
  })

  it('animates once the marker actually changes', () => {
    const { result, rerender } = renderHook(({ m }) => useDateChangeMotion(m), {
      initialProps: { m: '2026-07' },
    })
    expect(result.current.initial).toBe(false)

    rerender({ m: '2026-08' })
    expect(result.current.initial).toEqual({ opacity: 0, x: 28 })
  })

  it('leans the other way when moving backwards', () => {
    const { result, rerender } = renderHook(({ m }) => useDateChangeMotion(m), {
      initialProps: { m: '2026-07' },
    })
    rerender({ m: '2026-06' })
    expect(result.current.initial).toEqual({ opacity: 0, x: -28 })
  })

  it('keeps animating on subsequent changes', () => {
    const { result, rerender } = renderHook(({ m }) => useDateChangeMotion(m), {
      initialProps: { m: '2026-07' },
    })
    rerender({ m: '2026-08' })
    rerender({ m: '2026-09' })
    expect(result.current.initial).toEqual({ opacity: 0, x: 28 })
  })

  it('stays off entirely under reduced motion', () => {
    vi.mocked(useReducedMotion).mockReturnValue(true)
    const { result, rerender } = renderHook(({ m }) => useDateChangeMotion(m), {
      initialProps: { m: '2026-07' },
    })
    rerender({ m: '2026-08' })
    expect(result.current.initial).toBe(false)
    expect(result.current.transition.duration).toBe(0)
  })
})
