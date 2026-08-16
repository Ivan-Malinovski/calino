import type { CalDAVAccount, CalDAVCalendar, PendingChange } from '../types'
import { v4 as uuidv4 } from 'uuid'

const ACCOUNTS_KEY = 'calino_caldav_accounts'
const PENDING_CHANGES_KEY = 'calino_pending_changes'

export function saveAccount(
  account: Omit<CalDAVAccount, 'id' | 'createdAt' | 'lastSyncAt' | 'proxyUrl'> & {
    proxyUrl?: string | null
  }
): CalDAVAccount {
  const accounts = getAllAccounts()
  const newAccount: CalDAVAccount = {
    ...account,
    proxyUrl: account.proxyUrl ?? null,
    id: uuidv4(),
    createdAt: new Date().toISOString(),
    lastSyncAt: null,
  }
  accounts.push(newAccount)
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts))
  return newAccount
}

export function getAllAccounts(): CalDAVAccount[] {
  const stored = localStorage.getItem(ACCOUNTS_KEY)
  if (!stored) {
    return []
  }
  try {
    return JSON.parse(stored) as CalDAVAccount[]
  } catch {
    console.warn(
      '[CalDAV] Failed to parse stored accounts from localStorage. Data may be corrupted.'
    )
    return []
  }
}

export function getAccountById(id: string): CalDAVAccount | undefined {
  const accounts = getAllAccounts()
  return accounts.find((a) => a.id === id)
}

export function updateAccount(id: string, updates: Partial<CalDAVAccount>): void {
  const accounts = getAllAccounts()
  const index = accounts.findIndex((a) => a.id === id)
  if (index !== -1) {
    accounts[index] = { ...accounts[index], ...updates }
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts))
  }
}

export function deleteAccount(id: string): void {
  const accounts = getAllAccounts()
  const filtered = accounts.filter((a) => a.id !== id)
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(filtered))
}

export function updateAccountLastSync(id: string): void {
  updateAccount(id, { lastSyncAt: new Date().toISOString() })
}

const CALENDARS_KEY = 'calino_caldav_calendars'

export function saveCalendar(calendar: CalDAVCalendar): void {
  const calendars = getAllCalendars()
  const existingIndex = calendars.findIndex((c) => c.id === calendar.id)

  if (existingIndex !== -1) {
    calendars[existingIndex] = calendar
  } else {
    calendars.push(calendar)
  }

  localStorage.setItem(CALENDARS_KEY, JSON.stringify(calendars))
}

export function getAllCalendars(): CalDAVCalendar[] {
  const stored = localStorage.getItem(CALENDARS_KEY)
  if (!stored) {
    return []
  }
  try {
    return JSON.parse(stored) as CalDAVCalendar[]
  } catch {
    console.warn(
      '[CalDAV] Failed to parse stored calendars from localStorage. Data may be corrupted.'
    )
    return []
  }
}

export function getCalendarsByAccountId(accountId: string): CalDAVCalendar[] {
  const calendars = getAllCalendars()
  return calendars.filter((c) => c.accountId === accountId)
}

export function updateCalendar(id: string, updates: Partial<CalDAVCalendar>): void {
  const calendars = getAllCalendars()
  const index = calendars.findIndex((c) => c.id === id)
  if (index !== -1) {
    calendars[index] = { ...calendars[index], ...updates }
    localStorage.setItem(CALENDARS_KEY, JSON.stringify(calendars))
  }
}

export function deleteCalendar(id: string): void {
  const calendars = getAllCalendars()
  const filtered = calendars.filter((c) => c.id !== id)
  localStorage.setItem(CALENDARS_KEY, JSON.stringify(filtered))
}

export function deleteCalendarsByAccountId(accountId: string): void {
  const calendars = getAllCalendars()
  const filtered = calendars.filter((c) => c.accountId !== accountId)
  localStorage.setItem(CALENDARS_KEY, JSON.stringify(filtered))
}

// 'create' | 'update' | 'delete' are store-write ops on the same resource;
// consecutive queued writes to one event coalesce into the newest intent.
// 'move' and 'delete-href' are lifecycle ops with different replay semantics
// and different calendarId meanings (move's is the TARGET, delete-href's is
// the SOURCE) and are never coalesced.
const COALESCIBLE_TYPES = new Set(['create', 'update', 'delete'])

export function addPendingChange(
  change: Omit<PendingChange, 'id' | 'timestamp' | 'retryCount'>
): void {
  const changes = getPendingChanges()
  const now = new Date().toISOString()

  const existingIndex = COALESCIBLE_TYPES.has(change.type)
    ? changes.findIndex(
        (c) =>
          COALESCIBLE_TYPES.has(c.type) &&
          c.eventId === change.eventId &&
          c.calendarId === change.calendarId
      )
    : -1

  if (existingIndex !== -1) {
    // Supersede the older queued write in place: same array index (queue
    // order preserved), same id (any in-flight reference still resolves),
    // timestamp refreshed, retryCount reset.
    changes[existingIndex] = {
      ...change,
      id: changes[existingIndex].id,
      timestamp: now,
      retryCount: 0,
    }
  } else {
    changes.push({
      ...change,
      id: uuidv4(),
      timestamp: now,
      retryCount: 0,
    })
  }

  localStorage.setItem(PENDING_CHANGES_KEY, JSON.stringify(changes))
}

export function getPendingChanges(): PendingChange[] {
  const stored = localStorage.getItem(PENDING_CHANGES_KEY)
  if (!stored) {
    return []
  }
  try {
    return JSON.parse(stored) as PendingChange[]
  } catch {
    console.warn(
      '[CalDAV] Failed to parse stored pending changes from localStorage. Data may be corrupted.'
    )
    return []
  }
}

export function removePendingChange(id: string): void {
  const changes = getPendingChanges()
  const filtered = changes.filter((c) => c.id !== id)
  localStorage.setItem(PENDING_CHANGES_KEY, JSON.stringify(filtered))
}

export function updatePendingChangeRetry(id: string): void {
  const changes = getPendingChanges()
  const index = changes.findIndex((c) => c.id === id)
  if (index !== -1) {
    changes[index].retryCount += 1
    localStorage.setItem(PENDING_CHANGES_KEY, JSON.stringify(changes))
  }
}

export function clearPendingChanges(): void {
  localStorage.setItem(PENDING_CHANGES_KEY, JSON.stringify([]))
}
