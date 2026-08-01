import { describe, it, expect } from 'vitest'
import { shouldPageOnSwipe } from '../swipePaging'

/** A strip wider than the screen, scrolled to `scrollLeft`. */
const scrolled = (scrollLeft: number) => ({ scrollLeft, scrollWidth: 809, clientWidth: 378 })
const maxScroll = 809 - 378

describe('shouldPageOnSwipe', () => {
  it('does not page while the day strip has room to scroll', () => {
    // The reported bug: a quick flick anywhere mid-week changed the week.
    expect(shouldPageOnSwipe('next', scrolled(0))).toBe(false)
    expect(shouldPageOnSwipe('next', scrolled(maxScroll / 2))).toBe(false)
    expect(shouldPageOnSwipe('prev', scrolled(maxScroll))).toBe(false)
    expect(shouldPageOnSwipe('prev', scrolled(maxScroll / 2))).toBe(false)
  })

  it('pages once the strip is at the edge the swipe is heading towards', () => {
    expect(shouldPageOnSwipe('next', scrolled(maxScroll))).toBe(true)
    expect(shouldPageOnSwipe('prev', scrolled(0))).toBe(true)
  })

  it('treats a fractional scroll position as being at the edge', () => {
    // Scroll offsets are not integers, so an exact comparison would leave the
    // last swipe of the week doing nothing at all.
    expect(shouldPageOnSwipe('next', scrolled(maxScroll - 0.6))).toBe(true)
    expect(shouldPageOnSwipe('prev', scrolled(0.4))).toBe(true)
  })

  it('pages immediately when there is nothing to scroll', () => {
    // Desktop, and any day count narrow enough to fit — there is no scroller
    // to give precedence to, so the old behaviour must be kept intact.
    const fits = { scrollLeft: 0, scrollWidth: 378, clientWidth: 378 }
    expect(shouldPageOnSwipe('next', fits)).toBe(true)
    expect(shouldPageOnSwipe('prev', fits)).toBe(true)
  })

  it('pages when there is no scroller at all', () => {
    expect(shouldPageOnSwipe('next', null)).toBe(true)
    expect(shouldPageOnSwipe('prev', null)).toBe(true)
  })
})
