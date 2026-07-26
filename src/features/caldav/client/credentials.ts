import type { CalDAVCredentials } from '../types'
import { v4 as uuidv4 } from 'uuid'
import {
  encryptPassword,
  decryptPassword,
  isEncryptedPassword,
  type EncryptedData,
} from '@/lib/crypto'

const CREDENTIALS_KEY = 'calino_caldav_credentials'

interface StoredCredential {
  id: string
  serverUrl: string
  username: string
  password: string | EncryptedData
}

export async function saveCredentials(
  credentials: Omit<CalDAVCredentials, 'id'>
): Promise<CalDAVCredentials> {
  const stored = getAllStoredCredentials()

  const encryptedPassword = await encryptPassword(credentials.password)

  const newCredential: StoredCredential = {
    id: uuidv4(),
    serverUrl: credentials.serverUrl,
    username: credentials.username,
    password: encryptedPassword,
  }

  stored.push(newCredential)
  localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(stored))

  // Return the CalDAVCredentials with plaintext password for immediate use
  return {
    id: newCredential.id,
    serverUrl: newCredential.serverUrl,
    username: newCredential.username,
    password: credentials.password,
  }
}

function getAllStoredCredentials(): StoredCredential[] {
  const stored = localStorage.getItem(CREDENTIALS_KEY)
  if (!stored) return []
  try {
    return JSON.parse(stored) as StoredCredential[]
  } catch {
    console.warn('[CalDAV] Failed to parse stored credentials from localStorage.')
    return []
  }
}

/**
 * Decrypt all stored credentials.
 * Handles migration from legacy plaintext format.
 */
export async function getAllCredentials(): Promise<CalDAVCredentials[]> {
  const stored = getAllStoredCredentials()
  let migrated = false

  const credentials: CalDAVCredentials[] = []

  for (const cred of stored) {
    let password: string

    if (isEncryptedPassword(cred.password)) {
      // New encrypted format — decrypt
      password = await decryptPassword(cred.password)
    } else if (typeof cred.password === 'string') {
      // Legacy plaintext format — decrypt and migrate
      password = cred.password
      cred.password = await encryptPassword(cred.password)
      migrated = true
    } else {
      console.warn('[CalDAV] Unknown password format for credential', cred.id)
      continue
    }

    credentials.push({
      id: cred.id,
      serverUrl: cred.serverUrl,
      username: cred.username,
      password,
    })
  }

  // Save migrated credentials back to storage
  if (migrated) {
    localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(stored))
  }

  return credentials
}

/**
 * Get a single credential by ID (async — needs decryption).
 */
export async function getCredentialById(id: string): Promise<CalDAVCredentials | undefined> {
  const credentials = await getAllCredentials()
  return credentials.find((c) => c.id === id)
}

export function deleteCredential(id: string): void {
  const stored = getAllStoredCredentials()
  const filtered = stored.filter((c) => c.id !== id)
  localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(filtered))
}

export async function updateCredential(
  id: string,
  updates: Partial<CalDAVCredentials>
): Promise<void> {
  const stored = getAllStoredCredentials()
  const index = stored.findIndex((c) => c.id === id)
  if (index !== -1) {
    const existing = stored[index]
    stored[index] = {
      ...existing,
      serverUrl: updates.serverUrl ?? existing.serverUrl,
      username: updates.username ?? existing.username,
      password: updates.password ? await encryptPassword(updates.password) : existing.password,
    }
    localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(stored))
  }
}
