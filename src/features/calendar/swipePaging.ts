/** Slack when deciding whether a strip is scrolled to an edge. Scroll
 *  positions are fractional, so an exact comparison never quite lands. */
const SCROLL_EDGE_TOLERANCE_PX = 2

/**
 * Marks a horizontally-scrolling strip that gets first claim on a sideways
 * swipe, ahead of App's swipe-to-page-the-date gesture.
 */
export const SWIPE_SCROLLER_ATTR = 'data-swipe-scroller'

/** The part of the scroller this rule actually depends on. */
export interface SwipeScrollMetrics {
  scrollLeft: number
  scrollWidth: number
  clientWidth: number
}

/**
 * Whether a horizontal swipe should page the date, or belongs to a scrolling
 * strip inside the view.
 *
 * The mobile week view scrolls its day columns horizontally, directly under
 * the pan that pages the date — so any flick meant to bring the next day into
 * view also jumped a whole week. Paging only from the edge the swipe is
 * heading towards gives the scroller precedence, the way a native paging
 * carousel behaves.
 *
 * With nothing to scroll (few enough day columns, a wide screen, or a view
 * with no strip at all) every swipe pages immediately, so nothing else
 * changes.
 */
export function shouldPageOnSwipe(
  direction: 'next' | 'prev',
  scroller: SwipeScrollMetrics | null
): boolean {
  if (!scroller) return true
  const maxScroll = scroller.scrollWidth - scroller.clientWidth
  if (maxScroll <= SCROLL_EDGE_TOLERANCE_PX) return true
  return direction === 'next'
    ? scroller.scrollLeft >= maxScroll - SCROLL_EDGE_TOLERANCE_PX
    : scroller.scrollLeft <= SCROLL_EDGE_TOLERANCE_PX
}
