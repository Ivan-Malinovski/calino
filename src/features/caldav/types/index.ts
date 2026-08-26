export interface CalDAVAccount {
  id: string
  name: string
  serverUrl: string
  proxyUrl: string | null
  username: string
  credentialId: string
  createdAt: string
  lastSyncAt: string | null
}

export interface CalDAVCalendar {
  id: string
  accountId?: string // Set by caller, not by CalDAV client
  url: string
  name: string
  color: string
  ctag: string | null
  syncToken: string | null
  isVisible: boolean
  isDefault: boolean
  supportedComponents?: ('VEVENT' | 'VTODO' | 'VJOURNAL')[]
  /** True when the server's current-user-privilege-set grants no write privilege. */
  readOnly?: boolean
  /** cs:subscribed — a CalendarServer subscription; always treated as read-only. */
  isSubscribed?: boolean
  /** cs:calendar-order — server-side ordering hint. */
  calendarOrder?: number
}

export interface SyncState {
  status: 'idle' | 'syncing' | 'error' | 'offline'
  lastSyncAt: string | null
  error: string | null
  pendingChanges: number
  conflicts: ConflictInfo[]
}

export interface PendingChange {
  id: string
  /**
   * `move` — an event changed calendars; `data` is a MovePendingData and
   * `calendarId` is the TARGET. Distinct from `update` because a replayed
   * update writes to the event's stored href, which is exactly the bug in #86.
   *
   * `delete-href` — remove one leftover resource after a move whose cleanup
   * DELETE failed; `calendarId` is the SOURCE. Distinct from `delete` because
   * that one also removes the event from the local store, which would discard
   * the copy we just successfully moved.
   */
  type: 'create' | 'update' | 'delete' | 'move' | 'delete-href'
  eventId: string
  calendarId: string
  data?: string
  timestamp: string
  retryCount: number
}

/** Payload of a `move` pending change (JSON-encoded in `PendingChange.data`). */
export interface MovePendingData {
  events: unknown[]
  sourceCalendarId: string
  sourceHref?: string
  sourceEtag?: string
}

/** Payload of a `delete-href` pending change (JSON-encoded in `PendingChange.data`). */
export interface DeleteHrefPendingData {
  href: string
  etag?: string
  /** Every event that now lives at the moved-to resource; guarded from sync overwrite. */
  memberIds: string[]
}

export interface CalDAVCredentials {
  id: string
  serverUrl: string
  username: string
  password: string
  authMode?: 'basic' | 'browser-session'
}

export interface ServerInfo {
  url: string
  productId: string
  capabilities: string[]
}

export interface CalendarQuery {
  start: string
  end: string
  calendarUrl: string
}

export interface SyncResult {
  added: string[]
  updated: string[]
  deleted: string[]
  conflicts: string[]
}

export type ConflictResolution = 'server-wins' | 'local-wins' | 'merge' | 'ask'

export interface ConflictInfo {
  eventId: string
  localVersion: unknown
  serverVersion: unknown
  resolution: ConflictResolution
}

export interface CreateCalendarOptions {
  name: string
  description?: string
  color?: string
  components?: ('VEVENT' | 'VTODO')[]
}

export interface UpdateCalendarOptions {
  name?: string
  description?: string
  color?: string
}
