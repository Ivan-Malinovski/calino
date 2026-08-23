import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { Modal } from '@/components/common/Modal'
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
  const { t } = useTranslation('settings')
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
  const [showMirrorInfo, setShowMirrorInfo] = useState(false)

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
      <h1 className={styles.pageTitle}>{t('notifications.title')}</h1>

      <div className={styles.group}>
        <div className={styles.groupLabel}>{t('notifications.events')}</div>
        <div
          className={styles.row}
          data-component="setting-row"
          data-setting="desktop-notifications"
          data-value={String(enableDesktopNotifications)}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('notifications.eventReminders.label')}</div>
            <div className={styles.rowDesc}>{t('notifications.eventReminders.desc')}</div>
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
                aria-label={t('notifications.eventReminders.ariaLabel')}
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
            <div className={styles.rowLabel}>{t('notifications.soundAlerts.label')}</div>
            <div className={styles.rowDesc}>{t('notifications.soundAlerts.desc')}</div>
          </div>
          <div className={styles.rowControl}>
            <label className={styles.toggle} data-component="toggle" data-setting="sound-alerts">
              <input
                type="checkbox"
                checked={enableSoundAlerts}
                aria-label={t('notifications.soundAlerts.ariaLabel')}
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
          <div className={styles.groupLabel}>{t('notifications.deviceCalendar')}</div>
          <div
            className={styles.row}
            data-component="setting-row"
            data-setting="calendar-mirror"
            data-value={String(enableCalendarMirror)}
          >
            <div className={styles.rowInfo}>
              <div className={styles.rowLabel}>{t('notifications.calendarMirror.label')}</div>
              <div className={styles.rowDesc}>
                {!enableCalendarMirror
                  ? t('notifications.calendarMirror.descOff')
                  : mirrorStatus === 'active'
                    ? t('notifications.calendarMirror.descActive')
                    : mirrorStatus === 'no-calendar-app'
                      ? t('notifications.calendarMirror.descNoCalendarApp')
                      : mirrorStatus === 'denied'
                        ? t('notifications.calendarMirror.descDenied')
                        : mirrorStatus === 'failed'
                          ? mirrorError ? t('notifications.calendarMirror.descFailed', { error: mirrorError }) : t('notifications.calendarMirror.descFailedNoDetail')
                          : t('notifications.calendarMirror.descSyncing')}
              </div>
            </div>
            <div className={styles.rowControl}>
              <label
                className={styles.toggle}
                data-component="toggle"
                data-setting="calendar-mirror"
              >
                <input
                  type="checkbox"
                  checked={enableCalendarMirror}
                  aria-label={t('notifications.calendarMirror.ariaLabel')}
                  onChange={handleToggleCalendarMirror}
                />
                <span className={styles.pill} />
                <span className={styles.knob} />
              </label>
            </div>
          </div>
          <div
            className={styles.row}
            data-component="setting-row"
            data-setting="calendar-mirror-info"
          >
            <div className={styles.rowInfo}>
              <div className={styles.rowLabel}>{t('notifications.calendarMirrorInfo.label')}</div>
              <div className={styles.rowDesc}>
                {t('notifications.calendarMirrorInfo.desc')}
              </div>
            </div>
            <div className={styles.rowControl}>
              <button
                className={styles.actionBtn}
                onClick={() => setShowMirrorInfo(true)}
                data-component="action-button"
                data-action="calendar-mirror-info"
                type="button"
              >
                {t('notifications.calendarMirrorInfo.learnMore')}
              </button>
            </div>
          </div>
        </div>
      )}

      <Modal
        isOpen={showMirrorInfo}
        onClose={() => setShowMirrorInfo(false)}
        title={t('notifications.calendarMirrorModal.title')}
      >
        <div className={styles.infoBody}>
          <p>
            {t('notifications.calendarMirrorModal.intro')}
          </p>

          <div className={styles.infoSection}>
            <h3>{t('notifications.calendarMirrorModal.reliabilityTitle')}</h3>
            <p>{t('notifications.calendarMirrorModal.reliabilityP1')}</p>
            <p>{t('notifications.calendarMirrorModal.reliabilityP2')}</p>
          </div>

          <div className={styles.infoSection}>
            <h3>{t('notifications.calendarMirrorModal.oneWayTitle')}</h3>
            <ul>
              <li>{t('notifications.calendarMirrorModal.oneWayItem1')}</li>
              <li>{t('notifications.calendarMirrorModal.oneWayItem2')}</li>
              <li>{t('notifications.calendarMirrorModal.oneWayItem3')}</li>
            </ul>
          </div>

          <div className={styles.infoSection}>
            <h3>{t('notifications.calendarMirrorModal.stayingUpToDateTitle')}</h3>
            <p>{t('notifications.calendarMirrorModal.stayingUpToDateP1')}</p>
          </div>

          <div className={styles.infoSection}>
            <h3>{t('notifications.calendarMirrorModal.betaTitle')}</h3>
            <p>{t('notifications.calendarMirrorModal.betaP1')}</p>
            <p>{t('notifications.calendarMirrorModal.betaP2')}</p>
          </div>
        </div>
      </Modal>

      <div className={styles.group}>
        <div className={styles.groupLabel}>{t('notifications.tasks')}</div>
        <div
          className={styles.row}
          data-component="setting-row"
          data-setting="task-due-date-reminders"
          data-value={String(taskDueDateReminders)}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('notifications.taskDueDateReminders.label')}</div>
            <div className={styles.rowDesc}>{t('notifications.taskDueDateReminders.desc')}</div>
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
                aria-label={t('notifications.taskDueDateReminders.ariaLabel')}
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
            <div className={styles.rowLabel}>{t('notifications.overdueTaskBadge.label')}</div>
            <div className={styles.rowDesc}>{t('notifications.overdueTaskBadge.desc')}</div>
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
                aria-label={t('notifications.overdueTaskBadge.ariaLabel')}
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
          <div className={styles.rowLabel}>{t('notifications.test.label')}</div>
            <div className={styles.rowDesc}>
              {permissionStatus === 'default'
                ? t('notifications.test.descDefault')
                : permissionStatus === 'denied'
                  ? t('notifications.test.descDenied')
                  : t('notifications.test.descReady')}
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
              {permissionStatus === 'default' ? t('notifications.test.enableAndTest') : t('notifications.test.sendTest')}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
