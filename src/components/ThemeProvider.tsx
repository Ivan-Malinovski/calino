import { useEffect, useState, useCallback, useMemo, type ReactNode } from 'react'
import { useSettingsStore } from '@/store/settingsStore'
import { loadThemes, getBuiltInThemeCSS, type ThemeInfo } from '@/lib/themes'
import { ThemeContext } from './ThemeContext'

interface ThemeProviderProps {
  children: ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const { themeMode, lightTheme, darkTheme } = useSettingsStore()
  const [loadedThemes, setLoadedThemes] = useState<ThemeInfo[]>([])
  const [customCSSMap, setCustomCSSMap] = useState<Map<string, string>>(new Map())
  const [, setTick] = useState(0)

  const effectiveMode = useMemo(() => {
    if (themeMode === 'auto') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return themeMode
  }, [themeMode])

  const currentThemeId = effectiveMode === 'dark' ? darkTheme : lightTheme

  const builtInCSS = useMemo(() => getBuiltInThemeCSS(), [])
  const customCSS = customCSSMap.get(currentThemeId) || ''

  useEffect(() => {
    const styleElement =
      document.getElementById('theme-styles') ||
      (() => {
        const el = document.createElement('style')
        el.id = 'theme-styles'
        document.head.appendChild(el)
        return el
      })()

    styleElement.textContent = builtInCSS + '\n' + customCSS
  }, [builtInCSS, customCSS])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', effectiveMode)
    document.documentElement.setAttribute('data-theme-mode', themeMode)
  }, [effectiveMode, themeMode])

  const handleMediaChange = useCallback(() => {
    if (useSettingsStore.getState().themeMode === 'auto') {
      setTick((n) => n + 1)
    }
  }, [])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaQuery.addEventListener('change', handleMediaChange)

    return () => {
      mediaQuery.removeEventListener('change', handleMediaChange)
    }
  }, [handleMediaChange])

  useEffect(() => {
    loadThemes().then((themes) => {
      setLoadedThemes(themes)

      const cssMap = new Map<string, string>()
      themes.forEach((theme) => {
        if (theme.id !== 'built-in') {
          cssMap.set(theme.id, '')
        }
      })
      setCustomCSSMap(cssMap)
    })
  }, [])

  const refetchThemes = useCallback(async () => {
    const themes = await loadThemes()
    setLoadedThemes(themes)
  }, [])

  return (
    <ThemeContext.Provider value={{ loadedThemes, refetchThemes }}>
      {children}
    </ThemeContext.Provider>
  )
}
