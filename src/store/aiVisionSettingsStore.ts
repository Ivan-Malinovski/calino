import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { safeLocalStorage } from '@/lib/storage'
import { encryptPassword, decryptPassword, type EncryptedData } from '@/lib/crypto'
import { syncAiPhotoImportShortcut } from '@/lib/dynamicShortcuts'
import { DEFAULT_BASE_URLS, type AIProvider, type AIVisionSettings } from '@/features/aiVision/types'

export interface AIVisionSettingsStore extends AIVisionSettings {
  setProvider: (provider: AIProvider) => void
  setBaseUrl: (url: string) => void
  setModel: (model: string) => void
  setApiKey: (plaintext: string) => Promise<void>
  getApiKey: () => Promise<string | null>
  clearApiKey: () => void
  setLastVerified: (v: AIVisionSettings['lastVerified']) => void
  hasApiKey: () => boolean
}

const DEFAULT_AI_VISION_SETTINGS: AIVisionSettings = {
  provider: 'custom',
  // Bare host, no trailing /v1 — the OpenAI-compatible adapter appends
  // /v1/... itself (see providers/openai.ts), same as DEFAULT_BASE_URLS.
  baseUrl: 'https://api.xiaomimimo.com',
  model: 'mimo-v2.5',
  apiKeyEncrypted: null,
  lastVerified: null,
}

export const useAIVisionSettingsStore = create<AIVisionSettingsStore>()(
  persist(
    (set, get) => ({
      ...DEFAULT_AI_VISION_SETTINGS,

      setProvider: (provider: AIProvider): void => {
        if (provider === 'anthropic' || provider === 'openai') {
          set({ provider, baseUrl: DEFAULT_BASE_URLS[provider] })
        } else {
          set({ provider })
        }
      },

      setBaseUrl: (url: string): void => {
        set({ baseUrl: url })
      },

      setModel: (model: string): void => {
        set({ model })
      },

      setApiKey: async (plaintext: string): Promise<void> => {
        if (plaintext === '') {
          set({ apiKeyEncrypted: null })
          syncAiPhotoImportShortcut(false)
          return
        }
        const encrypted: EncryptedData = await encryptPassword(plaintext)
        set({ apiKeyEncrypted: encrypted })
        syncAiPhotoImportShortcut(true)
      },

      getApiKey: async (): Promise<string | null> => {
        const { apiKeyEncrypted } = get()
        if (apiKeyEncrypted === null) return null
        return decryptPassword(apiKeyEncrypted)
      },

      clearApiKey: (): void => {
        set({ apiKeyEncrypted: null, lastVerified: null })
        syncAiPhotoImportShortcut(false)
      },

      setLastVerified: (v: AIVisionSettings['lastVerified']): void => {
        set({ lastVerified: v })
      },

      hasApiKey: (): boolean => {
        return get().apiKeyEncrypted !== null
      },
    }),
    {
      name: 'calino-ai-vision-settings',
      storage: createJSONStorage(() => safeLocalStorage),
      onRehydrateStorage: () => (state) => {
        if (state?.hasApiKey()) {
          syncAiPhotoImportShortcut(true)
        }
      },
    }
  )
)
