export type SyncStatus = 'synced' | 'pending' | 'conflict'

export interface StoredEvent {
  id: string
  calendarId: string
  title: string
  description?: string
  location?: string
  start: string
  end: string
  isAllDay: boolean
  color?: string
  recurrence?: string
  travelDuration?: number
  etag?: string
  remoteId?: string
  syncStatus: SyncStatus
  createdAt: string
  updatedAt: string
  type?: 'event' | 'task'
  dueDate?: string
  completed?: boolean
  priority?: 1 | 2 | 3
  percentComplete?: number
}

export interface StoredCalendar {
  id: string
  accountId?: string
  name: string
  color: string
  ctag?: string
  syncToken?: string
  isVisible: boolean
  isDefault: boolean
}

export interface StoredAccount {
  id: string
  name: string
  serverUrl: string
  username: string
}

export type SyncOperation = 'create' | 'update' | 'delete'

export interface SyncQueueItem {
  id?: number
  operation: SyncOperation
  entity: 'event' | 'calendar'
  entityId: string
  data?: unknown
  timestamp: string
  retryCount: number
  lastError?: string
}
