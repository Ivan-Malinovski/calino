import { LocalNotifications } from '@capacitor/local-notifications'
import { addMinutes } from 'date-fns'
import type { CalendarEvent } from '@/types'
import { getEffectiveReminders } from './notifications'
import { openEventDeepLink } from './deepLink'

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
  const timeStr = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  await LocalNotifications.schedule({
    notifications: [
      {
        id: hashToInt32(`test:${Date.now()}`),
        title: 'Test Notification',
        body: `Notifications are working! It is currently ${timeStr}`,
        schedule: { at: addMinutes(new Date(), 0.1) },
      },
    ],
  })
}

export async function registerReminderActions(): Promise<void> {
  await LocalNotifications.registerActionTypes({
    types: [{ id: REMINDER_ACTION_TYPE, actions: [{ id: SNOOZE_ACTION_ID, title: 'Snooze 5m' }] }],
  })
}

function reminderBody(event: CalendarEvent): string {
  if (event.isAllDay) return 'Starting today'
  const timeStr = new Date(event.start).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
  return `Starting at ${timeStr}`
}

export async function reconcileNativeReminders(events: CalendarEvent[]): Promise<void> {
  const now = Date.now()
  const toSchedule: Parameters<typeof LocalNotifications.schedule>[0]['notifications'] = []

  for (const event of events) {
    for (const reminder of getEffectiveReminders(event)) {
      const at = new Date(event.start)
      at.setMinutes(at.getMinutes() - reminder.minutesBefore)
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
