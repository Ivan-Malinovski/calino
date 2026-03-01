import type { JSX } from 'react'
import {
  useSettingsStore,
  TIMEZONE_OPTIONS,
  DATE_FORMAT_OPTIONS,
  TIME_FORMAT_OPTIONS,
  FIRST_DAY_OPTIONS,
} from '@/store/settingsStore'
import styles from './Settings.module.css'

export function GeneralSettings(): JSX.Element {
  const { timezone, dateFormat, timeFormat, firstDayOfWeek, updateSettings } = useSettingsStore()

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>General</h2>
      <p className={styles.sectionDescription}>
        Configure how dates and times are displayed in your calendar.
      </p>

      <div className={styles.settingRow}>
        <div className={styles.settingLabel}>
          <span className={styles.settingLabelText}>Timezone</span>
          <span className={styles.settingLabelHint}>
            All events will be displayed in this timezone
          </span>
        </div>
        <select
          className={styles.select}
          value={timezone}
          onChange={(e) => updateSettings({ timezone: e.target.value })}
        >
          {TIMEZONE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingLabel}>
          <span className={styles.settingLabelText}>Date Format</span>
          <span className={styles.settingLabelHint}>How dates appear throughout the app</span>
        </div>
        <select
          className={styles.select}
          value={dateFormat}
          onChange={(e) =>
            updateSettings({
              dateFormat: e.target.value as 'MM/dd/yyyy' | 'dd/MM/yyyy' | 'yyyy-MM-dd',
            })
          }
        >
          {DATE_FORMAT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingLabel}>
          <span className={styles.settingLabelText}>Time Format</span>
          <span className={styles.settingLabelHint}>12-hour or 24-hour time display</span>
        </div>
        <select
          className={styles.select}
          value={timeFormat}
          onChange={(e) => updateSettings({ timeFormat: e.target.value as '12h' | '24h' })}
        >
          {TIME_FORMAT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingLabel}>
          <span className={styles.settingLabelText}>First Day of Week</span>
          <span className={styles.settingLabelHint}>Start of the week in week and day views</span>
        </div>
        <select
          className={styles.select}
          value={firstDayOfWeek}
          onChange={(e) =>
            updateSettings({ firstDayOfWeek: Number(e.target.value) as 0 | 1 | 2 | 3 | 4 | 5 | 6 })
          }
        >
          {FIRST_DAY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
