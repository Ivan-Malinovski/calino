import { db } from './db'
import type { StoredCalendar } from '@/types/storage'

export async function addCalendar(calendar: StoredCalendar): Promise<string> {
  return db.calendars.add(calendar)
}

export async function updateCalendar(
  id: string,
  updates: Partial<StoredCalendar>
): Promise<number> {
  return db.calendars.update(id, updates)
}

export async function deleteCalendar(id: string): Promise<void> {
  return db.calendars.delete(id)
}

export async function getCalendarById(id: string): Promise<StoredCalendar | undefined> {
  return db.calendars.get(id)
}

export async function getCalendarsByAccount(accountId: string): Promise<StoredCalendar[]> {
  return db.calendars.where('accountId').equals(accountId).toArray()
}

export async function getAllCalendars(): Promise<StoredCalendar[]> {
  return db.calendars.toArray()
}

export async function getVisibleCalendars(): Promise<StoredCalendar[]> {
  return db.calendars.where('isVisible').equals(1).toArray()
}

export async function getDefaultCalendar(): Promise<StoredCalendar | undefined> {
  return db.calendars.where('isDefault').equals(1).first()
}

export async function getCalendarCount(): Promise<number> {
  return db.calendars.count()
}

export async function bulkAddCalendars(calendars: StoredCalendar[]): Promise<void> {
  await db.calendars.bulkAdd(calendars)
}

export async function clearAllCalendars(): Promise<void> {
  return db.calendars.clear()
}

export async function setDefaultCalendar(id: string): Promise<void> {
  const calendars = await db.calendars.toArray()
  await db.transaction('rw', db.calendars, async () => {
    for (const cal of calendars) {
      await db.calendars.update(cal.id, { isDefault: cal.id === id })
    }
  })
}

export async function toggleCalendarVisibility(id: string): Promise<void> {
  const calendar = await db.calendars.get(id)
  if (calendar) {
    await db.calendars.update(id, { isVisible: !calendar.isVisible })
  }
}
