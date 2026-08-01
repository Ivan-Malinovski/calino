import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'

/**
 * Keeps the focused field visible when the Android on-screen keyboard opens.
 *
 * `KeyboardResize.Native` (see capacitor.config.ts) shrinks the WebView, which
 * is enough for bottom-anchored sheets — but a field partway down a scrollable
 * form still ends up under the fold, because resizing the viewport doesn't move
 * the scroll position. So we also scroll the active element into view.
 *
 * Exposes the keyboard height as `--keyboard-height` for anything that needs to
 * lay out against it; it's `0px` whenever the keyboard is closed, and on web.
 */
export function useNativeKeyboard(): void {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    const root = document.documentElement
    root.style.setProperty('--keyboard-height', '0px')

    let cancelled = false
    const showPromise = Keyboard.addListener('keyboardDidShow', (info) => {
      root.style.setProperty('--keyboard-height', `${info.keyboardHeight}px`)

      const active = document.activeElement
      if (active instanceof HTMLElement && active.matches('input, textarea, select')) {
        // `nearest` so a field already on screen doesn't jump.
        active.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    })
    const hidePromise = Keyboard.addListener('keyboardDidHide', () => {
      root.style.setProperty('--keyboard-height', '0px')
    })

    return () => {
      cancelled = true
      // The handles resolve after the effect may already have torn down, so
      // remove on resolution rather than assigning into a variable we've left.
      void showPromise.then((h) => {
        if (cancelled) void h.remove()
      })
      void hidePromise.then((h) => {
        if (cancelled) void h.remove()
      })
      root.style.removeProperty('--keyboard-height')
    }
  }, [])
}
