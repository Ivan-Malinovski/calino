import { useEffect, useRef } from 'react'
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { showNotification, createNotificationId, getDueSnoozedReminders, snoozeReminder, getEffectiveReminders } from '@/lib/notifications'
import {
  registerReminderActions,
  reconcileNativeReminders,
  listenForReminderActions,
  checkNativeReminderPermission,
} from '@/lib/nativeReminders'
import { parseISO, isWithinInterval, addMinutes, addHours, isAfter } from 'date-fns'
import { toast } from 'sonner'

const CHECK_INTERVAL_MS = 60 * 1000
// R5.1 — when the page is closed (laptop sleep, app backgrounded, etc.)
// and then reopened, also fire reminders whose trigger time was in the
// last 12 hours but never recorded as shown. The 12h window matches the
// most common "I missed an all-day event" complaint without spamming on
// long-idle browsers.
const CATCH_UP_WINDOW_HOURS = 12

export function useNotifications(): void {
  const events = useCalendarStore((state) => state.events)
  const enableNotifications = useSettingsStore((state) => state.enableDesktopNotifications)
  const defaultReminderMinutes = useSettingsStore((state) => state.defaultReminderMinutes)
  // Track reminder ID → scheduled trigger timestamp so we can re-fire
  // when the event is edited (trigger time changes).
  const shownReminders = useRef<Map<string, number>>(new Map())
  // Track previous enableNotifications to detect disable→enable transitions.
  const prevEnabledRef = useRef(enableNotifications)

  // Native: real OS-scheduled notifications (fire even with the app closed),
  // replacing the setInterval-based polling below, which only runs while the
  // app is open and foregrounded (see the visibilitychange handling further
  // down) — that's fine on web but useless for a backgrounded mobile app.
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !enableNotifications) return

    let cancelled = false
    // The app setting being on doesn't mean the OS permission is actually
    // granted — a fresh install/reinstall resets Android's permission state
    // independent of the app's own persisted settings, and schedule() throws
    // if it's not granted yet. Check for real before ever calling it.
    const reconcileIfPermitted = async (): Promise<void> => {
      const granted = await checkNativeReminderPermission()
      if (granted && !cancelled) await reconcileNativeReminders(events, defaultReminderMinutes)
    }

    void registerReminderActions()
    void reconcileIfPermitted()
    const removeListener = listenForReminderActions()

    const appStateListenerPromise = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive && !cancelled) void reconcileIfPermitted()
    })

    return () => {
      cancelled = true
      removeListener()
      void appStateListenerPromise.then((handle) => handle.remove())
    }
  }, [events, enableNotifications, defaultReminderMinutes])

  useEffect(() => {
    prevEnabledRef.current = enableNotifications

    if (Capacitor.isNativePlatform()) return

    if (!enableNotifications) {
      // Stop checking but do NOT clear the map — preserve already-fired
      // reminders so they don't duplicate when re-enabled.
      return
    }

    // On a fresh disable→enable transition the map is intentionally kept
    // so that reminders outside the check window are not re-shown.
    // The map only evicts entries when the trigger time changes (event edit).

    if (!('Notification' in window) || Notification.permission !== 'granted') {
      return
    }

    const checkReminders = (): void => {
      const now = new Date()
      const checkWindowStart = addMinutes(now, -1)
      const checkWindowEnd = addMinutes(now, 1)
      // R5.1 — also accept triggers in the last 12h that have never been
      // shown. This handles laptop sleep / app backgrounded scenarios
      // where the 1-minute window would have been missed. The condition
      // below uses the `neverShown` flag (instead of expanding the
      // checkWindowStart) so the 1-minute window still applies to
      // re-shown triggers (event edits), preserving the dedup contract.
      // The catch-up window is non-empty whenever CATCH_UP_WINDOW_HOURS
      // > 1 minute (always true with the 12h default), so we skip the
      // redundant `isAfter(catchUpCutoff, ...)` guard and just rely on
      // the two `isAfter` checks in the inner loop to bound the window.
      const catchUpCutoff = addHours(now, -CATCH_UP_WINDOW_HOURS)

      events.forEach((event) => {
        const reminders = getEffectiveReminders(event, defaultReminderMinutes)

        if (reminders.length === 0) return

        reminders.forEach((reminder) => {
          const reminderTime = parseISO(event.start)
          reminderTime.setMinutes(reminderTime.getMinutes() - reminder.minutesBefore)

          const reminderId = createNotificationId(event.id, reminder.id)
          const triggerTimestamp = reminderTime.getTime()
          const previousTimestamp = shownReminders.current.get(reminderId)
          const neverShown = previousTimestamp === undefined

          const inLiveWindow = isWithinInterval(reminderTime, { start: checkWindowStart, end: checkWindowEnd })
          // R5.1 — catch-up window: trigger in (catchUpCutoff, checkWindowStart)
          // and never shown. The neverShown gate prevents re-firing on
          // app reloads if the map was already cleared or evicted; we
          // only catch up for triggers that genuinely slipped through
          // (machine was asleep).
          const inCatchUpWindow = neverShown &&
            isAfter(reminderTime, catchUpCutoff) &&
            isAfter(checkWindowStart, reminderTime)

          const shouldFire =
            (inLiveWindow || inCatchUpWindow) &&
            // Fire if never shown, or if the trigger time changed (event was edited)
            (neverShown || previousTimestamp !== triggerTimestamp)

          if (shouldFire) {
            shownReminders.current.set(reminderId, triggerTimestamp)

            const timeStr = event.isAllDay 
              ? 'All day' 
              : parseISO(event.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
            
            const body = event.isAllDay 
              ? `Starting today` 
              : `Starting at ${timeStr}`

            showNotification(
              event.title,
              body,
              event.id,
              event.start
            )

            // Show in-app snooze toast
            toast(`⏰ ${event.title}`, {
              description: body,
              duration: 10000,
              action: {
                label: 'Snooze 5m',
                onClick: () => {
                  snoozeReminder(event.id, event.start, event.title, body, 5)
                },
              },
            })
          }
        })
      })
    }

    const checkSnoozed = (): void => {
      const due = getDueSnoozedReminders()
      due.forEach((snoozed) => {
        showNotification(snoozed.title, snoozed.body, snoozed.eventId, snoozed.eventDate)
        toast(`⏰ ${snoozed.title}`, {
          description: snoozed.body,
          duration: 8000,
          action: {
            label: 'View',
            onClick: () => {
              const eventDateStr = snoozed.eventDate.split('T')[0]
              window.location.href = `/?date=${eventDateStr}&event=${snoozed.eventId}`
            },
          },
        })
      })
    }

    checkReminders()
    checkSnoozed()
    let intervalId = setInterval(() => {
      checkReminders()
      checkSnoozed()
    }, CHECK_INTERVAL_MS)

    // Pause polling when tab is hidden to save CPU
    const handleVisibilityChange = (): void => {
      if (document.hidden) {
        clearInterval(intervalId)
      } else {
        // Resume and check immediately when tab becomes visible
        checkReminders()
        checkSnoozed()
        intervalId = setInterval(() => {
          checkReminders()
          checkSnoozed()
        }, CHECK_INTERVAL_MS)
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [events, enableNotifications, defaultReminderMinutes])
}

export function useRequestNotificationPermission(): {
  permission: NotificationPermission
  request: () => Promise<NotificationPermission>
} {
  const enableNotifications = useSettingsStore((state) => state.enableDesktopNotifications)
  const updateSettings = useSettingsStore((state) => state.updateSettings)

  useEffect(() => {
    if (enableNotifications && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission().then((permission) => {
          if (permission === 'denied') {
            // R3.9 — surface the cause instead of silently flipping the
            // setting off. Without this, the user flips the toggle on,
            // nothing happens, and they assume the app is broken.
            updateSettings({ enableDesktopNotifications: false })
            toast.error(
              'Notifications are blocked. Update site permissions in your browser settings to enable reminders.',
              { duration: 8000 }
            )
          }
        })
      } else if (Notification.permission === 'denied') {
        // Permission was previously denied — sync the setting
        updateSettings({ enableDesktopNotifications: false })
        toast.error(
          'Notifications are blocked. Update site permissions in your browser settings to enable reminders.',
          { duration: 8000 }
        )
      }
    }
  }, [enableNotifications, updateSettings])

  return {
    permission: 'Notification' in window ? Notification.permission : 'denied',
    request: () => Notification.requestPermission(),
  }
}
