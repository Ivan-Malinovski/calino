/** Slack when deciding whether the day strip is scrolled to an edge. Scroll
 *  positions are fractional, so an exact comparison never quite lands. */
const SCROLL_EDGE_TOLERANCE_PX = 2

/** The part of the scroller this rule actually depends on. */
export interface SwipeScrollMetrics {
  scrollLeft: number
  scrollWidth: number
  clientWidth: number
}

/**
 * Whether a horizontal swipe should change the week, or belongs to the day
 * strip underneath it.
 *
 * On mobile the day columns scroll horizontally under the very same gesture,
 * so any flick meant to bring the next day into view also paged the week —
 * which is why a quick swipe changed weeks far too easily. Paging only from
 * the edge the swipe is heading towards gives the scroller first claim, the
 * way a native paging carousel behaves.
 *
 * With nothing to scroll (few enough day columns, or a wide enough screen)
 * every swipe pages immediately, so desktop and the 3-day view are unaffected.
 */
export function shouldPageOnSwipe(
  direction: 'left' | 'right',
  scroller: SwipeScrollMetrics | null
): boolean {
  if (!scroller) return true
  const maxScroll = scroller.scrollWidth - scroller.clientWidth
  if (maxScroll <= SCROLL_EDGE_TOLERANCE_PX) return true
  return direction === 'left'
    ? scroller.scrollLeft >= maxScroll - SCROLL_EDGE_TOLERANCE_PX
    : scroller.scrollLeft <= SCROLL_EDGE_TOLERANCE_PX
}
