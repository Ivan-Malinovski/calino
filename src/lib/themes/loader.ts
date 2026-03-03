import type { ThemeInfo } from './types'

const BUILT_IN_THEME_ID = 'built-in'

let cachedThemes: ThemeInfo[] | null = null
const cachedCSS: Map<string, string> = new Map()

export function extractThemeName(css: string, filename: string): { name: string; isDark: boolean } {
  const themeCommentMatch = css.match(/\/\*\s*Theme:\s*(.+?)\s*(?:\|?\s*(dark|light))?\s*\*\//i)

  if (themeCommentMatch) {
    const name = themeCommentMatch[1].trim()
    const mode = themeCommentMatch[2]?.toLowerCase()
    return {
      name,
      isDark: mode === 'dark',
    }
  }

  const nameWithoutExt = filename.replace(/\.css$/, '')
  const name = nameWithoutExt
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

  return { name, isDark: false }
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
  ]

  const themeFiles = import.meta.glob('/public/themes/*.css', { as: 'raw', eager: true })

  for (const path in themeFiles) {
    const css = themeFiles[path] as string
    const filename = path.split('/').pop() || ''
    const themeId = filename.replace(/\.css$/, '')
    const { name, isDark } = extractThemeName(css, filename)

    themes.push({
      id: themeId,
      name,
      isDark,
    })

    cachedCSS.set(themeId, css)
  }

  cachedThemes = themes
  return themes
}

export function getThemeCSS(themeId: string): string {
  if (themeId === BUILT_IN_THEME_ID) {
    return ''
  }

  return cachedCSS.get(themeId) || ''
}

export async function refetchThemes(): Promise<void> {
  cachedThemes = null
  cachedCSS.clear()
  await loadThemes()
}

export function getBuiltInThemeCSS(): string {
  return `:root,
[data-theme="light"] {
  --color-bg-primary: #fafafa;
  --color-bg-secondary: #ffffff;
  --color-bg-tertiary: #f3f4f6;
  --color-bg-hover: #f1f3f4;

  --color-text-primary: #202124;
  --color-text-secondary: #5f6368;
  --color-text-muted: #9ca3af;

  --color-border: #e5e7eb;
  --color-border-light: #f1f3f4;

  --color-accent: #4285f4;
  --color-accent-hover: #3367d6;
  --color-accent-light: #e8f0fe;

  --color-success: #34a853;
  --color-warning: #fbbc04;
  --color-error: #ea4335;
  --color-info: #4285f4;

  --color-overlay: rgba(0, 0, 0, 0.5);

  --color-focus: #4285f4;

  --color-scrollbar: #d1d5db;
  --color-scrollbar-hover: #9ca3af;

  --color-grid-number: #202124;
  --color-current-day: #4285f4;
}

[data-theme="dark"] {
  --color-bg-primary: #202124;
  --color-bg-secondary: #303134;
  --color-bg-tertiary: #3C4043;
  --color-bg-hover: #3C4043;

  --color-text-primary: #E8EAED;
  --color-text-secondary: #9AA0A6;
  --color-text-muted: #6B7280;

  --color-border: #3C4043;
  --color-border-light: #35363A;

  --color-accent: #8AB4F8;
  --color-accent-hover: #AECBFA;
  --color-accent-light: #41331C;

  --color-success: #81C995;
  --color-warning: #FDD663;
  --color-error: #F28B82;
  --color-info: #8AB4F8;

  --color-overlay: rgba(0, 0, 0, 0.7);

  --color-focus: #8AB4F8;

  --color-scrollbar: #5F6368;
  --color-scrollbar-hover: #80868B;

  /* Additional dark theme specific colors */
  --color-grid-number: #BDC1C6;
  --color-current-day: #8AB4F8;
}`
}
