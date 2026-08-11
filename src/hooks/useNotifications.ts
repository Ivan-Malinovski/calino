import { useEffect, useMemo, useRef } from 'react'
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import {
  showNotification,
  createNotificationId,
  getDueSnoozedReminders,
  snoozeReminder,
  getEffectiveReminders,
} from '@/lib/notifications'
import {
  registerReminderActions,
  reconcileNativeReminders,
  listenForReminderActions,
  checkNativeReminderPermission,
  cancelAllNativeReminders,
} from '@/lib/nativeReminders'
import { useCalendarMirrorStore, mirrorOwnsReminders } from '@/store/calendarMirrorStore'
import { parseISO, isWithinInterval, addMinutes, addHours, addDays, isAfter } from 'date-fns'
import { toast } from 'sonner'
import type { CalendarEvent } from '@/types'

const CHECK_INTERVAL_MS = 60 * 1000
// How far ahead to expand recurring series when scheduling reminders. Reminders
// used to be read straight off the stored event, which for a recurring series is
// the master DTSTART — so a weekly standup got exactly one reminder ever, and
// none at all once that first occurrence was in the past.
const REMINDER_HORIZON_DAYS = 30
// Coalesce reconciliation while a sync is streaming events in. Each
// reconcile cancels and reschedules every pending OS notification, so running
// it once per stored event turns a sync into hundreds of bridge round-trips.
const RECONCILE_DEBOUNCE_MS = 1500
// R5.1 — when the page is closed (laptop sleep, app backgrounded, etc.)
// and then reopened, also fire reminders whose trigger time was in the
// last 12 hours but never recorded as shown. The 12h window matches the
// most common "I missed an all-day event" complaint without spamming on
// long-idle browsers.
const CATCH_UP_WINDOW_HOURS = 12

/**
 * The events reminders should actually be scheduled against: recurring series
 * expanded into individual occurrences across the reminder horizon.
 *
 * Each occurrence carries the synthetic `${masterId}-${occurrenceKey}` id from
 * the store's expansion, so occurrences get distinct notification ids and don't
 * collapse onto one another.
 */
function useReminderOccurrences(events: CalendarEvent[]): CalendarEvent[] {
  return useMemo(() => {
    const now = new Date()
    // Reach back over the catch-up window so a missed occurrence can still fire.
    const from = addHours(now, -CATCH_UP_WINDOW_HOURS).toISOString()
    const to = addDays(now, REMINDER_HORIZON_DAYS).toISOString()
    return useCalendarStore.getState().getEventsForDateRange(from, to)
    // `events` is the invalidation signal for the store's expansion cache.
  }, [events])
}

export function useNotifications(): void {
  const events = useCalendarStore((state) => state.events)
  const reminderEvents = useReminderOccurrences(events)
  const enableNotifications = useSettingsStore((state) => state.enableDesktopNotifications)
  // When the Android calendar mirror is active the OS alarms our events off
  // CalendarContract, which works with the app closed — strictly better than
  // what we can schedule ourselves. Standing down avoids double notifications.
  const mirrorStatus = useCalendarMirrorStore((state) => state.status)
  const providerOwnsReminders = mirrorOwnsReminders(mirrorStatus)
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
    let debounceId: ReturnType<typeof setTimeout> | undefined
    // The app setting being on doesn't mean the OS permission is actually
    // granted — a fresh install/reinstall resets Android's permission state
    // independent of the app's own persisted settings, and schedule() throws
    // if it's not granted yet. Check for real before ever calling it.
    const reconcileIfPermitted = async (): Promise<void> => {
      // With the mirror active the calendar provider alarms these events, so
      // scheduling our own would double-notify. Drop what we already queued
      // (this also covers the moment the mirror first becomes active) and
      // leave the queue empty until it stops being active.
      if (providerOwnsReminders) {
        await cancelAllNativeReminders()
        return
      }
      const granted = await checkNativeReminderPermission()
      if (granted && !cancelled) await reconcileNativeReminders(reminderEvents)
    }
    // Debounced because this effect re-runs on every event mutation, and a sync
    // writes events one at a time.
    const scheduleReconcile = (): void => {
      clearTimeout(debounceId)
      debounceId = setTimeout(() => {
        if (!cancelled) void reconcileIfPermitted()
      }, RECONCILE_DEBOUNCE_MS)
    }

    void registerReminderActions()
    scheduleReconcile()
    const removeListener = listenForReminderActions()

    const appStateListenerPromise = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      // Returning to the foreground is a user-visible moment, not a write
      // storm — reconcile immediately rather than waiting out the debounce.
      if (isActive && !cancelled) void reconcileIfPermitted()
    })

    return () => {
      cancelled = true
      clearTimeout(debounceId)
      removeListener()
      void appStateListenerPromise.then((handle) => handle.remove())
    }
  }, [reminderEvents, enableNotifications, providerOwnsReminders])

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

      reminderEvents.forEach((event) => {
        const reminders = getEffectiveReminders(event)

        if (reminders.length === 0) return

        reminders.forEach((reminder) => {
          const reminderTime = parseISO(event.start)
          reminderTime.setMinutes(reminderTime.getMinutes() - reminder.minutesBefore)

          const reminderId = createNotificationId(event.id, reminder.id)
          const triggerTimestamp = reminderTime.getTime()
          const previousTimestamp = shownReminders.current.get(reminderId)
          const neverShown = previousTimestamp === undefined

          const inLiveWindow = isWithinInterval(reminderTime, {
            start: checkWindowStart,
            end: checkWindowEnd,
          })
          // R5.1 — catch-up window: trigger in (catchUpCutoff, checkWindowStart)
          // and never shown. The neverShown gate prevents re-firing on
          // app reloads if the map was already cleared or evicted; we
          // only catch up for triggers that genuinely slipped through
          // (machine was asleep).
          const inCatchUpWindow =
            neverShown &&
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

            const body = event.isAllDay ? `Starting today` : `Starting at ${timeStr}`

            showNotification(event.title, body, event.id, event.start)

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
  }, [reminderEvents, enableNotifications])
}
