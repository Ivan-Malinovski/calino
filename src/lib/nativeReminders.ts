import { LocalNotifications } from '@capacitor/local-notifications'
import { addMinutes, parseISO } from 'date-fns'
import { toEventInstant, formatTime } from '@/lib/datetime'
import type { CalendarEvent } from '@/types'
import { getEffectiveReminders } from './notifications'
import { openEventDeepLink } from './deepLink'
import { useSettingsStore } from '@/store/settingsStore'
import i18n from './i18n'

const REMINDER_ACTION_TYPE = 'REMINDER_ACTIONS'
const SNOOZE_ACTION_ID = 'snooze-5'

/** Deterministic string → positive 32-bit int, since the plugin requires a
 * numeric notification id. Recomputing the same id from (eventId, reminderId)
 * lets us diff against currently-pending notifications without keeping our
 * own id-mapping storage. */
export function hashToInt32(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

export async function requestNativeReminderPermission(): Promise<boolean> {
  const result = await LocalNotifications.requestPermissions()
  return result.display === 'granted'
}

export async function checkNativeReminderPermission(): Promise<boolean> {
  const result = await LocalNotifications.checkPermissions()
  return result.display === 'granted'
}

export async function scheduleTestReminder(): Promise<void> {
  const timeStr = formatTime(new Date(), useSettingsStore.getState().timeFormat)
  await LocalNotifications.schedule({
    notifications: [
      {
        id: hashToInt32(`test:${Date.now()}`),
        title: i18n.t('errors:reminder.testNotificationTitle'),
        body: i18n.t('errors:reminder.testNotificationBody', { time: timeStr }),
        schedule: { at: addMinutes(new Date(), 0.1) },
      },
    ],
  })
}

export async function registerReminderActions(): Promise<void> {
  await LocalNotifications.registerActionTypes({
    types: [
      { id: REMINDER_ACTION_TYPE, actions: [{ id: SNOOZE_ACTION_ID, title: i18n.t('errors:reminder.snooze5m') }] },
    ],
  })
}

/**
 * The true instant a reminder should fire for an event. TZID events store
 * naive wall clocks in the event zone, so they must be resolved through
 * toEventInstant (a trailing-Z start is already a genuine instant and passes
 * through unchanged). All-day events keep their calendar-date behavior — no
 * conversion, because toEventInstant would shift a date-only value a day
 * west of UTC.
 */
export function reminderInstant(event: CalendarEvent, minutesBefore: number): Date {
  const start = event.isAllDay ? parseISO(event.start) : toEventInstant(event.start, event.timezone)
  return new Date(start.getTime() - minutesBefore * 60_000)
}

/**
 * Device-local display of the event's start time, resolved through
 * toEventInstant for TZID events. Returns 'All day' for all-day events.
 */
export function reminderBodyTime(event: CalendarEvent): string {
  if (event.isAllDay) return i18n.t('errors:reminder.allDay')
  return formatTime(toEventInstant(event.start, event.timezone), useSettingsStore.getState().timeFormat)
}

export function reminderBody(event: CalendarEvent): string {
  if (event.isAllDay) return i18n.t('errors:reminder.startingToday')
  return i18n.t('errors:reminder.startingAt', { time: reminderBodyTime(event) })
}

export async function reconcileNativeReminders(events: CalendarEvent[]): Promise<void> {
  const now = Date.now()
  const toSchedule: Parameters<typeof LocalNotifications.schedule>[0]['notifications'] = []

  for (const event of events) {
    for (const reminder of getEffectiveReminders(event)) {
      const at = reminderInstant(event, reminder.minutesBefore)
      if (at.getTime() <= now) continue

      toSchedule.push({
        id: hashToInt32(`${event.id}:${reminder.id}`),
        title: event.title,
        body: reminderBody(event),
        schedule: { at },
        actionTypeId: REMINDER_ACTION_TYPE,
        extra: { eventId: event.id, eventDate: event.start },
      })
    }
  }

  const pending = await LocalNotifications.getPending()
  if (pending.notifications.length > 0) {
    await LocalNotifications.cancel({
      notifications: pending.notifications.map((n) => ({ id: n.id })),
    })
  }
  if (toSchedule.length > 0) {
    await LocalNotifications.schedule({ notifications: toSchedule })
  }
}

/**
 * Drops every notification we have scheduled. Used when the Android calendar
 * mirror takes over reminder duty, so the same event can't alert twice.
 *
 * Like `reconcileNativeReminders`, this clears pending snoozes too — they are
 * scheduled through the same queue and there is no reason to keep a snooze
 * alive for a reminder the OS is now going to raise itself.
 */
export async function cancelAllNativeReminders(): Promise<void> {
  const pending = await LocalNotifications.getPending()
  if (pending.notifications.length === 0) return
  await LocalNotifications.cancel({
    notifications: pending.notifications.map((n) => ({ id: n.id })),
  })
}

export function listenForReminderActions(): () => void {
  const listenerPromise = LocalNotifications.addListener(
    'localNotificationActionPerformed',
    (action) => {
      const extra = action.notification.extra as { eventId: string; eventDate: string } | undefined
      if (!extra) return

      if (action.actionId !== SNOOZE_ACTION_ID) {
        // Plain tap (actionId 'tap') — open the event the reminder was about.
        openEventDeepLink(extra.eventId, extra.eventDate)
        return
      }

      void LocalNotifications.schedule({
        notifications: [
          {
            id: hashToInt32(`snooze:${extra.eventId}:${Date.now()}`),
            title: action.notification.title ?? 'Reminder',
            body: action.notification.body ?? '',
            schedule: { at: addMinutes(new Date(), 5) },
            actionTypeId: REMINDER_ACTION_TYPE,
            extra,
          },
        ],
      })
    }
  )

  return () => {
    void listenerPromise.then((handle) => handle.remove())
  }
}
