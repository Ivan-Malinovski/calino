export interface ThemeInfo {
  id: string
  name: string
  isDark: boolean
}

export interface ThemeContextValue {
  loadedThemes: ThemeInfo[]
  getThemeCSS: (themeId: string) => string
  refetchThemes: () => Promise<void>
}
