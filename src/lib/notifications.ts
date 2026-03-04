import { parseISO, format } from 'date-fns'

export type NotificationPermissionStatus = 'granted' | 'denied' | 'default'

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

export function formatEventTime(startIso: string, isAllDay: boolean): string {
  if (isAllDay) {
    return 'All day'
  }
  const date = parseISO(startIso)
  return format(date, 'h:mm a')
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
    icon: '/appicon.jpg',
    badge: '/appicon.jpg',
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
