import type { JSX } from 'react'
import { useState } from 'react'
import { useSettingsStore } from '@/store/settingsStore'
import { showTestNotification, requestNotificationPermission, getNotificationPermission } from '@/lib/notifications'
import styles from './Settings.module.css'

export function NotificationSettings(): JSX.Element {
  const { enableDesktopNotifications, enableSoundAlerts, updateSettings } = useSettingsStore()
  const [permissionStatus, setPermissionStatus] = useState(getNotificationPermission)

  const handleEnableNotifications = async (): Promise<void> => {
    if (permissionStatus === 'default') {
      const newPermission = await requestNotificationPermission()
      setPermissionStatus(newPermission)
      if (newPermission !== 'granted') {
        return
      }
    }
    if (permissionStatus === 'denied') {
      return
    }
    updateSettings({ enableDesktopNotifications: !enableDesktopNotifications })
  }

  const handleTestNotification = async (): Promise<void> => {
    if (permissionStatus === 'default') {
      const newPermission = await requestNotificationPermission()
      setPermissionStatus(newPermission)
      if (newPermission !== 'granted') {
        return
      }
    }
    showTestNotification()
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Notifications</h2>
      <p className={styles.sectionDescription}>
        Configure how you receive event reminders and alerts.
      </p>

      {permissionStatus === 'denied' && (
        <div className={styles.warning}>
          Notifications are blocked. Please enable them in your browser settings.
        </div>
      )}

      <div className={styles.settingRow}>
        <div className={styles.settingLabel}>
          <span className={styles.settingLabelText}>Browser Notifications</span>
          <span className={styles.settingLabelHint}>
            Show notifications for upcoming events and tasks
          </span>
        </div>
        <button
          className={`${styles.toggle} ${enableDesktopNotifications ? styles.active : ''}`}
          onClick={handleEnableNotifications}
          aria-pressed={enableDesktopNotifications}
          disabled={permissionStatus === 'denied'}
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

      <div className={styles.settingRow}>
        <div className={styles.settingLabel}>
          <span className={styles.settingLabelText}>Test Notification</span>
          <span className={styles.settingLabelHint}>
            {permissionStatus === 'default' 
              ? 'Click to enable notifications and test' 
              : permissionStatus === 'denied'
                ? 'Notifications are blocked in browser settings'
                : 'Send a test notification'}
          </span>
        </div>
        <button
          className={styles.button}
          onClick={handleTestNotification}
          disabled={permissionStatus === 'denied'}
        >
          {permissionStatus === 'default' ? 'Enable & Test' : 'Send Test'}
        </button>
      </div>
    </div>
  )
}
