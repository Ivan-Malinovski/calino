import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUuid, isUUID } from '../uuid'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createUuid', () => {
  it('uses crypto.randomUUID when available', () => {
    const randomUUID = vi.fn(() => 'native-uuid')
    vi.stubGlobal('crypto', { randomUUID })

    expect(createUuid()).toBe('native-uuid')
    expect(randomUUID).toHaveBeenCalledOnce()
  })

  it('falls back to the uuid package when randomUUID is unavailable', () => {
    const nativeCrypto = globalThis.crypto
    vi.stubGlobal('crypto', {
      getRandomValues: nativeCrypto.getRandomValues.bind(nativeCrypto),
    } as Crypto)

    expect(isUUID(createUuid())).toBe(true)
  })
})
