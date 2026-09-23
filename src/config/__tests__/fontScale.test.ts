import { describe, it, expect } from 'vitest'
import { scaleFontSizeValue, scaleFontShorthand } from '../fontScale'

describe('scaleFontSizeValue', () => {
  it('wraps absolute sizes in the font-scale multiplier', () => {
    expect(scaleFontSizeValue('13px')).toBe('calc(13px * var(--font-scale, 1))')
    expect(scaleFontSizeValue('1.5rem')).toBe('calc(1.5rem * var(--font-scale, 1))')
    expect(scaleFontSizeValue('var(--text-xs)')).toBe('calc(var(--text-xs) * var(--font-scale, 1))')
    expect(scaleFontSizeValue('clamp(10px, 3.2cqw, 14px)')).toBe(
      'calc(clamp(10px, 3.2cqw, 14px) * var(--font-scale, 1))'
    )
  })

  it('leaves parent-relative and keyword sizes alone so they are not scaled twice', () => {
    for (const value of ['inherit', '0.9em', '85%', 'smaller', 'initial']) {
      expect(scaleFontSizeValue(value)).toBe(value)
    }
  })

  it('is idempotent', () => {
    const once = scaleFontSizeValue('12px')
    expect(scaleFontSizeValue(once)).toBe(once)
  })
})

describe('scaleFontShorthand', () => {
  it('scales only the size token of a font shorthand', () => {
    expect(scaleFontShorthand('500 12px var(--font-serif, Georgia, serif)')).toBe(
      '500 calc(12px * var(--font-scale, 1)) var(--font-serif, Georgia, serif)'
    )
    expect(scaleFontShorthand('12px/1.2 sans-serif')).toBe(
      'calc(12px * var(--font-scale, 1))/1.2 sans-serif'
    )
  })

  it('leaves font: inherit untouched', () => {
    expect(scaleFontShorthand('inherit')).toBe('inherit')
  })
})
