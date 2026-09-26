import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  normalizeLanguage,
  isSupportedLanguage,
  getBrowserLanguage,
  LANGUAGE_OPTIONS,
  SUPPORTED_LANGUAGES,
} from '@/lib/languages'

function stubNavigatorLanguages(languages: string[]): void {
  vi.stubGlobal('navigator', {
    languages,
    language: languages[0] ?? 'en',
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('normalizeLanguage', () => {
  it('accepts a language we ship', () => {
    expect(normalizeLanguage('de')).toBe('de')
    expect(normalizeLanguage('es')).toBe('es')
    expect(normalizeLanguage('fr')).toBe('fr')
    expect(normalizeLanguage('it')).toBe('it')
    expect(normalizeLanguage('nl')).toBe('nl')
  })

  it('reduces a regional tag to its primary subtag', () => {
    expect(normalizeLanguage('de-AT')).toBe('de')
    expect(normalizeLanguage('en-GB')).toBe('en')
  })

  it('is case-insensitive', () => {
    expect(normalizeLanguage('DA-DK')).toBe('da')
  })

  it('returns null for a language we do not ship', () => {
    expect(normalizeLanguage('ja')).toBeNull()
    expect(normalizeLanguage('')).toBeNull()
    expect(normalizeLanguage(null)).toBeNull()
  })
})

describe('isSupportedLanguage', () => {
  it('rejects non-strings and unknown codes', () => {
    expect(isSupportedLanguage('en')).toBe(true)
    expect(isSupportedLanguage('ja')).toBe(false)
    expect(isSupportedLanguage(42)).toBe(false)
  })
})

describe('getBrowserLanguage', () => {
  it('picks the first preferred language we ship', () => {
    stubNavigatorLanguages(['es-ES', 'fr-FR', 'nl-NL', 'de-DE', 'en-US'])
    expect(getBrowserLanguage()).toBe('es')
  })

  it('falls back to English when we ship none of them', () => {
    stubNavigatorLanguages(['ja-JP', 'pt-BR'])
    expect(getBrowserLanguage()).toBe('en')
  })

  it('falls back to English when navigator is unavailable', () => {
    vi.stubGlobal('navigator', undefined)
    expect(getBrowserLanguage()).toBe('en')
  })
})

describe('LANGUAGE_OPTIONS', () => {
  it('covers every supported language exactly once', () => {
    expect(LANGUAGE_OPTIONS.map((o) => o.value).sort()).toEqual([...SUPPORTED_LANGUAGES].sort())
  })

  it('names each language in that language', () => {
    expect(LANGUAGE_OPTIONS).toEqual([
      { value: 'en', label: 'English' },
      { value: 'da', label: 'Dansk' },
      { value: 'de', label: 'Deutsch' },
      { value: 'es', label: 'Español' },
      { value: 'fr', label: 'Français' },
      { value: 'it', label: 'Italiano' },
      { value: 'nl', label: 'Nederlands' },
    ])
  })
})
