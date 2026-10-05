import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { safeLocalStorage } from '@/lib/storage'

// Consent is local to this browser, never included in CalDAV settings sync.
export const useWebMCPSettings = create<{
  enabled: boolean
  setEnabled: (enabled: boolean) => void
}>()(
  persist((set) => ({ enabled: false, setEnabled: (enabled) => set({ enabled }) }), {
    name: 'calino-webmcp',
    storage: createJSONStorage(() => safeLocalStorage),
    partialize: ({ enabled }) => ({ enabled }),
  })
)
