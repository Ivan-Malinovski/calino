/**
 * Theme loader.
 *
 * Themes are loaded at build time via `import.meta.glob('/public/themes/*.css', { query: '?raw' })`.
 * Custom themes require a rebuild — runtime theme loading is not supported.
 * The set of available themes is frozen at the time Vite produces the bundle.
 */

import type { ThemeInfo } from './types'

const BUILT_IN_THEME_ID = 'built-in'
const BUILT_IN_DARK_THEME_ID = 'built-in-dark'

// Load built-in theme CSS at build time (Vite replaces this with the file content)
const BUILT_IN_CSS: string =
  (
    import.meta.glob('/src/themes/built-in.css', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>
  )['/src/themes/built-in.css'] ?? ''

let cachedThemes: ThemeInfo[] | null = null
const cachedCSS: Map<string, string> = new Map()

export function extractThemeName(
  css: string,
  filename: string
): { name: string; isDark: boolean; isBoth: boolean } {
  const themeCommentMatch = css.match(
    /\/\*\s*Theme:\s*(.+?)\s*(?:\|?\s*(dark|light|both))?\s*\*\//i
  )

  if (themeCommentMatch) {
    const name = themeCommentMatch[1].trim()
    const mode = themeCommentMatch[2]?.toLowerCase()
    return {
      name,
      isDark: mode === 'dark',
      isBoth: mode === 'both',
    }
  }

  const nameWithoutExt = filename.replace(/\.css$/, '')
  const name = nameWithoutExt
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

  return { name, isDark: false, isBoth: false }
}

export function extractCSSSection(css: string, mode: 'light' | 'dark'): string {
  const lines = css.split('\n')
  const result: string[] = []
  let inSection = false
  let braceDepth = 0

  for (const line of lines) {
    const matchesMode = line.includes(`[data-theme='${mode}']`)
    const matchesRoot =
      mode === 'light' && line.includes(':root,') && !line.includes('data-theme-id')

    if (matchesMode || matchesRoot) {
      inSection = true
      braceDepth = 0
    }

    if (inSection) {
      result.push(line)
      braceDepth += (line.match(/\{/g) || []).length
      braceDepth -= (line.match(/\}/g) || []).length

      if (braceDepth <= 0 && result.length > 1) {
        inSection = false
      }
    }
  }

  return result.join('\n') || css
}

export async function loadThemes(): Promise<ThemeInfo[]> {
  if (cachedThemes) {
    return cachedThemes
  }

  const themes: ThemeInfo[] = [
    {
      id: BUILT_IN_THEME_ID,
      name: 'Default Light',
      isDark: false,
    },
    {
      id: BUILT_IN_DARK_THEME_ID,
      name: 'Default Dark',
      isDark: true,
    },
  ]

  const themeFiles = import.meta.glob('/public/themes/*.css', {
    query: '?raw',
    import: 'default',
    eager: true,
  })

  for (const path in themeFiles) {
    const css = themeFiles[path] as string
    const filename = path.split('/').pop() || ''
    const themeId = filename.replace(/\.css$/, '')
    const { name, isDark, isBoth } = extractThemeName(css, filename)

    if (isBoth) {
      themes.push({ id: `${themeId}-light`, name, isDark: false })
      themes.push({ id: `${themeId}-dark`, name, isDark: true })
      cachedCSS.set(`${themeId}-light`, css)
      cachedCSS.set(`${themeId}-dark`, css)
    } else {
      themes.push({ id: themeId, name, isDark })
      cachedCSS.set(themeId, css)
    }
  }

  cachedThemes = themes
  return themes
}

// Derive the dark section from the built-in CSS at module load time
const BUILT_IN_DARK_CSS = extractCSSSection(BUILT_IN_CSS, 'dark')

/** Returns full CSS for DOM injection */
export function getThemeCSS(themeId: string): string {
  if (themeId === BUILT_IN_THEME_ID) {
    return BUILT_IN_CSS
  }
  if (themeId === BUILT_IN_DARK_THEME_ID) {
    return BUILT_IN_DARK_CSS
  }

  return cachedCSS.get(themeId) || ''
}

/** Returns extracted CSS section for preview cards */
export function getThemePreviewCSS(themeId: string): string {
  if (themeId === BUILT_IN_THEME_ID) {
    return extractCSSSection(BUILT_IN_CSS, 'light')
  }
  if (themeId === BUILT_IN_DARK_THEME_ID) {
    return BUILT_IN_DARK_CSS
  }

  const fullCSS = cachedCSS.get(themeId) || ''
  const mode = themeId.endsWith('-dark') ? 'dark' : 'light'
  return extractCSSSection(fullCSS, mode)
}

export async function refetchThemes(): Promise<void> {
  cachedThemes = null
  cachedCSS.clear()
  await loadThemes()
}
