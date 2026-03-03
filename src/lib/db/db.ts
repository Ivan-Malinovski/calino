import Dexie, { type Table } from 'dexie'
import type { StoredEvent, StoredCalendar, StoredAccount, SyncQueueItem } from '@/types/storage'

export class CalinoDB extends Dexie {
  events!: Table<StoredEvent, string>
  calendars!: Table<StoredCalendar, string>
  accounts!: Table<StoredAccount, string>
  syncQueue!: Table<SyncQueueItem, number>

  constructor() {
    super('CalinoDB')

    this.version(1).stores({
      events: 'id, calendarId, start, end, syncStatus, remoteId',
      calendars: 'id, accountId',
      accounts: 'id',
      syncQueue: '++id, entity, entityId, timestamp, syncStatus',
    })
  }
}

export const db = new CalinoDB()
