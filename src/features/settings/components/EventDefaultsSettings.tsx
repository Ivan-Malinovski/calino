import type { JSX } from 'react'
import {
  useSettingsStore,
  DURATION_OPTIONS,
  REMINDER_OPTIONS,
  EVENT_COLORS,
} from '@/store/settingsStore'
import styles from './Settings.module.css'

export function EventDefaultsSettings(): JSX.Element {
  const { defaultDuration, defaultReminderMinutes, defaultEventColor, updateSettings } =
    useSettingsStore()

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Event Defaults</h2>
      <p className={styles.sectionDescription}>Set default values for new events.</p>

      <div className={styles.settingRow}>
        <div className={styles.settingLabel}>
          <span className={styles.settingLabelText}>Default Duration</span>
          <span className={styles.settingLabelHint}>
            Duration for events without a specified end time
          </span>
        </div>
        <select
          className={styles.select}
          value={defaultDuration}
          onChange={(e) =>
            updateSettings({ defaultDuration: Number(e.target.value) as 15 | 30 | 60 | 90 | 120 })
          }
        >
          {DURATION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingLabel}>
          <span className={styles.settingLabelText}>Default Reminder</span>
          <span className={styles.settingLabelHint}>When to remind you about upcoming events</span>
        </div>
        <select
          className={styles.select}
          value={defaultReminderMinutes}
          onChange={(e) => updateSettings({ defaultReminderMinutes: Number(e.target.value) })}
        >
          {REMINDER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingLabel}>
          <span className={styles.settingLabelText}>Default Event Color</span>
          <span className={styles.settingLabelHint}>Color applied to new events by default</span>
        </div>
        <div className={styles.colorPicker}>
          {EVENT_COLORS.map((color) => (
            <button
              key={color}
              className={`${styles.colorSwatch} ${defaultEventColor === color ? styles.selected : ''}`}
              style={{ backgroundColor: color }}
              onClick={() => updateSettings({ defaultEventColor: color })}
              aria-label={`Select color ${color}`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
