import { db } from './db'
import type { StoredAccount } from '@/types/storage'

export async function addAccount(account: StoredAccount): Promise<string> {
  return db.accounts.add(account)
}

export async function updateAccount(id: string, updates: Partial<StoredAccount>): Promise<number> {
  return db.accounts.update(id, updates)
}

export async function deleteAccount(id: string): Promise<void> {
  return db.accounts.delete(id)
}

export async function getAccountById(id: string): Promise<StoredAccount | undefined> {
  return db.accounts.get(id)
}

export async function getAllAccounts(): Promise<StoredAccount[]> {
  return db.accounts.toArray()
}

export async function getAccountCount(): Promise<number> {
  return db.accounts.count()
}

export async function bulkAddAccounts(accounts: StoredAccount[]): Promise<void> {
  await db.accounts.bulkAdd(accounts)
}

export async function clearAllAccounts(): Promise<void> {
  return db.accounts.clear()
}
