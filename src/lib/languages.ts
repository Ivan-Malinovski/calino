import type { Language } from '@/types'

/**
 * UI languages Calino ships catalogs for. `en` is the source of truth and the
 * fallback for any key a translation is missing.
 */
export const SUPPORTED_LANGUAGES = ['en', 'da', 'de'] as const

export const FALLBACK_LANGUAGE: Language = 'en'

/**
 * Language names are written in the language itself (endonyms) and are never
 * translated — someone who has landed in a language they can't read needs to
 * find their own in the list.
 */
export const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'da', label: 'Dansk' },
  { value: 'de', label: 'Deutsch' },
]

export function isSupportedLanguage(value: unknown): value is Language {
  return (
    typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  )
}

/**
 * Reduce a BCP-47 tag to a language we ship, or `null` when we ship none.
 * Matches on the primary subtag, so `de-AT` and `de-CH` both resolve to `de`.
 */
export function normalizeLanguage(tag: string | undefined | null): Language | null {
  if (!tag) return null
  const primary = tag.toLowerCase().split('-')[0]
  return isSupportedLanguage(primary) ? primary : null
}

/**
 * The language to start in when the user has never chosen one: the first
 * browser-preferred language we ship, else English. `navigator.languages` is
 * ordered by the user's own preference, so it beats the single
 * `navigator.language`.
 */
export function getBrowserLanguage(): Language {
  try {
    const candidates =
      typeof navigator !== 'undefined'
        ? [...(navigator.languages ?? []), navigator.language]
        : []
    for (const candidate of candidates) {
      const match = normalizeLanguage(candidate)
      if (match) return match
    }
  } catch {
    // Fall through to the default.
  }
  return FALLBACK_LANGUAGE
}
