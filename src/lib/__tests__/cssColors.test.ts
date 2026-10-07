import { describe, it, expect } from 'vitest'
import { parseIcalColor } from '../cssColors'

describe('parseIcalColor', () => {
  it('resolves CSS3 color names, which is what Nextcloud writes', () => {
    expect(parseIcalColor('dodgerblue')).toBe('#1e90ff')
    expect(parseIcalColor('tomato')).toBe('#ff6347')
  })

  it('ignores case and surrounding whitespace', () => {
    expect(parseIcalColor('  DodgerBlue ')).toBe('#1e90ff')
  })

  it('accepts hex with or without the hash, expanding shorthand', () => {
    expect(parseIcalColor('#FF6347')).toBe('#ff6347')
    expect(parseIcalColor('ff6347')).toBe('#ff6347')
    expect(parseIcalColor('#f63')).toBe('#ff6633')
  })

  it('drops an alpha channel', () => {
    expect(parseIcalColor('#ff634780')).toBe('#ff6347')
  })

  it('returns undefined for unknown or non-string values', () => {
    expect(parseIcalColor('not-a-color')).toBeUndefined()
    expect(parseIcalColor('')).toBeUndefined()
    expect(parseIcalColor(undefined)).toBeUndefined()
    expect(parseIcalColor(42)).toBeUndefined()
    expect(parseIcalColor('#12345')).toBeUndefined()
  })
})
