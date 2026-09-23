import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig, resetConfigCache, type CalinoConfig } from '../configLoader'

const validConfig: CalinoConfig = {
  version: 1,
  accounts: [
    {
      name: 'Personal',
      url: { ciphertext: 'url-encrypted', iv: 'url-iv', salt: 'url-salt' },
      username: { ciphertext: 'user-encrypted', iv: 'user-iv', salt: 'user-salt' },
      password: {
        ciphertext: 'abc123',
        iv: 'def456',
        salt: 'ghi789',
      },
    },
  ],
  webcalSubscriptions: [],
}

const validWebcal = {
  name: 'Holidays',
  url: { ciphertext: 'webcal-url-encrypted', iv: 'webcal-url-iv', salt: 'webcal-url-salt' },
  refreshIntervalMinutes: 60,
}

// Save original global
const originalGlobal = globalThis as Record<string, unknown>

beforeEach(() => {
  resetConfigCache()
})

afterEach(() => {
  // Restore original
  if ('__CALINO_CONFIG__' in originalGlobal) {
    delete originalGlobal.__CALINO_CONFIG__
  }
})

describe('configLoader', () => {
  it('loads valid config from global', async () => {
    originalGlobal.__CALINO_CONFIG__ = validConfig

    const config = await loadConfig()
    expect(config).toEqual(validConfig)
  })

  it('preserves encrypted account headers and accepts legacy accounts', async () => {
    const encrypted = { ciphertext: 'header-encrypted', iv: 'header-iv', salt: 'header-salt' }
    originalGlobal.__CALINO_CONFIG__ = {
      version: 1,
      accounts: [
        validConfig.accounts[0],
        {
          ...validConfig.accounts[0],
          name: 'Gateway',
          headers: { 'CF-Access-Client-Id': encrypted },
        },
      ],
    }

    const config = await loadConfig()
    expect(config?.accounts[0].headers).toBeUndefined()
    expect(config?.accounts[1].headers).toEqual({ 'CF-Access-Client-Id': encrypted })
  })

  it('skips an account with a plaintext header value', async () => {
    originalGlobal.__CALINO_CONFIG__ = {
      version: 1,
      accounts: [
        validConfig.accounts[0],
        { ...validConfig.accounts[0], name: 'Unsafe', headers: { 'X-Token': 'plaintext' } },
      ],
    }
    const config = await loadConfig()
    expect(config?.accounts).toHaveLength(1)
  })

  it('returns null when no config injected', async () => {
    delete originalGlobal.__CALINO_CONFIG__

    const config = await loadConfig()
    expect(config).toBeNull()
  })

  it('returns null when global is null', async () => {
    originalGlobal.__CALINO_CONFIG__ = null

    const config = await loadConfig()
    expect(config).toBeNull()
  })

  it('returns null for invalid version', async () => {
    originalGlobal.__CALINO_CONFIG__ = { version: 2, accounts: [] }

    const config = await loadConfig()
    expect(config).toBeNull()
  })

  it('returns null for missing accounts array', async () => {
    originalGlobal.__CALINO_CONFIG__ = { version: 1 }

    const config = await loadConfig()
    expect(config).toBeNull()
  })

  it('returns null for empty accounts array', async () => {
    originalGlobal.__CALINO_CONFIG__ = { version: 1, accounts: [] }

    const config = await loadConfig()
    expect(config).toBeNull()
  })

  it('skips invalid accounts and returns valid ones', async () => {
    originalGlobal.__CALINO_CONFIG__ = {
      version: 1,
      accounts: [
        { name: '', url: {}, username: {}, password: {} }, // invalid
        validConfig.accounts[0], // valid
      ],
    }

    const config = await loadConfig()
    expect(config).not.toBeNull()
    expect(config!.accounts).toHaveLength(1)
    expect(config!.accounts[0].name).toBe('Personal')
  })

  it('caches config after first load', async () => {
    originalGlobal.__CALINO_CONFIG__ = validConfig

    const a = await loadConfig()
    const b = await loadConfig()

    expect(a).toBe(b) // same reference
  })

  it('resetConfigCache clears cache', async () => {
    originalGlobal.__CALINO_CONFIG__ = validConfig

    await loadConfig()
    resetConfigCache()
    const config = await loadConfig()

    expect(config).toEqual(validConfig) // re-validated
  })

  describe('webcalSubscriptions', () => {
    it('loads valid webcal subscriptions alongside accounts', async () => {
      originalGlobal.__CALINO_CONFIG__ = {
        version: 1,
        accounts: validConfig.accounts,
        webcalSubscriptions: [validWebcal],
      }

      const config = await loadConfig()
      expect(config).not.toBeNull()
      expect(config!.webcalSubscriptions).toHaveLength(1)
      expect(config!.webcalSubscriptions[0].name).toBe('Holidays')
    })

    it('succeeds with only webcal subscriptions and no accounts', async () => {
      originalGlobal.__CALINO_CONFIG__ = {
        version: 1,
        accounts: [],
        webcalSubscriptions: [validWebcal],
      }

      const config = await loadConfig()
      expect(config).not.toBeNull()
      expect(config!.accounts).toHaveLength(0)
      expect(config!.webcalSubscriptions).toHaveLength(1)
    })

    it('skips invalid webcal entries and keeps valid ones', async () => {
      originalGlobal.__CALINO_CONFIG__ = {
        version: 1,
        accounts: [],
        webcalSubscriptions: [
          { name: '', url: {} }, // invalid
          validWebcal, // valid
        ],
      }

      const config = await loadConfig()
      expect(config).not.toBeNull()
      expect(config!.webcalSubscriptions).toHaveLength(1)
      expect(config!.webcalSubscriptions[0].name).toBe('Holidays')
    })

    it('returns null when both accounts and webcalSubscriptions are empty', async () => {
      originalGlobal.__CALINO_CONFIG__ = { version: 1, accounts: [], webcalSubscriptions: [] }

      const config = await loadConfig()
      expect(config).toBeNull()
    })

    it('defaults to an empty array when webcalSubscriptions is omitted', async () => {
      originalGlobal.__CALINO_CONFIG__ = { version: 1, accounts: validConfig.accounts }

      const config = await loadConfig()
      expect(config).not.toBeNull()
      expect(config!.webcalSubscriptions).toEqual([])
    })
  })
})
