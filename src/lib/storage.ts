import { toast as sonnerToast } from 'sonner'
import i18n from '@/lib/i18n'

// Calino state lives under two prefixes depending on age of the key:
// modern zustand-persisted slices use `calino-` (hyphen), but the CalDAV
// account storage (predates the unified prefix) uses `calino_` (underscore).
// `clear()` must remove BOTH so the user can actually wipe Calino data.
const APP_KEY_PREFIXES = ['calino-', 'calino_'] as const

function getLocalStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function handleStorageError(key: string, e: unknown): void {
  if (e instanceof DOMException || e instanceof Error) {
    const message =
      e instanceof DOMException && e.name === 'QuotaExceededError'
        ? i18n.t('errors:toast.storage.full')
        : i18n.t('errors:toast.storage.error')
    console.error(`Storage error for key "${key}":`, e)
    sonnerToast.error(message)
  } else {
    console.error(`Storage error for key "${key}":`, e)
  }
}

/**
 * Storage facade that mirrors the Web Storage `Storage` interface so it
 * can be passed directly to zustand's `createJSONStorage(() => safeLocalStorage)`.
 * Uses raw localStorage for synchronous access (required by zustand).
 */
export const safeLocalStorage: Storage = {
  getItem(key: string): string | null {
    const ls = getLocalStorage()
    if (!ls) return null
    try {
      return ls.getItem(key)
    } catch {
      return null
    }
  },

  setItem(key: string, value: string): void {
    const ls = getLocalStorage()
    if (!ls) return
    try {
      ls.setItem(key, value)
    } catch (e) {
      handleStorageError(key, e)
    }
  },

  removeItem(key: string): void {
    const ls = getLocalStorage()
    if (!ls) return
    try {
      ls.removeItem(key)
    } catch {
      /* ignore */
    }
  },

  clear(): void {
    const ls = getLocalStorage()
    if (!ls) return
    try {
      // Only clear keys belonging to this app, not all localStorage
      const keysToRemove: string[] = []
      for (let i = 0; i < ls.length; i++) {
        const key = ls.key(i)
        if (key && APP_KEY_PREFIXES.some((p) => key.startsWith(p))) {
          keysToRemove.push(key)
        }
      }
      keysToRemove.forEach((key) => ls.removeItem(key))
    } catch {
      /* ignore */
    }
  },

  get length(): number {
    const ls = getLocalStorage()
    if (!ls) return 0
    try {
      return ls.length
    } catch {
      return 0
    }
  },

  key(index: number): string | null {
    const ls = getLocalStorage()
    if (!ls) return null
    try {
      return ls.key(index)
    } catch {
      return null
    }
  },
}
