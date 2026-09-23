/**
 * Build-time PostCSS plugin behind the Font Size setting (issue #184).
 *
 * Nearly every font size in the app is a hardcoded px value in a CSS module,
 * so scaling the root font size would do nothing. Instead each `font-size`
 * declaration (and the size inside a `font` shorthand) is wrapped as
 * `calc(<size> * var(--font-scale, 1))`, and ThemeProvider sets
 * `--font-scale` on the root element. Only text grows: layout px stays put, so
 * drag/resize maths that mix pointer coordinates with CSS px is unaffected,
 * which would not be true of CSS `zoom`.
 *
 * Values are left alone when they are relative to an already-scaled parent
 * (em, %, keywords like `inherit`, `smaller`), since wrapping those would apply
 * the scale twice.
 */

// Lives here rather than in @/types so vite.config.ts can import this file.
export type FontSize = 'small' | 'default' | 'large' | 'xlarge'

// Minimal structural types so the config does not depend on postcss's types.
interface Declaration {
  prop: string
  value: string
}

export const FONT_SCALE_VAR = '--font-scale'

const ABSOLUTE_SIZE = /(?:\d*\.)?\d+(?:px|rem)\b|\b(?:var|clamp|min|max|calc)\(/

export function scaleFontSizeValue(value: string): string {
  if (value.includes(FONT_SCALE_VAR) || !ABSOLUTE_SIZE.test(value)) return value
  return `calc(${value} * var(${FONT_SCALE_VAR}, 1))`
}

/** Scales the size token of a `font` shorthand, e.g. `500 12px/1.2 serif`. */
export function scaleFontShorthand(value: string): string {
  if (value.includes(FONT_SCALE_VAR)) return value
  return value.replace(
    /(^|\s)((?:\d*\.)?\d+(?:px|rem))(?=[\s/]|$)/,
    (_, lead: string, size: string) => `${lead}calc(${size} * var(${FONT_SCALE_VAR}, 1))`
  )
}

export function fontScalePostcss() {
  return {
    postcssPlugin: 'calino-font-scale',
    Declaration: {
      'font-size': (decl: Declaration) => {
        decl.value = scaleFontSizeValue(decl.value)
      },
      font: (decl: Declaration) => {
        decl.value = scaleFontShorthand(decl.value)
      },
    },
  }
}
fontScalePostcss.postcss = true as const

// Multiplier applied to every CSS font size via --font-scale (issue #184).
export const FONT_SIZE_OPTIONS: { value: FontSize; scale: number; labelKey: string }[] = [
  { value: 'small', scale: 0.9, labelKey: 'theme.fontSize.small' },
  { value: 'default', scale: 1, labelKey: 'theme.fontSize.default' },
  { value: 'large', scale: 1.15, labelKey: 'theme.fontSize.large' },
  { value: 'xlarge', scale: 1.3, labelKey: 'theme.fontSize.xlarge' },
]

export function fontScaleFor(fontSize: FontSize | undefined): number {
  return FONT_SIZE_OPTIONS.find((o) => o.value === fontSize)?.scale ?? 1
}
