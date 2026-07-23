import { useEffect, useState } from 'react'

const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'tel',
  'url',
  'password',
  'number',
])

function isTextInput(el: Element | null): boolean {
  if (!el) return false
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type)
  return el instanceof HTMLElement && el.isContentEditable
}

/**
 * Tracks whether a text-entry element is currently focused, so mobile-only
 * chrome (the floating nav pill) can hide itself instead of being shoved
 * around by the on-screen keyboard's viewport resize — it has nothing useful
 * to do while the user is typing.
 */
export function useTextInputFocused(): boolean {
  const [focused, setFocused] = useState(() => isTextInput(document.activeElement))

  useEffect(() => {
    const handleFocusIn = (e: FocusEvent): void => setFocused(isTextInput(e.target as Element))
    const handleFocusOut = (): void => setFocused(false)
    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('focusout', handleFocusOut)
    return () => {
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('focusout', handleFocusOut)
    }
  }, [])

  return focused
}
