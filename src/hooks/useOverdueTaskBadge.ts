import { useEffect, useMemo, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import { format } from 'date-fns'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { countOverdueTasks } from '@/lib/taskReminders'
import {
  checkNativeReminderPermission,
  setNativeOverdueBadge,
  clearNativeOverdueBadge,
} from '@/lib/nativeReminders'

// A task turns overdue at midnight, with no store change to announce it, so the
// day is re-read on a timer.
const DAY_CHECK_INTERVAL_MS = 60 * 1000

interface BadgeNavigator {
  setAppBadge?: (count?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

/**
 * Shows the number of overdue tasks on the app icon while the "Overdue Task
 * Badge" setting is on. Mount it only while the setting is on (see
 * OverdueTaskBadge): unmounting is what removes the badge again.
 *
 * On the web that is the Badging API, which installed PWAs on Chromium and
 * Safari support and plain tabs ignore. On Android it is a quiet standing
 * notification (see `setNativeOverdueBadge`), which needs the same permission
 * and master switch as reminders and refreshes whenever the app is open.
 */
export function useOverdueTaskBadge(): void {
  const events = useCalendarStore((state) => state.events)
  const calendars = useCalendarStore((state) => state.calendars)
  const badgeEnabled = useSettingsStore((state) => state.overdueTaskBadge)
  const notificationsEnabled = useSettingsStore((state) => state.enableDesktopNotifications)
  const [today, setToday] = useState(() => format(new Date(), 'yyyy-MM-dd'))

  useEffect(() => {
    if (!badgeEnabled) return
    const id = setInterval(() => setToday(format(new Date(), 'yyyy-MM-dd')), DAY_CHECK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [badgeEnabled])

  const count = useMemo(
    () => (badgeEnabled ? countOverdueTasks(events, calendars ?? [], new Date()) : 0),
    // `today` is the invalidation signal for the day rolling over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [badgeEnabled, events, calendars, today]
  )

  const native = Capacitor.isNativePlatform()
  useEffect(() => {
    if (native) return
    const nav = navigator as BadgeNavigator
    if (typeof nav.setAppBadge !== 'function') return
    // Badging can reject (no permission, not installed); the badge is a nicety.
    const apply = count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge?.()
    void apply?.catch(() => {})
  }, [native, count])

  useEffect(() => {
    if (!native) return
    let cancelled = false
    const sync = async (): Promise<void> => {
      try {
        // Posting needs the OS permission and, like reminders, the master switch.
        const allowed = notificationsEnabled && (await checkNativeReminderPermission())
        if (cancelled) return
        if (allowed) await setNativeOverdueBadge(count)
        else await clearNativeOverdueBadge()
      } catch {
        // The badge is a nicety; a failed post must not break the app.
      }
    }
    void sync()
    // The user can swipe the notification away; coming back re-posts it.
    const listenerPromise = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void sync()
    })
    return () => {
      cancelled = true
      void listenerPromise.then((handle) => handle.remove())
    }
  }, [native, count, notificationsEnabled])

  // The badge outlives the page, so take it down when the hook goes away — which
  // is what turning the setting off does (see OverdueTaskBadge).
  useEffect(
    () => () => {
      const nav = navigator as BadgeNavigator
      const cleared = native ? clearNativeOverdueBadge() : nav.clearAppBadge?.()
      void cleared?.catch(() => {})
    },
    [native]
  )
}
