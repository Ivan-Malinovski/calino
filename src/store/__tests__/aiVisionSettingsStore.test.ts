import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useAIVisionSettingsStore } from '../aiVisionSettingsStore'
import { DEFAULT_BASE_URLS } from '@/features/aiVision/types'
import { createLocalStorageMock } from '@/test/storageMock'

const DEFAULTS = {
  provider: 'custom' as const,
  baseUrl: 'https://api.xiaomimimo.com/v1',
  model: 'mimo-v2.5',
  apiKeyEncrypted: null,
  lastVerified: null,
}

describe('aiVisionSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useAIVisionSettingsStore.setState({ ...DEFAULTS })
  })

  it('has default state', () => {
    const state = useAIVisionSettingsStore.getState()
    expect(state.provider).toBe('custom')
    expect(state.baseUrl).toBe('https://api.xiaomimimo.com/v1')
    expect(state.model).toBe('mimo-v2.5')
    expect(state.apiKeyEncrypted).toBeNull()
    expect(state.lastVerified).toBeNull()
  })

  it('setProvider resets baseUrl for anthropic', () => {
    useAIVisionSettingsStore.getState().setProvider('anthropic')
    const state = useAIVisionSettingsStore.getState()
    expect(state.provider).toBe('anthropic')
    expect(state.baseUrl).toBe(DEFAULT_BASE_URLS.anthropic)
  })

  it('setProvider resets baseUrl for openai', () => {
    useAIVisionSettingsStore.getState().setProvider('openai')
    const state = useAIVisionSettingsStore.getState()
    expect(state.provider).toBe('openai')
    expect(state.baseUrl).toBe(DEFAULT_BASE_URLS.openai)
  })

  it('setProvider does not touch baseUrl when switching to custom', () => {
    useAIVisionSettingsStore.getState().setProvider('anthropic')
    useAIVisionSettingsStore.setState({ baseUrl: 'https://my-custom-endpoint.example/v1' })

    useAIVisionSettingsStore.getState().setProvider('custom')
    const state = useAIVisionSettingsStore.getState()
    expect(state.provider).toBe('custom')
    expect(state.baseUrl).toBe('https://my-custom-endpoint.example/v1')
  })

  it('setBaseUrl and setModel update state', () => {
    useAIVisionSettingsStore.getState().setBaseUrl('https://example.com/v1')
    useAIVisionSettingsStore.getState().setModel('gpt-4-vision')

    const state = useAIVisionSettingsStore.getState()
    expect(state.baseUrl).toBe('https://example.com/v1')
    expect(state.model).toBe('gpt-4-vision')
  })

  describe('persisted baseUrl migration', () => {
    const storage = createLocalStorageMock()

    beforeEach(() => storage.install())
    afterEach(() => {
      vi.restoreAllMocks()
      storage.reset()
    })

    async function rehydrateFrom(persisted: unknown): Promise<string> {
      localStorage.setItem('calino-ai-vision-settings', JSON.stringify(persisted))
      await useAIVisionSettingsStore.persist.rehydrate()
      return useAIVisionSettingsStore.getState().baseUrl
    }

    it('folds in the /v1 that v0 adapters used to append', async () => {
      const baseUrl = await rehydrateFrom({ state: { ...DEFAULTS, baseUrl: 'https://api.xiaomimimo.com' } })
      expect(baseUrl).toBe('https://api.xiaomimimo.com/v1')
    })

    it('does not double the slash when the v0 value had a trailing one', async () => {
      const baseUrl = await rehydrateFrom({ state: { ...DEFAULTS, baseUrl: 'https://api.example.com/' } })
      expect(baseUrl).toBe('https://api.example.com/v1')
    })

    it('leaves an already-migrated baseUrl alone', async () => {
      const baseUrl = await rehydrateFrom({
        state: { ...DEFAULTS, baseUrl: 'https://api.example.com/v2' },
        version: 1,
      })
      expect(baseUrl).toBe('https://api.example.com/v2')
    })
  })

  it('setApiKey/getApiKey round-trip through real crypto', async () => {
    const plaintext = 'sk-test-1234567890-abcdefg'
    await useAIVisionSettingsStore.getState().setApiKey(plaintext)

    const state = useAIVisionSettingsStore.getState()
    expect(state.apiKeyEncrypted).not.toBeNull()
    expect(state.apiKeyEncrypted?.iv).toBeTypeOf('string')
    expect(state.apiKeyEncrypted?.data).toBeTypeOf('string')
    // Ensure it's not stored as plaintext anywhere in the encrypted shape
    expect(state.apiKeyEncrypted?.data).not.toBe(plaintext)

    // Simulate persist round-trip through JSON (localStorage is string-based)
    const serialized = JSON.stringify(state.apiKeyEncrypted)
    const parsed = JSON.parse(serialized)
    useAIVisionSettingsStore.setState({ apiKeyEncrypted: parsed })

    const decrypted = await useAIVisionSettingsStore.getState().getApiKey()
    expect(decrypted).toBe(plaintext)
  })

  it('getApiKey returns null when no key is set', async () => {
    const result = await useAIVisionSettingsStore.getState().getApiKey()
    expect(result).toBeNull()
  })

  it('setApiKey("") clears the key', async () => {
    await useAIVisionSettingsStore.getState().setApiKey('some-key')
    expect(useAIVisionSettingsStore.getState().apiKeyEncrypted).not.toBeNull()

    await useAIVisionSettingsStore.getState().setApiKey('')
    expect(useAIVisionSettingsStore.getState().apiKeyEncrypted).toBeNull()
  })

  it('clearApiKey clears both apiKeyEncrypted and lastVerified', async () => {
    await useAIVisionSettingsStore.getState().setApiKey('some-key')
    useAIVisionSettingsStore.getState().setLastVerified({ at: Date.now(), ok: true, visionCapable: true })

    expect(useAIVisionSettingsStore.getState().apiKeyEncrypted).not.toBeNull()
    expect(useAIVisionSettingsStore.getState().lastVerified).not.toBeNull()

    useAIVisionSettingsStore.getState().clearApiKey()

    expect(useAIVisionSettingsStore.getState().apiKeyEncrypted).toBeNull()
    expect(useAIVisionSettingsStore.getState().lastVerified).toBeNull()
  })

  it('hasApiKey reflects state correctly', async () => {
    expect(useAIVisionSettingsStore.getState().hasApiKey()).toBe(false)

    await useAIVisionSettingsStore.getState().setApiKey('some-key')
    expect(useAIVisionSettingsStore.getState().hasApiKey()).toBe(true)

    useAIVisionSettingsStore.getState().clearApiKey()
    expect(useAIVisionSettingsStore.getState().hasApiKey()).toBe(false)
  })

  it('setLastVerified updates state', () => {
    const v = { at: 12345, ok: false }
    useAIVisionSettingsStore.getState().setLastVerified(v)
    expect(useAIVisionSettingsStore.getState().lastVerified).toEqual(v)

    useAIVisionSettingsStore.getState().setLastVerified(null)
    expect(useAIVisionSettingsStore.getState().lastVerified).toBeNull()
  })
})
