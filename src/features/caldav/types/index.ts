export interface CalDAVAccount {
  id: string;
  name: string;
  serverUrl: string;
  username: string;
  credentialId: string;
  createdAt: string;
  lastSyncAt: string | null;
}

export interface CalDAVCalendar {
  id: string;
  accountId: string;
  url: string;
  name: string;
  color: string;
  ctag: string | null;
  syncToken: string | null;
  isVisible: boolean;
  isDefault: boolean;
}

export interface SyncState {
  status: 'idle' | 'syncing' | 'error' | 'offline';
  lastSyncAt: string | null;
  error: string | null;
  pendingChanges: number;
}

export interface PendingChange {
  id: string;
  type: 'create' | 'update' | 'delete';
  eventId: string;
  calendarId: string;
  data?: string;
  timestamp: string;
  retryCount: number;
}

export interface CalDAVCredentials {
  id: string;
  serverUrl: string;
  username: string;
  password: string;
}

export interface ServerInfo {
  url: string;
  productId: string;
  capabilities: string[];
}

export interface CalendarQuery {
  start: string;
  end: string;
  calendarUrl: string;
}

export interface SyncResult {
  added: string[];
  updated: string[];
  deleted: string[];
  conflicts: string[];
}

export type ConflictResolution = 'server-wins' | 'local-wins' | 'merge' | 'ask';

export interface ConflictInfo {
  eventId: string;
  localVersion: unknown;
  serverVersion: unknown;
  resolution: ConflictResolution;
}
