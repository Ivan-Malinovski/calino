import { describe, it, expect } from 'vitest'
import { extractThemeName } from '../loader'

describe('theme loader', () => {
  describe('extractThemeName', () => {
    it('extracts theme name from CSS comment with light mode', () => {
      const css = `/* Theme: My Custom Theme | light */
:root { --color-bg: #fff; }`
      const result = extractThemeName(css, 'my-theme.css')

      expect(result.name).toBe('My Custom Theme')
      expect(result.isDark).toBe(false)
    })

    it('extracts theme name from CSS comment with dark mode', () => {
      const css = `/* Theme: OLED Dark | dark */
:root { --color-bg: #000; }`
      const result = extractThemeName(css, 'oled.css')

      expect(result.name).toBe('OLED Dark')
      expect(result.isDark).toBe(true)
    })

    it('extracts theme name from CSS comment without mode', () => {
      const css = `/* Theme: Default Theme */
:root { --color-bg: #fff; }`
      const result = extractThemeName(css, 'default.css')

      expect(result.name).toBe('Default Theme')
      expect(result.isDark).toBe(false)
    })

    it('generates name from filename when no comment', () => {
      const css = `:root { --color-bg: #fff; }`
      const result = extractThemeName(css, 'warm-light.css')

      expect(result.name).toBe('Warm Light')
      expect(result.isDark).toBe(false)
    })

    it('handles kebab-case filenames', () => {
      const css = `:root { --color-bg: #fff; }`
      const result = extractThemeName(css, 'my-custom-theme.css')

      expect(result.name).toBe('My Custom Theme')
    })

    it('handles snake_case filenames', () => {
      const css = `:root { --color-bg: #fff; }`
      const result = extractThemeName(css, 'dark_blue_theme.css')

      expect(result.name).toBe('Dark Blue Theme')
    })

    it('handles case-insensitive mode', () => {
      const css = `/* Theme: Dark | DARK */
:root { --color-bg: #000; }`
      const result = extractThemeName(css, 'dark.css')

      expect(result.isDark).toBe(true)
    })
  })
})
