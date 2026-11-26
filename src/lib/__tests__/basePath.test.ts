import { afterEach, describe, expect, it, vi } from 'vitest'
import { getBasePath, withBase } from '../basePath'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getBasePath', () => {
  it('reads Vite BASE_URL without the trailing slash', () => {
    vi.stubEnv('BASE_URL', '/cal/')
    expect(getBasePath()).toBe('/cal')
  })

  it('returns an empty string at the site root', () => {
    vi.stubEnv('BASE_URL', '/')
    expect(getBasePath()).toBe('')
  })
})

describe('withBase', () => {
  it('prefixes paths with the deployment base', () => {
    expect(withBase('/settings', '/cal')).toBe('/cal/settings')
  })

  it('is a no-op at the site root', () => {
    expect(withBase('/settings', '')).toBe('/settings')
  })
})
