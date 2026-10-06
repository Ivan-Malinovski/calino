import { describe, it, expect } from 'vitest'
import { resources } from '@/locales'

/**
 * Keys named in source must exist in the English catalog. A missing key does
 * not throw — i18next renders the key itself, so a toast read
 * "palette.createdEvent" instead of "Created event: …" until a user noticed.
 * The parity test above only compares other languages against English, so it
 * cannot catch a key that is absent from English too.
 */

const sources = import.meta.glob(
  ['/src/**/*.{ts,tsx}', '!/src/**/__tests__/**', '!/src/locales/**'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  }
) as Record<string, string>

function hasKey(namespace: string, key: string): boolean {
  let node: unknown = (resources.en as Record<string, unknown>)[namespace]
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return false
    const record = node as Record<string, unknown>
    // A plural key lives under `key_one` / `key_other`; a context key under `key_<context>`.
    if (part in record) {
      node = record[part]
    } else if (Object.keys(record).some((k) => k.startsWith(`${part}_`))) {
      return true
    } else {
      return false
    }
  }
  return true
}

describe('translation keys used in source', () => {
  it('resolves every literal `i18n.t("ns:key")` to an English string', () => {
    const missing: string[] = []
    for (const [file, text] of Object.entries(sources)) {
      for (const match of text.matchAll(/\bi18n\.t\(\s*['"]([a-z]+):([\w.]+)['"]/g)) {
        if (!hasKey(match[1]!, match[2]!)) missing.push(`${file}: ${match[1]}:${match[2]}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('resolves every command palette `t("key")` to an English string', () => {
    const file = '/src/features/commandPalette/hooks/useCommandPalette.ts'
    const missing: string[] = []
    for (const match of sources[file]!.matchAll(/(?<![\w.])t\(\s*['"]([\w.]+)['"]/g)) {
      if (!hasKey('commands', match[1]!)) missing.push(match[1]!)
    }
    expect(missing).toEqual([])
  })

  it('never passes a literal string to a toast', () => {
    const literal: string[] = []
    for (const [file, text] of Object.entries(sources)) {
      for (const match of text.matchAll(
        /\b(?:showToast|toast\.(?:error|success|info|warning))\(\s*['"`]/g
      )) {
        const line = text.slice(0, match.index).split('\n').length
        literal.push(`${file}:${line}`)
      }
    }
    expect(literal).toEqual([])
  })
})
