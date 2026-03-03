import type { JSX } from 'react'
import { useSettingsStore } from '@/store/settingsStore'
import type { ThemeMode } from '@/types'
import styles from './ThemeToggle.module.css'

interface ThemeToggleProps {
  className?: string
}

export function ThemeToggle({ className }: ThemeToggleProps): JSX.Element {
  const { themeMode, updateSettings } = useSettingsStore()

  const cycleTheme = (): void => {
    const modes: ThemeMode[] = ['light', 'dark', 'auto']
    const currentIndex = modes.indexOf(themeMode)
    const nextIndex = (currentIndex + 1) % modes.length
    updateSettings({ themeMode: modes[nextIndex] })
  }

  const getIcon = () => {
    switch (themeMode) {
      case 'light':
        return <SunIcon />
      case 'dark':
        return <MoonIcon />
      case 'auto':
        return <SystemIcon />
    }
  }

  return (
    <button
      className={`${styles.toggle} ${className || ''}`}
      onClick={cycleTheme}
      title={`Theme: ${themeMode === 'auto' ? 'System' : themeMode} - Click to toggle`}
    >
      {getIcon()}
    </button>
  )
}

function SunIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function MoonIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SystemIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
