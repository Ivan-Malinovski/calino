import { useEffect, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Traps keyboard focus inside `containerRef` while `active` is true, and
 * restores focus to the previously-focused element on deactivation.
 *
 * Handles Tab / Shift+Tab wrapping at the focusable boundaries. Safe to use in
 * dialogs rendered via portals.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return
    const container = containerRef.current
    if (!container) return

    const previouslyFocused = document.activeElement as HTMLElement | null

    const getFocusable = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
        if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return false
        // A collapsed disclosure may keep its contents mounted for a height
        // transition. Its descendants are still in the selector above, so
        // inspect ancestors as well as the element itself. This keeps focus
        // from entering controls that are visually and semantically hidden.
        return !el.closest('[aria-hidden="true"], [inert]')
      })

    // If focus isn't already inside the container, move it in.
    if (!container.contains(document.activeElement)) {
      const focusable = getFocusable()
      const first = focusable[0] ?? container
      first.focus()
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const focusable = getFocusable()
      if (focusable.length === 0) {
        e.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const activeEl = document.activeElement as HTMLElement | null

      if (e.shiftKey) {
        if (activeEl === first || !container.contains(activeEl)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (activeEl === last || !container.contains(activeEl)) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus()
      }
    }
  }, [active, containerRef])
}
