import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Capacitor } from '@capacitor/core'
import { useSettingsStore } from '@/store/settingsStore'
import {
  showTestNotification,
  requestNotificationPermission,
  getNotificationPermission,
} from '@/lib/notifications'
import {
  requestNativeReminderPermission,
  checkNativeReminderPermission,
  scheduleTestReminder,
} from '@/lib/nativeReminders'
import {
  isCalendarMirrorSupported,
  checkCalendarMirrorPermission,
  requestCalendarMirrorPermission,
} from '@/lib/calendarMirror'
import { useCalendarMirrorStore } from '@/store/calendarMirrorStore'
import styles from './Settings.module.css'

// R3.9 — copy reused by both the toggle and the test button when the
// browser denies the permission prompt. Surfaced to the user instead of
// silently doing nothing.
const PERMISSION_DENIED_TOAST =
  'Notifications are blocked. Update site permissions in your browser settings to enable reminders.'

const isNative = Capacitor.isNativePlatform()
const supportsCalendarMirror = isCalendarMirrorSupported()

const CALENDAR_PERMISSION_DENIED_TOAST =
  'Calendar access is blocked. Grant it in Android app settings to sync events to your device calendar.'

export function NotificationSettings(): JSX.Element {
  const enableDesktopNotifications = useSettingsStore((s) => s.enableDesktopNotifications)
  const enableCalendarMirror = useSettingsStore((s) => s.enableCalendarMirror)
  const mirrorStatus = useCalendarMirrorStore((s) => s.status)
  const mirrorError = useCalendarMirrorStore((s) => s.lastError)
  const enableSoundAlerts = useSettingsStore((s) => s.enableSoundAlerts)
  const taskDueDateReminders = useSettingsStore((s) => s.taskDueDateReminders)
  const overdueTaskBadge = useSettingsStore((s) => s.overdueTaskBadge)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const [permissionStatus, setPermissionStatus] = useState(
    isNative ? 'default' : getNotificationPermission()
  )

  useEffect(() => {
    if (!isNative) return
    checkNativeReminderPermission().then((granted) => {
      if (granted) setPermissionStatus('granted')
    })
  }, [])

  const handleEnableNotifications = async (): Promise<void> => {
    if (permissionStatus === 'default') {
      const newPermission = isNative
        ? (await requestNativeReminderPermission())
          ? 'granted'
          : 'denied'
        : await requestNotificationPermission()
      setPermissionStatus(newPermission)
      if (newPermission === 'denied') {
        toast.error(PERMISSION_DENIED_TOAST, { duration: 8000 })
        return
      }
      if (newPermission !== 'granted') {
        return
      }
    }
    if (permissionStatus === 'denied') {
      toast.error(PERMISSION_DENIED_TOAST, { duration: 8000 })
      return
    }
    updateSettings({ enableDesktopNotifications: !enableDesktopNotifications })
  }

  const handleToggleCalendarMirror = async (): Promise<void> => {
    if (enableCalendarMirror) {
      // Turning it off tears the mirrored calendars back down — see
      // useCalendarMirror. No permission needed to stop.
      updateSettings({ enableCalendarMirror: false })
      return
    }
    const granted =
      (await checkCalendarMirrorPermission()) || (await requestCalendarMirrorPermission())
    if (!granted) {
      toast.error(CALENDAR_PERMISSION_DENIED_TOAST, { duration: 8000 })
      return
    }
    updateSettings({ enableCalendarMirror: true })
  }

  const handleTestNotification = async (): Promise<void> => {
    if (permissionStatus === 'default') {
      const newPermission = isNative
        ? (await requestNativeReminderPermission())
          ? 'granted'
          : 'denied'
        : await requestNotificationPermission()
      setPermissionStatus(newPermission)
      if (newPermission === 'denied') {
        toast.error(PERMISSION_DENIED_TOAST, { duration: 8000 })
        return
      }
      if (newPermission !== 'granted') {
        return
      }
    }
    if (permissionStatus === 'denied') {
      toast.error(PERMISSION_DENIED_TOAST, { duration: 8000 })
      return
    }
    if (isNative) {
      void scheduleTestReminder()
    } else {
      showTestNotification()
    }
  }

  return (
    <section
      className={`${styles.section} ${styles.sectionActive}`}
      data-component="notification-settings"
    >
      <h1 className={styles.pageTitle}>Notifications</h1>

      <div className={styles.group}>
        <div className={styles.groupLabel}>Events</div>
        <div
          className={styles.row}
          data-component="setting-row"
          data-setting="desktop-notifications"
          data-value={String(enableDesktopNotifications)}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>Event Reminders</div>
            <div className={styles.rowDesc}>Get notified before events start</div>
          </div>
          <div className={styles.rowControl}>
            <label
              className={styles.toggle}
              data-component="toggle"
              data-setting="desktop-notifications"
            >
              <input
                type="checkbox"
                checked={enableDesktopNotifications}
                aria-label="Event reminders"
                onChange={handleEnableNotifications}
                disabled={permissionStatus === 'denied'}
              />
              <span className={styles.pill} />
              <span className={styles.knob} />
            </label>
          </div>
        </div>
        <div
          className={`${styles.row} ${!enableDesktopNotifications ? styles.rowDisabled : ''}`}
          data-component="setting-row"
          data-setting="sound-alerts"
          data-value={String(enableSoundAlerts)}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>Sound Alerts</div>
            <div className={styles.rowDesc}>Play a sound when events are about to start</div>
          </div>
          <div className={styles.rowControl}>
            <label className={styles.toggle} data-component="toggle" data-setting="sound-alerts">
              <input
                type="checkbox"
                checked={enableSoundAlerts}
                aria-label="Sound alerts"
                onChange={() => updateSettings({ enableSoundAlerts: !enableSoundAlerts })}
              />
              <span className={styles.pill} />
              <span className={styles.knob} />
            </label>
          </div>
        </div>
      </div>

      {supportsCalendarMirror && (
        <div className={styles.group}>
          <div className={styles.groupLabel}>Device calendar</div>
          <div
            className={styles.row}
            data-component="setting-row"
            data-setting="calendar-mirror"
            data-value={String(enableCalendarMirror)}
          >
            <div className={styles.rowInfo}>
              <div className={styles.rowLabel}>Sync to Android Calendar</div>
              <div className={styles.rowDesc}>
                {!enableCalendarMirror
                  ? 'Copy your events into the device calendar so Android delivers reminders even when Calino is closed, and widgets, Wear OS and Android Auto can see them. Read-only — nothing is written back to your CalDAV server.'
                  : mirrorStatus === 'active'
                    ? 'Android is delivering your reminders. Events are visible to widgets, Wear OS and Android Auto.'
                    : mirrorStatus === 'no-calendar-app'
                      ? 'Events are synced, but no calendar app is installed to raise reminders — Calino is still handling those itself.'
                      : mirrorStatus === 'denied'
                        ? 'Calendar access is unavailable. Re-grant it in Android app settings.'
                        : mirrorStatus === 'failed'
                          ? `Could not write to the device calendar${mirrorError ? `: ${mirrorError}` : '.'}`
                          : 'Syncing…'}
              </div>
            </div>
            <div className={styles.rowControl}>
              <label className={styles.toggle} data-component="toggle" data-setting="calendar-mirror">
                <input
                  type="checkbox"
                  checked={enableCalendarMirror}
                  aria-label="Sync to Android Calendar"
                  onChange={handleToggleCalendarMirror}
                />
                <span className={styles.pill} />
                <span className={styles.knob} />
              </label>
            </div>
          </div>
        </div>
      )}

      <div className={styles.group}>
        <div className={styles.groupLabel}>Tasks</div>
        <div
          className={styles.row}
          data-component="setting-row"
          data-setting="task-due-date-reminders"
          data-value={String(taskDueDateReminders)}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>Task Due Date Reminders</div>
            <div className={styles.rowDesc}>Notify when a task&apos;s due date arrives</div>
          </div>
          <div className={styles.rowControl}>
            <label
              className={styles.toggle}
              data-component="toggle"
              data-setting="task-due-date-reminders"
            >
              <input
                type="checkbox"
                checked={taskDueDateReminders}
                aria-label="Task due date reminders"
                onChange={() => updateSettings({ taskDueDateReminders: !taskDueDateReminders })}
              />
              <span className={styles.pill} />
              <span className={styles.knob} />
            </label>
          </div>
        </div>
        <div
          className={styles.row}
          data-component="setting-row"
          data-setting="overdue-task-badge"
          data-value={String(overdueTaskBadge)}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>Overdue Task Badge</div>
            <div className={styles.rowDesc}>Show a badge on the app icon for overdue tasks</div>
          </div>
          <div className={styles.rowControl}>
            <label
              className={styles.toggle}
              data-component="toggle"
              data-setting="overdue-task-badge"
            >
              <input
                type="checkbox"
                checked={overdueTaskBadge}
                aria-label="Overdue task badge"
                onChange={() => updateSettings({ overdueTaskBadge: !overdueTaskBadge })}
              />
              <span className={styles.pill} />
              <span className={styles.knob} />
            </label>
          </div>
        </div>
      </div>

      <div className={styles.group}>
        <div className={styles.row} data-component="setting-row" data-setting="test-notification">
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>Test Notification</div>
            <div className={styles.rowDesc}>
              {permissionStatus === 'default'
                ? 'Click to enable notifications and test'
                : permissionStatus === 'denied'
                  ? 'Notifications are blocked in browser settings'
                  : 'Send a test notification'}
            </div>
          </div>
          <div className={styles.rowControl}>
            <button
              className={styles.actionBtn}
              onClick={handleTestNotification}
              disabled={permissionStatus === 'denied'}
              data-component="action-button"
              data-action="test-notification"
              type="button"
            >
              {permissionStatus === 'default' ? 'Enable & Test' : 'Send Test'}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
