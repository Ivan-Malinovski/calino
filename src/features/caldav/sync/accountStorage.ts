import { v4 as uuidv4 } from 'uuid';
import type { CalDAVAccount, CalDAVCalendar, PendingChange } from '../types';

const ACCOUNTS_KEY = 'goodcal_caldav_accounts';
const PENDING_CHANGES_KEY = 'goodcal_pending_changes';

export function saveAccount(account: Omit<CalDAVAccount, 'id' | 'createdAt' | 'lastSyncAt'>): CalDAVAccount {
  const accounts = getAllAccounts();
  const newAccount: CalDAVAccount = {
    ...account,
    id: uuidv4(),
    createdAt: new Date().toISOString(),
    lastSyncAt: null,
  };
  accounts.push(newAccount);
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  return newAccount;
}

export function getAllAccounts(): CalDAVAccount[] {
  const stored = localStorage.getItem(ACCOUNTS_KEY);
  if (!stored) {
    return [];
  }
  try {
    return JSON.parse(stored) as CalDAVAccount[];
  } catch {
    return [];
  }
}

export function getAccountById(id: string): CalDAVAccount | undefined {
  const accounts = getAllAccounts();
  return accounts.find((a) => a.id === id);
}

export function updateAccount(id: string, updates: Partial<CalDAVAccount>): void {
  const accounts = getAllAccounts();
  const index = accounts.findIndex((a) => a.id === id);
  if (index !== -1) {
    accounts[index] = { ...accounts[index], ...updates };
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  }
}

export function deleteAccount(id: string): void {
  const accounts = getAllAccounts();
  const filtered = accounts.filter((a) => a.id !== id);
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(filtered));
}

export function updateAccountLastSync(id: string): void {
  updateAccount(id, { lastSyncAt: new Date().toISOString() });
}

const CALENDARS_KEY = 'goodcal_caldav_calendars';

export function saveCalendar(calendar: CalDAVCalendar): void {
  const calendars = getAllCalendars();
  const existingIndex = calendars.findIndex((c) => c.id === calendar.id);
  
  if (existingIndex !== -1) {
    calendars[existingIndex] = calendar;
  } else {
    calendars.push(calendar);
  }
  
  localStorage.setItem(CALENDARS_KEY, JSON.stringify(calendars));
}

export function getAllCalendars(): CalDAVCalendar[] {
  const stored = localStorage.getItem(CALENDARS_KEY);
  if (!stored) {
    return [];
  }
  try {
    return JSON.parse(stored) as CalDAVCalendar[];
  } catch {
    return [];
  }
}

export function getCalendarsByAccountId(accountId: string): CalDAVCalendar[] {
  const calendars = getAllCalendars();
  return calendars.filter((c) => c.accountId === accountId);
}

export function updateCalendar(id: string, updates: Partial<CalDAVCalendar>): void {
  const calendars = getAllCalendars();
  const index = calendars.findIndex((c) => c.id === id);
  if (index !== -1) {
    calendars[index] = { ...calendars[index], ...updates };
    localStorage.setItem(CALENDARS_KEY, JSON.stringify(calendars));
  }
}

export function deleteCalendar(id: string): void {
  const calendars = getAllCalendars();
  const filtered = calendars.filter((c) => c.id !== id);
  localStorage.setItem(CALENDARS_KEY, JSON.stringify(filtered));
}

export function deleteCalendarsByAccountId(accountId: string): void {
  const calendars = getAllCalendars();
  const filtered = calendars.filter((c) => c.accountId !== accountId);
  localStorage.setItem(CALENDARS_KEY, JSON.stringify(filtered));
}

export function addPendingChange(change: Omit<PendingChange, 'id' | 'timestamp' | 'retryCount'>): void {
  const changes = getPendingChanges();
  changes.push({
    ...change,
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    retryCount: 0,
  });
  localStorage.setItem(PENDING_CHANGES_KEY, JSON.stringify(changes));
}

export function getPendingChanges(): PendingChange[] {
  const stored = localStorage.getItem(PENDING_CHANGES_KEY);
  if (!stored) {
    return [];
  }
  try {
    return JSON.parse(stored) as PendingChange[];
  } catch {
    return [];
  }
}

export function removePendingChange(id: string): void {
  const changes = getPendingChanges();
  const filtered = changes.filter((c) => c.id !== id);
  localStorage.setItem(PENDING_CHANGES_KEY, JSON.stringify(filtered));
}

export function updatePendingChangeRetry(id: string): void {
  const changes = getPendingChanges();
  const index = changes.findIndex((c) => c.id === id);
  if (index !== -1) {
    changes[index].retryCount += 1;
    localStorage.setItem(PENDING_CHANGES_KEY, JSON.stringify(changes));
  }
}

export function clearPendingChanges(): void {
  localStorage.setItem(PENDING_CHANGES_KEY, JSON.stringify([]));
}
