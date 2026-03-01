import { v4 as uuidv4 } from 'uuid';
import type { CalDAVCredentials } from '../types';

const CREDENTIALS_KEY = 'goodcal_caldav_credentials';

export function saveCredentials(credentials: Omit<CalDAVCredentials, 'id'>): CalDAVCredentials {
  const stored = getAllCredentials();
  const newCredentials: CalDAVCredentials = {
    ...credentials,
    id: uuidv4(),
  };
  stored.push(newCredentials);
  localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(stored));
  return newCredentials;
}

export function getAllCredentials(): CalDAVCredentials[] {
  const stored = localStorage.getItem(CREDENTIALS_KEY);
  if (!stored) {
    return [];
  }
  try {
    return JSON.parse(stored) as CalDAVCredentials[];
  } catch {
    return [];
  }
}

export function getCredentialById(id: string): CalDAVCredentials | undefined {
  const credentials = getAllCredentials();
  return credentials.find((c) => c.id === id);
}

export function deleteCredential(id: string): void {
  const stored = getAllCredentials();
  const filtered = stored.filter((c) => c.id !== id);
  localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(filtered));
}

export function updateCredential(id: string, updates: Partial<CalDAVCredentials>): void {
  const stored = getAllCredentials();
  const index = stored.findIndex((c) => c.id === id);
  if (index !== -1) {
    stored[index] = { ...stored[index], ...updates };
    localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(stored));
  }
}
