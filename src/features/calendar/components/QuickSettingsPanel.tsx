import type { JSX } from 'react'
import { useNavigate } from 'react-router'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useSettingsStore } from '@/store/settingsStore'
import { useConfigStore } from '@/store/configStore'
import styles from './QuickSettingsPanel.module.css'

interface QuickSettingsPanelProps {
  /**
   * Called after a navigation action ("All settings") fires, so a host that
   * renders this inside a transient popover (e.g. the mobile FAB) can close
   * itself. Optional — the desktop header dropdown doesn't need it.
   */
  onNavigate?: () => void
  /** Hides the "All settings →" footer link — used where the host already has its own settings entry point. */
  hideAllSettingsLink?: boolean
}

/**
 * The shared quick-settings body: theme mode (Auto/Light/Dark), the week-number
 * and hide-completed toggles, and an "All settings" footer. Self-contained —
 * reads and writes through the settings/config stores directly — so it can be
 * dropped into both the desktop header dropdown and the mobile FAB.
 */
export function QuickSettingsPanel({
  onNavigate,
  hideAllSettingsLink,
}: QuickSettingsPanelProps): JSX.Element {
  const navigate = useNavigate()
  const themeMode = useSettingsStore((state) => state.themeMode)
  const showWeekNumbers = useSettingsStore((state) => state.showWeekNumbers)
  const hideCompletedTasksInMonthView = useSettingsStore(
    (state) => state.hideCompletedTasksInMonthView
  )
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const hasPreconfiguredAccounts = useConfigStore((state) => state.hasPreconfiguredAccounts)
  const lock = useConfigStore((state) => state.lock)
  const isMobile = useIsMobile()

  const goToSettings = (): void => {
    navigate('/settings')
    onNavigate?.()
  }

  return (
    <>
      <div className={styles.quickSettingsItem}>
        <span className={styles.quickSettingsLabel}>Theme</span>
        <div
          className={styles.themeModeGroup}
          role="radiogroup"
          aria-label="Theme mode"
          data-component="theme-mode-group"
        >
          {(['auto', 'light', 'dark'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={themeMode === mode}
              className={`${styles.themeModeBtn} ${themeMode === mode ? styles.themeModeActive : ''}`}
              onClick={() => updateSettings({ themeMode: mode })}
              data-component={`theme-mode-${mode}`}
              title={mode === 'auto' ? 'Auto' : mode === 'light' ? 'Light' : 'Dark'}
              aria-label={mode === 'auto' ? 'Auto' : mode === 'light' ? 'Light' : 'Dark'}
            >
              {mode === 'auto' ? (
                <ThemeAutoIcon mobile={isMobile} />
              ) : mode === 'light' ? (
                <ThemeLightIcon />
              ) : (
                <ThemeDarkIcon />
              )}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.quickSettingsItem}>
        <span className={styles.quickSettingsLabel}>Week numbers</span>
        <button
          className={`${styles.toggleSwitch} ${showWeekNumbers ? styles.toggleActive : ''}`}
          onClick={() => updateSettings({ showWeekNumbers: !showWeekNumbers })}
          aria-label="Toggle week numbers"
        >
          <span className={styles.toggleThumb} />
        </button>
      </div>
      <div className={styles.quickSettingsItem}>
        <span className={styles.quickSettingsLabel}>Hide completed tasks</span>
        <button
          className={`${styles.toggleSwitch} ${hideCompletedTasksInMonthView ? styles.toggleActive : ''}`}
          onClick={() =>
            updateSettings({ hideCompletedTasksInMonthView: !hideCompletedTasksInMonthView })
          }
          aria-label="Toggle hide completed tasks"
        >
          <span className={styles.toggleThumb} />
        </button>
      </div>
      {(!hideAllSettingsLink || hasPreconfiguredAccounts) && (
        <>
          <div className={styles.quickSettingsDivider} />
          <div
            className={styles.quickSettingsFooter}
            style={hideAllSettingsLink ? { justifyContent: 'flex-end' } : undefined}
          >
            {!hideAllSettingsLink && (
              <button className={styles.quickSettingsLink} onClick={goToSettings}>
                All settings →
              </button>
            )}
            {hasPreconfiguredAccounts && (
              <button
                className={styles.quickSettingsLock}
                onClick={() => lock()}
                aria-label="Lock Calino"
                title="Lock"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="7" width="10" height="7" rx="2" />
                  <path d="M5 7V5a3 3 0 016 0v2" />
                </svg>
              </button>
            )}
          </div>
        </>
      )}
    </>
  )
}

function ThemeAutoIcon({ mobile }: { mobile: boolean }): JSX.Element {
  if (mobile) {
    return (
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="6" y="2" width="12" height="20" rx="2.5" />
        <path d="M10.5 18.5h3" />
      </svg>
    )
  }
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  )
}

function ThemeLightIcon(): JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  )
}

function ThemeDarkIcon(): JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}
