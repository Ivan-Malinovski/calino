import { create } from 'zustand'
import { persist, createJSONStorage, type StorageValue } from 'zustand/middleware'
import { safeLocalStorage } from '@/lib/storage'
import { encryptPassword, decryptPassword, type EncryptedData } from '@/lib/crypto'
import { syncAiPhotoImportShortcut } from '@/lib/dynamicShortcuts'
import {
  DEFAULT_BASE_URLS,
  type AIProvider,
  type AIVisionSettings,
} from '@/features/aiVision/types'

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

type JSONStorage<T> = NonNullable<ReturnType<typeof createJSONStorage<T>>>

function versionedStorage<T>(inner: JSONStorage<T> | undefined): JSONStorage<T> | undefined {
  if (!inner) return inner
  const stamp = (v: StorageValue<T> | null): StorageValue<T> | null =>
    v && typeof v.version !== 'number' ? { ...v, version: 0 } : v
  return {
    ...inner,
    getItem: (name) => {
      const value = inner.getItem(name)
      return value instanceof Promise ? value.then(stamp) : stamp(value)
    },
  }
}

const DEFAULT_AI_VISION_SETTINGS: AIVisionSettings = {
  provider: 'custom',
  // The complete API root. Adapters append only the endpoint path, so the
  // version segment belongs here (see providers/url.ts).
  baseUrl: 'https://api.xiaomimimo.com/v1',
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
      // zustand only runs `migrate` when the stored blob carries a numeric
      // `version`, and v0 was persisted before this store had one — so stamp
      // the absent version as 0 on read, otherwise the migration below never
      // fires for exactly the installs that need it.
      storage: versionedStorage(createJSONStorage(() => safeLocalStorage)),
      version: 1,
      // v0 stored a bare API host because the adapters appended "/v1"
      // themselves. They no longer touch the URL, so fold that segment into
      // the stored value — otherwise every existing install starts requesting
      // the API root and 404s.
      migrate: (persisted, version) => {
        const state = persisted as Partial<AIVisionSettings> | undefined
        if (version >= 1 || !state) return state as AIVisionSettings
        const baseUrl = state.baseUrl?.replace(/\/+$/, '')
        return { ...state, ...(baseUrl ? { baseUrl: `${baseUrl}/v1` } : {}) } as AIVisionSettings
      },
      onRehydrateStorage: () => (state) => {
        if (state?.hasApiKey()) {
          syncAiPhotoImportShortcut(true)
        }
      },
    }
  )
)
