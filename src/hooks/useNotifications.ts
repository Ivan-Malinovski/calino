import { useEffect, useRef } from 'react'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { showNotification, createNotificationId } from '@/lib/notifications'
import { parseISO, isWithinInterval, addMinutes } from 'date-fns'

const CHECK_INTERVAL_MS = 5 * 60 * 1000

export function useNotifications(): void {
  const events = useCalendarStore((state) => state.events)
  const enableNotifications = useSettingsStore((state) => state.enableDesktopNotifications)
  const defaultReminderMinutes = useSettingsStore((state) => state.defaultReminderMinutes)
  const shownReminders = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!enableNotifications) {
      shownReminders.current.clear()
      return
    }

    if (!('Notification' in window) || Notification.permission !== 'granted') {
      return
    }

    const checkReminders = (): void => {
      const now = new Date()
      const checkWindowStart = addMinutes(now, -1)
      const checkWindowEnd = addMinutes(now, 1)

      events.forEach((event) => {
        const reminders = event.reminders?.length ? event.reminders : 
          event.type === 'event' || !event.type ? [{ id: 'default', minutesBefore: defaultReminderMinutes, method: 'popup' as const }] : []

        if (reminders.length === 0) return

        reminders.forEach((reminder) => {
          const reminderTime = parseISO(event.start)
          reminderTime.setMinutes(reminderTime.getMinutes() - reminder.minutesBefore)

          const reminderId = createNotificationId(event.id, reminder.id)

          if (
            isWithinInterval(reminderTime, { start: checkWindowStart, end: checkWindowEnd }) &&
            !shownReminders.current.has(reminderId)
          ) {
            shownReminders.current.add(reminderId)

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
          }
        })
      })
    }

    checkReminders()
    const intervalId = setInterval(checkReminders, CHECK_INTERVAL_MS)

    return () => {
      clearInterval(intervalId)
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
    if (enableNotifications && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then((permission) => {
        if (permission === 'denied') {
          updateSettings({ enableDesktopNotifications: false })
        }
      })
    }
  }, [enableNotifications, updateSettings])

  return {
    permission: 'Notification' in window ? Notification.permission : 'denied',
    request: () => Notification.requestPermission(),
  }
}
