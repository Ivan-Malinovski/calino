import { db } from './db'
import type { StoredEvent, SyncStatus } from '@/types/storage'

export async function addEvent(event: StoredEvent): Promise<string> {
  return db.events.add(event)
}

export async function updateEvent(id: string, updates: Partial<StoredEvent>): Promise<number> {
  return db.events.update(id, { ...updates, updatedAt: new Date().toISOString() })
}

export async function deleteEvent(id: string): Promise<void> {
  return db.events.delete(id)
}

export async function getEventById(id: string): Promise<StoredEvent | undefined> {
  return db.events.get(id)
}

export async function getEventsByDateRange(start: string, end: string): Promise<StoredEvent[]> {
  return db.events
    .where('start')
    .belowOrEqual(end)
    .and((event) => event.start >= start || event.end >= start)
    .toArray()
}

export async function getEventsByCalendar(calendarId: string): Promise<StoredEvent[]> {
  return db.events.where('calendarId').equals(calendarId).toArray()
}

export async function getEventsByCalendarAndDateRange(
  calendarId: string,
  start: string,
  end: string
): Promise<StoredEvent[]> {
  return db.events
    .where(['calendarId', 'start'])
    .between([calendarId, start], [calendarId, end], true, true)
    .toArray()
}

export async function getPendingEvents(): Promise<StoredEvent[]> {
  return db.events.where('syncStatus').equals('pending').toArray()
}

export async function getEventsBySyncStatus(status: SyncStatus): Promise<StoredEvent[]> {
  return db.events.where('syncStatus').equals(status).toArray()
}

export async function getAllEvents(): Promise<StoredEvent[]> {
  return db.events.toArray()
}

export async function getEventCount(): Promise<number> {
  return db.events.count()
}

export async function bulkAddEvents(events: StoredEvent[]): Promise<void> {
  await db.events.bulkAdd(events)
}

export async function bulkUpdateEvents(
  updates: Array<{ key: string; changes: Partial<StoredEvent> }>
): Promise<void> {
  await db.events.bulkUpdate(updates.map((u) => ({ key: u.key, changes: u.changes })))
}

export async function clearAllEvents(): Promise<void> {
  return db.events.clear()
}
