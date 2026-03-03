import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useSettingsStore, THEME_MODE_OPTIONS } from '@/store/settingsStore'
import { useTheme } from '@/components/ThemeContext'
import type { ThemeMode } from '@/types'
import type { ThemeInfo } from '@/lib/themes'
import styles from './Settings.module.css'

export function ThemeSettings(): JSX.Element {
  const { themeMode, lightTheme, darkTheme, updateSettings } = useSettingsStore()
  const { loadedThemes, refetchThemes } = useTheme()
  const [lightThemes, setLightThemes] = useState<ThemeInfo[]>([])
  const [darkThemes, setDarkThemes] = useState<ThemeInfo[]>([])

  useEffect(() => {
    refetchThemes()
  }, [refetchThemes])

  useEffect(() => {
    setLightThemes(loadedThemes.filter((t) => !t.isDark))
    setDarkThemes(loadedThemes.filter((t) => t.isDark))
  }, [loadedThemes])

  const handleThemeModeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateSettings({ themeMode: e.target.value as ThemeMode })
  }

  const handleLightThemeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateSettings({ lightTheme: e.target.value })
  }

  const handleDarkThemeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateSettings({ darkTheme: e.target.value })
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Theme</h2>
      <p className={styles.sectionDescription}>
        Customize how GoodCal looks. Add custom themes by placing CSS files in the themes folder.
      </p>

      <div className={styles.settingRow}>
        <div className={styles.settingLabel}>
          <span className={styles.settingLabelText}>Dark Mode</span>
          <span className={styles.settingLabelHint}>Toggle between light and dark themes</span>
        </div>
        <select className={styles.select} value={themeMode} onChange={handleThemeModeChange}>
          {THEME_MODE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingLabel}>
          <span className={styles.settingLabelText}>Light Theme</span>
          <span className={styles.settingLabelHint}>Theme used when light mode is active</span>
        </div>
        <select className={styles.select} value={lightTheme} onChange={handleLightThemeChange}>
          {lightThemes.length > 0 ? (
            lightThemes.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.name}
              </option>
            ))
          ) : (
            <option value="built-in">Default Light</option>
          )}
        </select>
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingLabel}>
          <span className={styles.settingLabelText}>Dark Theme</span>
          <span className={styles.settingLabelHint}>Theme used when dark mode is active</span>
        </div>
        <select className={styles.select} value={darkTheme} onChange={handleDarkThemeChange}>
          {darkThemes.length > 0 ? (
            darkThemes.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.name}
              </option>
            ))
          ) : (
            <option value="built-in">Default Dark</option>
          )}
        </select>
      </div>
    </div>
  )
}
