import type { JSX } from 'react'
import { useSettingsStore } from '@/store/settingsStore'
import styles from './Settings.module.css'

export function NotificationSettings(): JSX.Element {
  const { enableDesktopNotifications, enableSoundAlerts, updateSettings } = useSettingsStore()

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Notifications</h2>
      <p className={styles.sectionDescription}>
        Configure how you receive event reminders and alerts.
      </p>

      <div className={styles.settingRow}>
        <div className={styles.settingLabel}>
          <span className={styles.settingLabelText}>Desktop Notifications</span>
          <span className={styles.settingLabelHint}>
            Show browser notifications for upcoming events
          </span>
        </div>
        <button
          className={`${styles.toggle} ${enableDesktopNotifications ? styles.active : ''}`}
          onClick={() =>
            updateSettings({ enableDesktopNotifications: !enableDesktopNotifications })
          }
          aria-pressed={enableDesktopNotifications}
        >
          <span className={styles.toggleKnob} />
        </button>
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingLabel}>
          <span className={styles.settingLabelText}>Sound Alerts</span>
          <span className={styles.settingLabelHint}>
            Play a sound when events are about to start
          </span>
        </div>
        <button
          className={`${styles.toggle} ${enableSoundAlerts ? styles.active : ''}`}
          onClick={() => updateSettings({ enableSoundAlerts: !enableSoundAlerts })}
          aria-pressed={enableSoundAlerts}
        >
          <span className={styles.toggleKnob} />
        </button>
      </div>
    </div>
  )
}
