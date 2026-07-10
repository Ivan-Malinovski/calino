import { useEffect, useState, useCallback, useMemo, useRef, useLayoutEffect, type ReactNode } from 'react'
import { useSettingsStore } from '@/store/settingsStore'
import { loadThemes, getThemeCSS, type ThemeInfo } from '@/lib/themes'
import { ThemeContext } from './ThemeContext'

interface ThemeProviderProps {
  children: ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const themeMode = useSettingsStore((s) => s.themeMode)
  const lightTheme = useSettingsStore((s) => s.lightTheme)
  const darkTheme = useSettingsStore((s) => s.darkTheme)
  const [loadedThemes, setLoadedThemes] = useState<ThemeInfo[]>([])
  const [, setTick] = useState(0)

  const effectiveMode = useMemo(() => {
    if (themeMode === 'auto') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return themeMode
  }, [themeMode])

  const currentThemeId = effectiveMode === 'dark' ? darkTheme : lightTheme

  const builtInCSS = useMemo(() => getThemeCSS('built-in'), [])
  const isBuiltIn = currentThemeId === 'built-in' || currentThemeId === 'built-in-dark'
  const customCSS = !isBuiltIn ? getThemeCSS(currentThemeId) : ''

  // R5.4 — memoize the combined CSS so we only touch the DOM when the
  // value actually changed. Without this, the effect runs on every
  // render and `styleElement.textContent = ...` triggers a reflow even
  // when the string is byte-identical to the prior render.
  const combinedCSS = useMemo(() => builtInCSS + '\n' + customCSS, [builtInCSS, customCSS])
  const lastCSSRef = useRef<string>('')

  // R5.4 — useLayoutEffect runs synchronously after the DOM is updated
  // but BEFORE the browser paints. The previous requestAnimationFrame
  // version deferred the meta-theme-color update by 1 frame, which
  // caused a brief flash on theme change in mobile Safari.
  //
  // The CSS injection AND the data-theme / meta-theme-color update
  // both run in this single useLayoutEffect so the meta-theme-color
  // computed-style read happens AFTER the new CSS has been written
  // — without this ordering, switching to a custom theme would read
  // --color-accent from the previous theme's CSS for 1 frame.
  useLayoutEffect(() => {
    if (combinedCSS !== lastCSSRef.current) {
      lastCSSRef.current = combinedCSS
      const styleElement =
        document.getElementById('theme-styles') ||
        (() => {
          const el = document.createElement('style')
          el.id = 'theme-styles'
          document.head.appendChild(el)
          return el
        })()

      styleElement.textContent = combinedCSS
    }

    document.documentElement.setAttribute('data-theme', effectiveMode)
    document.documentElement.setAttribute('data-theme-mode', themeMode)
    if (!isBuiltIn) {
      const themeId = currentThemeId.replace(/-(light|dark)$/, '')
      document.documentElement.setAttribute('data-theme-id', themeId)
    } else {
      document.documentElement.removeAttribute('data-theme-id')
    }

    const style = getComputedStyle(document.documentElement)
    const accentColor = style.getPropertyValue('--color-accent').trim()
    const metaThemeColor = document.querySelector('meta[name="theme-color"]')
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', accentColor || '#4285f4')
    }
  }, [combinedCSS, effectiveMode, themeMode, currentThemeId, isBuiltIn])

  const themeModeRef = useRef(themeMode)
  useEffect(() => {
    themeModeRef.current = themeMode
  }, [themeMode])

  const handleMediaChange = useCallback(() => {
    if (themeModeRef.current === 'auto') {
      setTick((n) => n + 1)
    }
  }, [])

  useEffect(() => {
    if (themeMode !== 'auto') return

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaQuery.addEventListener('change', handleMediaChange)

    return () => {
      mediaQuery.removeEventListener('change', handleMediaChange)
    }
  }, [themeMode, handleMediaChange])

  useEffect(() => {
    loadThemes().then((themes) => {
      setLoadedThemes(themes)
    })
  }, [])

  const refetchThemes = useCallback(async () => {
    const themes = await loadThemes()
    setLoadedThemes(themes)
  }, [])

  return (
    <ThemeContext.Provider value={{ loadedThemes, refetchThemes, effectiveMode }}>
      {children}
    </ThemeContext.Provider>
  )
}
