/**
 * Shared Catppuccin accent names.
 *
 * Mocha and Latte use the same seven accents; only the hex changes with the
 * flavour. Settings still store `mochaAccent` as a hex (existing mocha
 * installs), and the resolver maps that hex to the active flavour.
 *
 * The inline pre-React paint in index.html duplicates these lists — keep them
 * in lockstep.
 */

export const CATPPUCCIN_MOCHA_ID = 'catppuccin-mocha'
export const CATPPUCCIN_LATTE_ID = 'catppuccin-latte'

export type CatppuccinFlavor = 'mocha' | 'latte'

export const CATPPUCCIN_ACCENTS = [
  { labelKey: 'theme.mochaAccent.blue', mocha: '#89b4fa', latte: '#1e66f5' },
  { labelKey: 'theme.mochaAccent.lavender', mocha: '#b4befe', latte: '#7287fd' },
  { labelKey: 'theme.mochaAccent.mauve', mocha: '#cba6f7', latte: '#8839ef' },
  { labelKey: 'theme.mochaAccent.pink', mocha: '#f5c2e7', latte: '#ea76cb' },
  { labelKey: 'theme.mochaAccent.teal', mocha: '#94e2d5', latte: '#179299' },
  { labelKey: 'theme.mochaAccent.green', mocha: '#a6e3a1', latte: '#40a02b' },
  { labelKey: 'theme.mochaAccent.peach', mocha: '#fab387', latte: '#fe640b' },
] as const

const DEFAULT_INDEX = 0

export function catppuccinFlavorForThemeId(themeId: string): CatppuccinFlavor | null {
  if (themeId === CATPPUCCIN_MOCHA_ID) return 'mocha'
  if (themeId === CATPPUCCIN_LATTE_ID) return 'latte'
  return null
}

function accentIndex(storedHex: string): number {
  const i = CATPPUCCIN_ACCENTS.findIndex(
    (accent) => accent.mocha === storedHex || accent.latte === storedHex
  )
  return i < 0 ? DEFAULT_INDEX : i
}

export function resolveCatppuccinAccent(storedHex: string, flavor: CatppuccinFlavor): string {
  return CATPPUCCIN_ACCENTS[accentIndex(storedHex)][flavor]
}

export function catppuccinPickerFlavor(args: {
  currentThemeId: string
  lightTheme: string
  darkTheme: string
}): CatppuccinFlavor | null {
  return (
    catppuccinFlavorForThemeId(args.currentThemeId) ??
    (args.lightTheme === CATPPUCCIN_LATTE_ID
      ? 'latte'
      : args.darkTheme === CATPPUCCIN_MOCHA_ID
        ? 'mocha'
        : null)
  )
}
