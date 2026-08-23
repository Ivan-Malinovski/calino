import {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  useLayoutEffect,
  type ReactNode,
} from 'react'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { useSettingsStore } from '@/store/settingsStore'
import { loadThemes, getThemeCSS, type ThemeInfo } from '@/lib/themes'
import { ADJUSTABLE_FONT_STACKS } from '@/lib/themes/adjustableFonts'
import { ThemeContext } from './ThemeContext'

const FALLBACK_ADJUSTABLE_PROFILE = {
  canvas: '#f7f4ee',
  panel: '#fffdfa',
  accent: '#9a6b43',
  accentContrast: '#ffffff',
  text: '#2c2823',
  mutedText: '#70695f',
  border: '#e4ded4',
  fontFamily: 'system',
  cornerRadius: 10,
  density: 100,
  shadowStrength: 70,
  eventTint: 10,
}

const ADJUSTABLE_CSS_VARIABLES = [
  '--adjustable-canvas',
  '--adjustable-panel',
  '--adjustable-accent',
  '--adjustable-accent-contrast',
  '--adjustable-text',
  '--adjustable-muted-text',
  '--adjustable-border',
  '--adjustable-font',
  '--adjustable-radius',
  '--adjustable-density',
  '--adjustable-shadow-strength',
  '--adjustable-event-tint',
] as const

interface ThemeProviderProps {
  children: ReactNode
}

// Custom themes intentionally override the visual palette while inheriting the
// component token structure from built-in.css. These bridges keep optional
// tokens tied to the selected palette instead of the default theme's values.
// The bridge is inserted before custom CSS so an explicit theme declaration
// always wins.
const CUSTOM_THEME_TOKEN_BRIDGE = `
[data-theme-id] {
  --accent-strong: var(--color-accent-hover, var(--accent));
  --accent-strong-on-soft: var(--color-accent-hover, var(--accent));
  --accent-hover: var(--color-accent-hover, var(--accent));
  --color-surface-hover: var(--color-bg-hover, var(--color-bg-tertiary));
  --color-text: var(--color-text-primary, var(--ink));
  --event-ink-2: var(--ink-2, var(--color-text-secondary));
  --event-ink-3: var(--ink-3, var(--color-text-muted));
  --ink-3-dimmed: var(--ink-3, var(--color-text-muted));
  --ink-1: var(--ink, var(--color-text-primary));
  --surface-1: var(--color-surface, var(--panel));
  --nav-canvas-track: var(--color-bg-tertiary, var(--canvas));
  --nav-switcher-track: var(--color-bg-secondary, var(--panel));
  --ink-4: var(--ink-3, var(--color-text-muted));
  --toggle-off: var(--color-border, var(--line));
  --shadow-opacity: 1;
  --shadow-pill: var(--shadow-card, none);
  --shadow-tile-active: 0 3px 8px color-mix(in srgb, var(--accent) 35%, transparent);
  --modal-card-border: 1px solid var(--modal-border, transparent);
  --color-current-time: var(--color-error, var(--accent));
  /* A low-specificity fallback lets each custom theme, including Adjustable,
     supply its own readable text color for accent fills. */
  --accent-contrast: var(--color-bg-primary, var(--canvas, #fff));
}
`

