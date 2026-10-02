import { useCallback, useEffect, useLayoutEffect, useState } from 'react'

/** Breathing room kept between the popup and the edge of the window. */
const VIEWPORT_MARGIN = 8

/**
 * Keeps the popup inside the window. The caller can only offer the anchor's
 * position — how big the popup ends up is down to how many events the day has
 * — so the real placement is settled here, once the thing has been laid out.
 * A day late in the week opened off the right edge, and a day in the last row
 * of a six-week month ran off the bottom.
 *
 * Measured with `offsetWidth`/`offsetHeight` rather than `getBoundingClientRect`
 * because the popup animates in with a scale transform, which the rect reflects
 * and the layout size doesn't.
 */
export function usePlacement(
  popupRef: React.RefObject<HTMLDivElement | null>,
  position: { x: number; y: number }
): { left: number; top: number; maxHeight: number | undefined } {
  const [placement, setPlacement] = useState<{
    left: number
    top: number
    maxHeight: number | undefined
  }>({ left: position.x, top: position.y, maxHeight: undefined })

  const place = useCallback((): void => {
    const popup = popupRef.current
    if (!popup) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    // Cap first: a tall popup that the window can't fit gets to scroll its
    // list instead of hanging off the bottom, and the clamp below then works
    // against the height it will actually have.
    const maxHeight = vh - VIEWPORT_MARGIN * 2
    const height = Math.min(popup.offsetHeight, maxHeight)
    const width = popup.offsetWidth
    const clamp = (value: number, size: number, extent: number): number =>
      Math.max(VIEWPORT_MARGIN, Math.min(value, extent - size - VIEWPORT_MARGIN))

    const next = {
      left: clamp(position.x, width, vw),
      top: clamp(position.y, height, vh),
      maxHeight,
    }
    setPlacement((prev) =>
      prev.left === next.left && prev.top === next.top && prev.maxHeight === next.maxHeight
        ? prev
        : next
    )
  }, [popupRef, position.x, position.y])

  useLayoutEffect(place, [place])

  useEffect(() => {
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [place])

  return placement
}
