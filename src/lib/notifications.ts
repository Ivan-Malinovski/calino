import { format, addMinutes, addDays, isSameDay, parseISO } from 'date-fns'
import { toEventInstant, formatTime } from '@/lib/datetime'
import { useSettingsStore } from '@/store/settingsStore'
import i18n, { currentLanguage } from '@/lib/i18n'
import type { Calendar, CalendarEvent, Reminder } from '@/types'
import { calendarMutesReminders, useCalendarStore } from '@/store/calendarStore'

export type NotificationPermissionStatus = 'granted' | 'denied' | 'default'

/**
 * The reminder a newly-created event starts with, from the "Default Reminder"
 * setting. Seeding at creation is the whole of what that setting does — nothing
 * substitutes a reminder later on, so what an event shows is what fires. `null`
 * (the setting's "None") creates the event with no reminder.
 *
 * The id is fixed rather than a fresh uuid: in the event modal this runs inside
 * a useMemo that re-computes on unrelated changes, and a new id each time would
 * churn form state for a chip the user hasn't touched. Reminder ids only have
 * to be unique within one event, and the add-chip menu hides options already
 * present, so the seeded chip can never collide with a user-added one.
 */
export function makeDefaultReminders(defaultReminderMinutes: number | null): Reminder[] {
  if (defaultReminderMinutes === null) return []
  return [{ id: 'default', minutesBefore: defaultReminderMinutes, method: 'popup' }]
}

/**
 * Which reminders apply to an event: exactly the ones it carries, unless its
 * calendar is a muted webcal overlay.
 *
 * This used to substitute the "Default Reminder" setting whenever an event had
 * none, which meant every event notified whether or not it showed a reminder in
 * the form — and clearing the last reminder chip did nothing, since an empty
 * list is indistinguishable from one that was never set. The default reminder is
 * now applied where it can be seen and edited: it seeds the new-event form (see
 * `makeDefaultReminders`), and what the form shows is what fires.
 *
 * `calendar` is optional so callers that already have the list (the Android
 * mirror payload) do not have to go through the store. Web / native lookup
 * falls back to the store, matching `isCalendarReadOnly`.
 */
export function getEffectiveReminders(event: CalendarEvent, calendar?: Calendar): Reminder[] {
  const resolved =
    calendar ?? useCalendarStore.getState().calendars.find((c) => c.id === event.calendarId)
  if (calendarMutesReminders(resolved)) return []
  return event.reminders ?? []
}

/** Include the event's day even when the reminder fires on an earlier day. */
export function reminderBody(event: CalendarEvent, referenceTime = new Date()): string {
  const start = event.isAllDay ? parseISO(event.start) : toEventInstant(event.start, event.timezone)
  const tomorrow = isSameDay(start, addDays(referenceTime, 1))
  const date = new Intl.DateTimeFormat(currentLanguage(), { dateStyle: 'medium' }).format(start)
  if (event.isAllDay) {
    return tomorrow ? i18n.t('errors:reminder.startingTomorrow') : i18n.t('errors:reminder.startingOn', { date })
  }
  const time = formatTime(start, useSettingsStore.getState().timeFormat)
  return tomorrow
    ? i18n.t('errors:reminder.startingTomorrowAt', { time })
    : i18n.t('errors:reminder.startingOnAt', { date, time })
}

export async function requestNotificationPermission(): Promise<NotificationPermissionStatus> {
  if (!('Notification' in window)) {
    console.warn('Notifications not supported')
    return 'denied'
  }

  if (Notification.permission === 'granted') {
    return 'granted'
  }

  if (Notification.permission === 'denied') {
    return 'denied'
  }

  const permission = await Notification.requestPermission()
  return permission as NotificationPermissionStatus
}

export function getNotificationPermission(): NotificationPermissionStatus {
  if (!('Notification' in window)) {
    return 'denied'
  }
  return Notification.permission as NotificationPermissionStatus
}

export function createNotificationId(eventId: string, reminderId: string): string {
  return `calino-${eventId}-${reminderId}`
}

export interface NotificationData {
  eventId: string
  eventDate: string
  title: string
  body: string
}

export type SnoozeDuration = 5 | 10 | 15 | 30 | 60

export interface SnoozedReminder {
  eventId: string
  eventDate: string
  title: string
  body: string
  snoozeUntil: number // timestamp
}

const SNOOZE_KEY = 'calino-snoozed-reminders'

export function getSnoozedReminders(): SnoozedReminder[] {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as SnoozedReminder[]
  } catch {
    return []
  }
}

export function saveSnoozedReminders(reminders: SnoozedReminder[]): void {
  try {
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(reminders))
  } catch {
    // Storage full or unavailable
  }
}

export function snoozeReminder(
  eventId: string,
  eventDate: string,
  title: string,
  body: string,
  durationMinutes: SnoozeDuration
): SnoozedReminder {
  const snoozed: SnoozedReminder = {
    eventId,
    eventDate,
    title,
    body,
    snoozeUntil: addMinutes(new Date(), durationMinutes).getTime(),
  }
  const existing = getSnoozedReminders()
  // Remove any previous snooze for the same event
  const filtered = existing.filter((r) => r.eventId !== eventId)
  saveSnoozedReminders([...filtered, snoozed])
  return snoozed
}

export function getDueSnoozedReminders(): SnoozedReminder[] {
  const now = Date.now()
  const snoozed = getSnoozedReminders()
  const due = snoozed.filter((r) => r.snoozeUntil <= now)
  if (due.length > 0) {
    // Remove the due ones from storage
    saveSnoozedReminders(snoozed.filter((r) => r.snoozeUntil > now))
  }
  return due
}

export function showNotification(
  title: string,
  body: string,
  eventId: string,
  eventDate: string
): Notification | null {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return null
  }

  const notification = new Notification(title, {
    body,
    icon: '/apple-touch-icon.png',
    badge: '/apple-touch-icon.png',
    tag: `calino-${eventId}`,
    data: { eventId, eventDate } as NotificationData,
    requireInteraction: false,
  })

  notification.onclick = () => {
    window.focus()
    const eventDateStr = eventDate.split('T')[0]
    window.location.href = `/?date=${eventDateStr}&event=${eventId}`
    notification.close()
  }

  return notification
}

export function showTestNotification(): Notification | null {
  const now = new Date()
  const timeStr = format(now, 'h:mm a')
  return showNotification(
    'Test Notification',
    `Notifications are working! It is currently ${timeStr}`,
    'test',
    now.toISOString()
  )
}
