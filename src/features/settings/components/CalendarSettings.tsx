import type { JSX } from 'react'
import { useSettingsStore, VIEW_OPTIONS, DENSITY_OPTIONS } from '@/store/settingsStore'
import styles from './Settings.module.css'

export function CalendarSettings(): JSX.Element {
  const { defaultView, showWeekNumbers, eventDensity, updateSettings } = useSettingsStore()

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Calendar Display</h2>
      <p className={styles.sectionDescription}>Customize how your calendar looks and behaves.</p>

      <div className={styles.settingRow}>
        <div className={styles.settingLabel}>
          <span className={styles.settingLabelText}>Default View</span>
          <span className={styles.settingLabelHint}>The view shown when you open the calendar</span>
        </div>
        <select
          className={styles.select}
          value={defaultView}
          onChange={(e) =>
            updateSettings({ defaultView: e.target.value as 'month' | 'week' | 'day' | 'agenda' })
          }
        >
          {VIEW_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingLabel}>
          <span className={styles.settingLabelText}>Show Week Numbers</span>
          <span className={styles.settingLabelHint}>Display week numbers in month view</span>
        </div>
        <button
          className={`${styles.toggle} ${showWeekNumbers ? styles.active : ''}`}
          onClick={() => updateSettings({ showWeekNumbers: !showWeekNumbers })}
          aria-pressed={showWeekNumbers}
        >
          <span className={styles.toggleKnob} />
        </button>
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingLabel}>
          <span className={styles.settingLabelText}>Event Display Density</span>
          <span className={styles.settingLabelHint}>Choose how compact event items appear</span>
        </div>
        <select
          className={styles.select}
          value={eventDensity}
          onChange={(e) =>
            updateSettings({ eventDensity: e.target.value as 'comfortable' | 'compact' })
          }
        >
          {DENSITY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
