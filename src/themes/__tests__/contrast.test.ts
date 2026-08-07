/**
 * Contrast guardrails for the default theme.
 *
 * The values in built-in.css were chosen by measurement, not by eye, so a
 * well-meaning "let's brighten this up" is easy to make and impossible to spot
 * in review. These tests parse the real stylesheet and re-derive the ratios.
 *
 * The event-tint levels are the sharp edge here: raising --event-bg-mix puts
 * more colour behind an event's time and location, so each level has to carry
 * --event-ink-* values that keep that text legible on the *most saturated*
 * calendar a user might have. See issue #31.
 */
import { describe, it, expect } from 'vitest'
// ?raw rather than node:fs — the suite runs in jsdom with node polyfills.
import CSS from '../built-in.css?raw'

/** Google Calendar's default palette — what real events are actually coloured. */
const CALENDAR_COLORS = {
  Tomato: '#d50000',
  Flamingo: '#e67c73',
  Tangerine: '#f4511e',
  Banana: '#f6bf26',
  Sage: '#33b679',
  Basil: '#0b8043',
  Peacock: '#039be5',
  Blueberry: '#3f51b5',
  Lavender: '#7986cb',
  Grape: '#8e24aa',
  Graphite: '#616161',
}

const AA = 4.5
/** WCAG's floor for icons and other non-text UI. */
const AA_NON_TEXT = 3

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

