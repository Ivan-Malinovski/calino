import { describe, expect, it } from 'vitest'
import { normalizeBasePath, withBasePath } from '../basePath'

describe('normalizeBasePath', () => {
  it.each([
    [undefined, '/'],
    ['', '/'],
    ['/', '/'],
    ['cal', '/cal/'],
    ['/cal', '/cal/'],
    ['/cal/', '/cal/'],
    ['  /cal  ', '/cal/'],
  ])('normalizes %s to %s', (value, expected) => {
    expect(normalizeBasePath(value)).toBe(expected)
  })
})

describe('withBasePath', () => {
  it('prefixes app-absolute paths', () => {
    expect(withBasePath('/settings', '/cal')).toBe('/cal/settings')
    expect(withBasePath('sample-events.ics', '/cal')).toBe('/cal/sample-events.ics')
  })

  it('leaves paths alone at the root', () => {
    expect(withBasePath('/settings', '')).toBe('/settings')
  })
})
