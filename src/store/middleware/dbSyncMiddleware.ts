import type { StoredEvent, StoredCalendar } from '@/types/storage'
import Dexie from 'dexie'

export async function initializeFromDB(
  db: Dexie
): Promise<{ events: StoredEvent[]; calendars: StoredCalendar[] }> {
  const events = await db.table('events').toArray()
  const calendars = await db.table('calendars').toArray()
  return { events, calendars }
}

export async function syncEventToDB(
  db: Dexie,
  event: StoredEvent,
  operation: 'add' | 'update' | 'delete'
): Promise<void> {
  const table = db.table<StoredEvent>('events')

  switch (operation) {
    case 'add':
    case 'update':
      await table.put(event)
      break
    case 'delete':
      await table.delete(event.id)
      break
  }
}

export async function syncCalendarToDB(
  db: Dexie,
  calendar: StoredCalendar,
  operation: 'add' | 'update' | 'delete'
): Promise<void> {
  const table = db.table<StoredCalendar>('calendars')

  switch (operation) {
    case 'add':
    case 'update':
      await table.put(calendar)
      break
    case 'delete':
      await table.delete(calendar.id)
      break
  }
}

export async function clearAllData(db: Dexie): Promise<void> {
  await db.table('events').clear()
  await db.table('calendars').clear()
  await db.table('accounts').clear()
  await db.table('syncQueue').clear()
}

export async function getAllData(db: Dexie): Promise<{
  events: StoredEvent[]
  calendars: StoredCalendar[]
}> {
  const events = await db.table('events').toArray()
  const calendars = await db.table('calendars').toArray()
  return { events, calendars }
}