function relativeLuminance(hex: string): number {
  const channel = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = parseHex(hex)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Mirrors CSS `color-mix(in srgb, fg <pct>, bg)`. */
function colorMix(fg: string, bg: string, pct: number): string {
  const [fr, fg_, fb] = parseHex(fg)
  const [br, bg_, bb] = parseHex(bg)
  const blend = (f: number, b: number) => Math.round(f * pct + b * (1 - pct))
  return (
    '#' +
    [blend(fr, br), blend(fg_, bg_), blend(fb, bb)]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  )
}

/**
 * Parses built-in.css into { normalised selector -> { property -> value } }.
 * Normalising (collapse whitespace, drop quotes) keeps the tests from breaking
 * on reformatting, which would otherwise look like a contrast regression.
 */
const BLOCKS: Record<string, Record<string, string>> = (() => {
  const out: Record<string, Record<string, string>> = {}
  const normalise = (sel: string) => sel.replace(/\s+/g, ' ').replace(/['"]/g, '').trim()
  // Comments first: they sit between rules and would otherwise be swallowed
  // into the following selector by the block regex.
  const stripped = String(CSS).replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls: Record<string, string> = {}
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) decls[d[1]] = d[2].trim()
    if (Object.keys(decls).length) Object.assign((out[normalise(m[1])] ??= {}), decls)
  }
  return out
})()

function token(selector: string, name: string): string {
  const block = BLOCKS[selector.replace(/\s+/g, ' ').replace(/['"]/g, '').trim()]
  if (!block) throw new Error(`selector not found: ${selector}`)
  const value = block[name]
  if (!value) throw new Error(`${name} not found in ${selector}`)
  return value
}

const LIGHT = ':root, [data-theme=light]'
const DARK = '[data-theme=dark]'

describe('default theme contrast', () => {
  describe('grey ramp', () => {
    it.each([
      ['--ink', AA],
      ['--ink-2', AA],
      ['--ink-3', AA],
    ])('light %s clears %s:1 on every surface', (name, threshold) => {
      const fg = token(LIGHT, name)
      for (const surface of ['--canvas', '--panel', '--side']) {
        expect(contrast(fg, token(LIGHT, surface))).toBeGreaterThanOrEqual(threshold)
      }
    })

    it('keeps ink-2 and ink-3 visually distinct', () => {
      const a = contrast(token(LIGHT, '--ink-2'), token(LIGHT, '--canvas'))
      const b = contrast(token(LIGHT, '--ink-3'), token(LIGHT, '--canvas'))
      expect(a - b).toBeGreaterThan(0.5)
    })
  })

  describe('accent', () => {
    it('--accent-strong is readable as text on light surfaces', () => {
      const fg = token(LIGHT, '--accent-strong')
      for (const surface of ['--canvas', '--panel', '--side']) {
        expect(contrast(fg, token(LIGHT, surface))).toBeGreaterThanOrEqual(AA)
      }
    })

    it.each([
      ['light', LIGHT],
      ['dark', DARK],
    ])('%s --accent-contrast is readable on an --accent-strong fill', (_mode, sel) => {
      // The "today" pill and every primary button rely on this pairing.
      expect(
        contrast(token(sel, '--accent-contrast'), token(sel, '--accent-strong'))
      ).toBeGreaterThanOrEqual(AA)
    })

    it('hover is a step further from the page, not toward it', () => {
      const canvas = token(LIGHT, '--canvas')
      expect(contrast(token(LIGHT, '--accent-hover'), canvas)).toBeGreaterThan(
        contrast(token(LIGHT, '--accent-strong'), canvas)
      )
    })
  })

  describe('status colours', () => {
    it.each([
      '--color-success',
      '--color-error',
      '--color-warning-text',
      '--color-error-muted',
      '--color-success-muted',
    ])('light %s is readable as text', (name) => {
      expect(contrast(token(LIGHT, name), token(LIGHT, '--canvas'))).toBeGreaterThanOrEqual(AA)
    })
  })

  describe('event tint levels', () => {
    const LEVELS = ['subtle', 'balanced', 'vivid'] as const

    // Each level is declared twice: once for light, once under [data-theme='dark'].
    const selectorFor = (level: string, mode: 'light' | 'dark') =>
      mode === 'dark'
        ? `:root[data-theme=dark][data-event-tint=${level}]`
        : `:root[data-event-tint=${level}]`

    it.each(LEVELS)('%s keeps event text legible on every calendar colour', (level) => {
      for (const mode of ['light', 'dark'] as const) {
        const sel = selectorFor(level, mode)
        const base = mode === 'dark' ? token(DARK, '--canvas') : token(LIGHT, '--canvas')
        const title = mode === 'dark' ? token(DARK, '--ink') : token(LIGHT, '--ink')
        const ink2 = token(sel, '--event-ink-2')
        const ink3 = token(sel, '--event-ink-3')

        for (const mixName of ['--event-bg-mix', '--event-bg-mix-hover']) {
          const pct = parseFloat(token(sel, mixName)) / 100

          for (const [name, color] of Object.entries(CALENDAR_COLORS)) {
            const cardBg = colorMix(color, base, pct)
            const where = `${level}/${mode}/${mixName}/${name}`

            expect(contrast(title, cardBg), `title ${where}`).toBeGreaterThanOrEqual(AA)
            expect(contrast(ink2, cardBg), `time+location ${where}`).toBeGreaterThanOrEqual(AA)
            // metaDot and the recurring/attachment glyphs — icons, not prose.
            expect(contrast(ink3, cardBg), `icons ${where}`).toBeGreaterThanOrEqual(AA_NON_TEXT)
          }
        }
      }
    })

    it('gets progressively more colourful', () => {
      for (const mode of ['light', 'dark'] as const) {
        const mixes = LEVELS.map((l) => parseFloat(token(selectorFor(l, mode), '--event-bg-mix')))
        expect(mixes).toEqual([...mixes].sort((a, b) => a - b))
        expect(new Set(mixes).size).toBe(mixes.length)
      }
    })

    it('matches the shipped default at the "subtle" level', () => {
      // subtle is the documented default, so it must reproduce the base tokens
      // exactly — otherwise picking it in Settings would change the look.
      for (const [sel, base] of [
        [selectorFor('subtle', 'light'), LIGHT],
        [selectorFor('subtle', 'dark'), DARK],
      ] as const) {
        expect(token(sel, '--event-bg-mix')).toBe(token(base, '--event-bg-mix'))
        expect(token(sel, '--event-bg-mix-hover')).toBe(token(base, '--event-bg-mix-hover'))
        expect(token(sel, '--event-ink-2')).toBe(token(base, '--event-ink-2'))
      }
    })
  })
})
