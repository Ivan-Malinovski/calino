import { describe, it, expect } from 'vitest'
import { resources, NAMESPACES } from '@/locales'
import { SUPPORTED_LANGUAGES, FALLBACK_LANGUAGE } from '@/lib/languages'

/**
 * Catalog parity. This is the gate that keeps translations from silently
 * rotting: a key added to `en` and forgotten elsewhere, a dropped
 * `{{placeholder}}`, or a plural suffix a translator "tidied away" all show up
 * here rather than as a missing string in someone's UI.
 */

type Catalog = Record<string, unknown>

/** Flatten a nested catalog into dotted key paths. */
function flatten(obj: Catalog, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, flatten(value as Catalog, path))
    } else {
      out[path] = String(value)
    }
  }
  return out
}

/** Interpolation placeholders in a string, e.g. `{{count}}`, sorted. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)].map((m) => m[1]!).sort()
}

const translationLanguages = SUPPORTED_LANGUAGES.filter((l) => l !== FALLBACK_LANGUAGE)

describe('translation catalogs', () => {
  it('ships every namespace for every language', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(Object.keys(resources[lang]).sort()).toEqual([...NAMESPACES].sort())
    }
  })

  describe.each(translationLanguages)('%s', (lang) => {
    it.each([...NAMESPACES])('%s has the same keys as en', (ns) => {
      const source = flatten(resources[FALLBACK_LANGUAGE][ns] as Catalog)
      const target = flatten(resources[lang][ns] as Catalog)

      const missing = Object.keys(source).filter((k) => !(k in target))
      const extra = Object.keys(target).filter((k) => !(k in source))

      expect({ missing, extra }).toEqual({ missing: [], extra: [] })
    })

    it.each([...NAMESPACES])('%s preserves every interpolation placeholder', (ns) => {
      const source = flatten(resources[FALLBACK_LANGUAGE][ns] as Catalog)
      const target = flatten(resources[lang][ns] as Catalog)

      const mismatched = Object.entries(source)
        .filter(([key, value]) => {
          if (!(key in target)) return false
          return placeholders(value).join() !== placeholders(target[key]!).join()
        })
        .map(([key]) => key)

      expect(mismatched).toEqual([])
    })

    it.each([...NAMESPACES])('%s has no untranslated placeholder values', (ns) => {
      const target = flatten(resources[lang][ns] as Catalog)
      const empty = Object.entries(target)
        .filter(([, value]) => value.trim() === '')
        .map(([key]) => key)

      expect(empty).toEqual([])
    })
  })
})
