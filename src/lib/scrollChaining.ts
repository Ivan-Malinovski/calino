/**
 * Whether some element under the pointer can still scroll `direction` — i.e. a
 * wheel gesture belongs to the content rather than to whatever the view does
 * with a free scroll (the month grid navigates months with it).
 *
 * Walks up from the wheel's target so an overflowing day cell counts too, not
 * just a view's own scroller; falls back to the document, which scrolls the
 * page when the app itself is taller than the viewport.
 */
export function consumesVerticalScroll(
  target: EventTarget | null,
  direction: 'up' | 'down'
): boolean {
  const canScroll = (el: Element): boolean => {
    // 1px of slack: fractional layout sizes leave scrollHeight a hair above
    // clientHeight on elements that aren't really scrollable.
    if (el.scrollHeight <= el.clientHeight + 1) return false
    return direction === 'down'
      ? el.scrollTop + el.clientHeight < el.scrollHeight - 1
      : el.scrollTop > 0
  }

  let node = target instanceof Element ? target : null
  while (node) {
    const overflowY = getComputedStyle(node).overflowY
    if (
      (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
      canScroll(node)
    ) {
      return true
    }
    node = node.parentElement
  }

  const page = document.scrollingElement
  return page ? canScroll(page) : false
}
