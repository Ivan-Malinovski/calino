import { createContext, useContext } from 'react'
import type { ThemeInfo } from '@/lib/themes'

export interface ThemeContextValue {
  loadedThemes: ThemeInfo[]
  refetchThemes: () => Promise<void>
  effectiveMode: 'light' | 'dark'
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
