import { describe, it, expect, afterEach } from 'vitest'
import { consumesVerticalScroll } from '../scrollChaining'

/**
 * Month view navigates months on wheel. In a short window the grid overflows
 * its scroller, and every scroll to reach the bottom row flipped the month out
 * from under the reader — this is the check that gives the content precedence.
 */

/** jsdom lays nothing out, so scroll geometry has to be declared. */
function makeScroller(
  overflowY: string,
  geometry: { scrollTop: number; clientHeight: number; scrollHeight: number }
): HTMLDivElement {
  const el = document.createElement('div')
  el.style.overflowY = overflowY
  Object.defineProperty(el, 'clientHeight', { value: geometry.clientHeight, configurable: true })
  Object.defineProperty(el, 'scrollHeight', { value: geometry.scrollHeight, configurable: true })
  el.scrollTop = geometry.scrollTop
  return el
}

const overflowing = { scrollTop: 0, clientHeight: 400, scrollHeight: 1000 }

afterEach(() => {
  document.body.innerHTML = ''
})

describe('consumesVerticalScroll', () => {
  it('claims a downward scroll while the content has further to go', () => {
    const el = makeScroller('auto', overflowing)
    expect(consumesVerticalScroll(el, 'down')).toBe(true)
  })

  it('releases a downward scroll once the content is at its end', () => {
    const el = makeScroller('auto', { scrollTop: 600, clientHeight: 400, scrollHeight: 1000 })
    expect(consumesVerticalScroll(el, 'down')).toBe(false)
  })

  it('releases an upward scroll at the top, while still claiming it below', () => {
    const atTop = makeScroller('auto', overflowing)
    expect(consumesVerticalScroll(atTop, 'up')).toBe(false)

    const scrolled = makeScroller('auto', { ...overflowing, scrollTop: 200 })
    expect(consumesVerticalScroll(scrolled, 'up')).toBe(true)
  })

  it('ignores an element whose content fits', () => {
    const el = makeScroller('auto', { scrollTop: 0, clientHeight: 400, scrollHeight: 400 })
    expect(consumesVerticalScroll(el, 'down')).toBe(false)
  })

  it('ignores sub-pixel overflow from fractional layout sizes', () => {
    const el = makeScroller('auto', { scrollTop: 0, clientHeight: 400, scrollHeight: 400.5 })
    expect(consumesVerticalScroll(el, 'down')).toBe(false)
  })

  it('ignores an overflowing element that is not scrollable', () => {
    const el = makeScroller('hidden', overflowing)
    expect(consumesVerticalScroll(el, 'down')).toBe(false)
  })

  it('finds a scrollable ancestor of the wheel target', () => {
    const scroller = makeScroller('auto', overflowing)
    const child = document.createElement('span')
    scroller.appendChild(child)
    document.body.appendChild(scroller)

    expect(consumesVerticalScroll(child, 'down')).toBe(true)
  })

  it('keeps looking past an inner scroller that is already at its end', () => {
    // An overflowing day cell scrolled to the bottom must not swallow the
    // gesture that the grid itself could still use.
    const outer = makeScroller('auto', overflowing)
    const inner = makeScroller('auto', { scrollTop: 100, clientHeight: 100, scrollHeight: 200 })
    outer.appendChild(inner)
    document.body.appendChild(outer)

    expect(consumesVerticalScroll(inner, 'down')).toBe(true)
  })

  it('returns false for a non-element target', () => {
    expect(consumesVerticalScroll(null, 'down')).toBe(false)
    expect(consumesVerticalScroll(window, 'down')).toBe(false)
  })
})