export function ThemeProvider({ children }: ThemeProviderProps) {
  const themeMode = useSettingsStore((s) => s.themeMode)
  const lightTheme = useSettingsStore((s) => s.lightTheme)
  const darkTheme = useSettingsStore((s) => s.darkTheme)
  const mochaAccent = useSettingsStore((s) => s.mochaAccent)
  const eventTint = useSettingsStore((s) => s.eventTint)
  const adjustableTheme = useSettingsStore((s) => s.adjustableTheme)
  const [loadedThemes, setLoadedThemes] = useState<ThemeInfo[]>([])
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )

  const effectiveMode = useMemo(() => {
    if (themeMode === 'auto') {
      return systemPrefersDark ? 'dark' : 'light'
    }
    return themeMode
  }, [themeMode, systemPrefersDark])

  const selectedThemeId = effectiveMode === 'dark' ? darkTheme : lightTheme
  const availableThemeIds = useMemo(
    () => new Set(['built-in', 'built-in-dark', ...loadedThemes.map((theme) => theme.id)]),
    [loadedThemes]
  )
  const currentThemeId = availableThemeIds.has(selectedThemeId)
    ? selectedThemeId
    : effectiveMode === 'dark'
      ? 'built-in-dark'
      : 'built-in'
  const isAdjustableTheme = currentThemeId.startsWith('adjustable-')
  const adjustableProfile =
    (effectiveMode === 'dark' ? adjustableTheme?.dark : adjustableTheme?.light) ??
    FALLBACK_ADJUSTABLE_PROFILE

  const builtInCSS = useMemo(() => getThemeCSS('built-in'), [])
  const isBuiltIn = currentThemeId === 'built-in' || currentThemeId === 'built-in-dark'
  const customCSS = !isBuiltIn ? getThemeCSS(currentThemeId) : ''

  // R5.4 — memoize the combined CSS so we only touch the DOM when the
  // value actually changed. Without this, the effect runs on every
  // render and `styleElement.textContent = ...` triggers a reflow even
  // when the string is byte-identical to the prior render.
  const combinedCSS = useMemo(
    () => builtInCSS + '\n' + (isBuiltIn ? '' : CUSTOM_THEME_TOKEN_BRIDGE) + customCSS,
    [builtInCSS, customCSS, isBuiltIn]
  )
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
    if (currentThemeId === 'catppuccin-mocha') {
      document.documentElement.style.setProperty('--accent-custom', mochaAccent)
    } else {
      document.documentElement.style.removeProperty('--accent-custom')
    }
    if (isAdjustableTheme) {
      const adjustableValues = {
        '--adjustable-canvas': adjustableProfile.canvas,
        '--adjustable-panel': adjustableProfile.panel,
        '--adjustable-accent': adjustableProfile.accent,
        '--adjustable-accent-contrast': adjustableProfile.accentContrast,
        '--adjustable-text': adjustableProfile.text,
        '--adjustable-muted-text': adjustableProfile.mutedText,
        '--adjustable-border': adjustableProfile.border,
        '--adjustable-font': ADJUSTABLE_FONT_STACKS[adjustableProfile.fontFamily],
        '--adjustable-radius': `${adjustableProfile.cornerRadius}px`,
        '--adjustable-density': String(adjustableProfile.density / 100),
        '--adjustable-shadow-strength': String(adjustableProfile.shadowStrength / 100),
        '--adjustable-event-tint': String(adjustableProfile.eventTint),
      }
      for (const [property, value] of Object.entries(adjustableValues)) {
        document.documentElement.style.setProperty(property, value)
      }
    } else {
      for (const property of ADJUSTABLE_CSS_VARIABLES) {
        document.documentElement.style.removeProperty(property)
      }
    }
    if (!isBuiltIn) {
      const themeId = currentThemeId.replace(/-(light|dark)$/, '')
      document.documentElement.setAttribute('data-theme-id', themeId)
    } else {
      document.documentElement.removeAttribute('data-theme-id')
    }
    // Only while a built-in theme is active: the tint levels are defined in
    // built-in.css, which is always injected, so leaving the attribute set
    // would let them override a custom theme's own event colours.
    if (isBuiltIn) {
      document.documentElement.setAttribute('data-event-tint', eventTint)
    } else {
      document.documentElement.removeAttribute('data-event-tint')
    }

    const style = getComputedStyle(document.documentElement)
    const accentColor = style.getPropertyValue('--color-accent').trim()
    const metaThemeColor = document.querySelector('meta[name="theme-color"]')
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', accentColor || '#4285f4')
    }

    if (Capacitor.isNativePlatform()) {
      void StatusBar.setStyle({ style: effectiveMode === 'dark' ? Style.Dark : Style.Light })
    }
  }, [
    combinedCSS,
    effectiveMode,
    themeMode,
    currentThemeId,
    isBuiltIn,
    isAdjustableTheme,
    adjustableProfile,
    mochaAccent,
    eventTint,
  ])

  const themeModeRef = useRef(themeMode)
  useEffect(() => {
    themeModeRef.current = themeMode
  }, [themeMode])

  const handleMediaChange = useCallback((event: MediaQueryListEvent) => {
    if (themeModeRef.current === 'auto') {
      setSystemPrefersDark(event.matches)
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
