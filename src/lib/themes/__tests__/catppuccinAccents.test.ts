import { describe, expect, it } from 'vitest'
import {
  CATPPUCCIN_ACCENTS,
  CATPPUCCIN_LATTE_ID,
  CATPPUCCIN_MOCHA_ID,
  catppuccinFlavorForThemeId,
  catppuccinPickerFlavor,
  resolveCatppuccinAccent,
} from '../catppuccinAccents'

describe('catppuccin accents', () => {
  it('maps a stored mocha hex onto Latte of the same name', () => {
    expect(resolveCatppuccinAccent('#cba6f7', 'latte')).toBe('#8839ef')
  })

  it('maps a stored latte hex onto Mocha of the same name', () => {
    expect(resolveCatppuccinAccent('#8839ef', 'mocha')).toBe('#cba6f7')
  })

  it('keeps the default mocha blue when the flavour is mocha', () => {
    expect(resolveCatppuccinAccent('#89b4fa', 'mocha')).toBe('#89b4fa')
  })

  it('translates the default mocha blue onto Latte blue', () => {
    expect(resolveCatppuccinAccent('#89b4fa', 'latte')).toBe('#1e66f5')
  })

  it('falls back to blue when the stored hex is unknown', () => {
    expect(resolveCatppuccinAccent('#ff00ff', 'latte')).toBe('#1e66f5')
    expect(resolveCatppuccinAccent('#ff00ff', 'mocha')).toBe('#89b4fa')
  })

  it('covers the seven picker accents in both flavours', () => {
    expect(CATPPUCCIN_ACCENTS).toHaveLength(7)
    for (const accent of CATPPUCCIN_ACCENTS) {
      expect(resolveCatppuccinAccent(accent.mocha, 'latte')).toBe(accent.latte)
      expect(resolveCatppuccinAccent(accent.latte, 'mocha')).toBe(accent.mocha)
    }
  })

  it('recognises both theme ids', () => {
    expect(catppuccinFlavorForThemeId(CATPPUCCIN_MOCHA_ID)).toBe('mocha')
    expect(catppuccinFlavorForThemeId(CATPPUCCIN_LATTE_ID)).toBe('latte')
    expect(catppuccinFlavorForThemeId('mist')).toBeNull()
  })

  it('shows the picker for a Catppuccin slot even when the other mode is default', () => {
    expect(
      catppuccinPickerFlavor({
        currentThemeId: 'built-in',
        lightTheme: CATPPUCCIN_LATTE_ID,
        darkTheme: 'built-in-dark',
      })
    ).toBe('latte')
    expect(
      catppuccinPickerFlavor({
        currentThemeId: 'built-in-dark',
        lightTheme: 'built-in',
        darkTheme: CATPPUCCIN_MOCHA_ID,
      })
    ).toBe('mocha')
  })
})
