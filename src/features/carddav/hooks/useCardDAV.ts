import { useState, useCallback, useEffect } from 'react'
import type { AddressBook, Contact, CardDAVSyncState, PendingContactChange } from '../types'
import type { PendingDeleteSnapshot } from '@/lib/deleteContactWithUndo'
import { createCardDAVClient, CardDAVClient } from '../client/CardDAVClient'
import { useContactStore } from '@/store/contactStore'
import { getCredentialById } from '@/features/caldav/client/credentials'
import * as storage from '@/features/caldav/sync/accountStorage'
import { showToast } from '@/lib/toast'

/**
 * Deletes carry a snapshot of the contact's url/etag/account in `data`, because the
 * contact is removed from the store before the change can be replayed.
 */
function parseDeleteSnapshot(change: PendingContactChange): PendingDeleteSnapshot | null {
  if (change.type !== 'delete' || !change.data) return null
  try {
    return JSON.parse(change.data) as PendingDeleteSnapshot
  } catch {
    return null
  }
}

/**
 * How many times a pending change may fail before it is retired.
 *
 * Intentionally lower than the CalDAV side (`MAX_RETRIES = 10` in useCalDAV):
 * a contact write that has failed three times is far more likely to be a
 * malformed vCard the server keeps rejecting than a transient outage. The two
 * used to claim to mirror each other while holding different values.
 */
const MAX_REPLAY_RETRIES = 3

/**
 * In-flight syncs, keyed by account. Module-level so that separate `useCardDAV` consumers
 * (and a sync fired by a delete while a periodic sync is already running) coalesce instead
 * of racing: each run snapshots the contact list, so the slower one used to finish last and
 * write its stale snapshot back, resurrecting just-deleted contacts.
 */
const inFlightSyncs = new Map<string, Promise<void>>()

/**
 * At most one follow-up sync per account. A sync requested while another is running cannot
 * just piggyback on it: that run already passed its replay step, so a change queued after
 * it started would never be pushed. Instead we run exactly one more pass afterwards.
 */
const queuedSyncs = new Map<string, Promise<void>>()

/** Module-level client cache: accountId → connected client */
const clientCache = new Map<string, CardDAVClient>()

async function getClientForAccount(accountId: string): Promise<CardDAVClient> {
  const cached = clientCache.get(accountId)
  if (cached) return cached

  const account = storage.getAccountById(accountId)
  if (!account) throw new Error(`Account not found: ${accountId}`)

  const credential = await getCredentialById(account.credentialId)
  if (!credential) throw new Error('Credentials not found')

  const client = await createCardDAVClient(account.serverUrl, credential, account.proxyUrl)
  clientCache.set(accountId, client)
  return client
}

interface UseCardDAVReturn {
  addressBooks: AddressBook[]
  contacts: Contact[]
  syncState: CardDAVSyncState
  syncAccount: (accountId: string) => Promise<void>
  hasAddressBooks: (accountId: string) => Promise<boolean>
}

export function useCardDAV(): UseCardDAVReturn {
  const [syncState, setSyncState] = useState<CardDAVSyncState>({
    status: 'idle',
    lastSyncAt: null,
    error: null,
    pendingChanges: 0,
  })

  const storeAddressBooks = useContactStore((state) => state.addressBooks)
  const storeContacts = useContactStore((state) => state.contacts)
  const pendingChanges = useContactStore((state) => state.pendingChanges)
  const setAddressBooks = useContactStore((state) => state.setAddressBooks)
  const removePendingChange = useContactStore((state) => state.removePendingChange)

  // Keep syncState.pendingChanges in sync with store
  useEffect(() => {
    setSyncState((prev) => ({ ...prev, pendingChanges: pendingChanges.length }))
  }, [pendingChanges.length])

  // Check if an account has address books
  const hasAddressBooks = useCallback(async (accountId: string): Promise<boolean> => {
    try {
      const client = await getClientForAccount(accountId)
      const addressBooks = await client.fetchAddressBooks()
      return addressBooks.length > 0
    } catch {
      return false
    }
  }, [])

  // Replay pending offline changes against the server
  const replayPendingChanges = useCallback(
    async (client: CardDAVClient, accountId: string): Promise<string[]> => {
      // Use LIVE store so we get the latest contacts (with user edits) and pending changes
      const getLiveState = () => useContactStore.getState()

      // Resolve the owning account WITHOUT relying on the contact still being in the
      // store — a pending delete has already removed it optimistically. Fall back to
      // the address book the change was queued against, which also covers contacts
      // whose accountId disagrees with their address book (multi-book accounts).
      const accountForChange = (c: PendingContactChange): string | undefined => {
        const snapshot = parseDeleteSnapshot(c)
        if (snapshot?.accountId) return snapshot.accountId
        const contact = getLiveState().contacts.find((ct) => ct.id === c.contactId)
        if (contact?.accountId) return contact.accountId
        return getLiveState().addressBooks.find((a) => a.id === c.addressBookId)?.accountId
      }

      const changes = getLiveState().pendingChanges.filter((c) => accountForChange(c) === accountId)

      if (changes.length === 0) return []

      console.log(`[CardDAV] Replaying ${changes.length} pending changes`)

      const replayedIds: string[] = []

      for (const change of changes) {
        try {
          // Read from LIVE store, not the snapshot, so we get the updated contact
          const contact = useContactStore
            .getState()
            .contacts.find((ct) => ct.id === change.contactId)

          if (change.type === 'delete') {
            // Prefer the snapshot taken at delete time; the contact itself is gone.
            const snapshot = parseDeleteSnapshot(change)
            const url = snapshot?.url ?? contact?.url
            const etag = snapshot?.etag ?? contact?.etag
            const addressBookId = snapshot?.addressBookId ?? change.addressBookId
            const ab = getLiveState().addressBooks.find((a) => a.id === addressBookId)

            if (url && ab) {
              // etag may legitimately be missing (server never exposed it through CORS);
              // deleteContact then issues an unconditional DELETE.
              await client.deleteContact(ab, url, etag)
            }
            // If there is nothing to delete on the server (never synced, or the book
            // is gone) the change is done — fall through and drop it from the queue
            // instead of retrying forever.
          } else if (change.type === 'create' && contact) {
            const ab = getLiveState().addressBooks.find((a) => a.id === change.addressBookId)
            if (ab) {
              const filename = `${contact.id}.vcf`
              const result = await client.createContact(ab, contact, filename)
              useContactStore.getState().updateContact(contact.id, {
                url: result.url,
                etag: result.etag,
                syncStatus: 'synced',
              })
            }
          } else if (change.type === 'update' && contact) {
            if (contact.url) {
              const ab = getLiveState().addressBooks.find((a) => a.id === contact.addressBookId)
              if (ab) {
                const result = await client.updateContact(ab, contact, contact.url, contact.etag)
                useContactStore.getState().updateContact(contact.id, {
                  etag: result.etag,
                  syncStatus: 'synced',
                })
              }
            }
          }

          replayedIds.push(change.id)
        } catch (err) {
          console.warn(`[CardDAV] Failed to replay change ${change.id}:`, err)
          useContactStore.getState().updateContact(change.contactId, { syncStatus: 'failed' })
          useContactStore.getState().incrementRetryCount(change.id)

          const updated = useContactStore.getState().pendingChanges.find((c) => c.id === change.id)
          if (updated && updated.retryCount >= MAX_REPLAY_RETRIES) {
            // Retire the change instead of replaying it on every sync forever. A change the
            // server keeps rejecting (a malformed card, a revoked permission) is a poison
            // pill: while it sits in the queue its contact is also exempt from merge and
            // prune, so it freezes that contact against the server indefinitely.
            useContactStore.getState().removePendingChange(change.id)

            const contact = useContactStore
              .getState()
              .contacts.find((c) => c.id === change.contactId)
            const snapshot = parseDeleteSnapshot(change)
            const label = contact?.displayName ?? snapshot?.displayName ?? 'Contact'
            const reason = err instanceof Error ? err.message : String(err)
            const verb =
              change.type === 'create' ? 'create' : change.type === 'update' ? 'update' : 'delete'
            showToast(`Couldn't ${verb} "${label}" on the server: ${reason}`)
          }
        }
      }

      return replayedIds
    },
    []
  )

  // Sync contacts from a CalDAV account
  const runSync = useCallback(
    async (accountId: string): Promise<void> => {
      const account = storage.getAccountById(accountId)
      if (!account) return

      setSyncState((prev) => ({ ...prev, status: 'syncing', error: null }))

      // Declared out here so the `finally` can always drain them: a change that was
      // applied to the server must never be replayed again, even if a later step of the
      // sync throws.
      let replayedChangeIds: string[] = []

      try {
        const client = await getClientForAccount(accountId)

        // Replay any pending offline changes first
        // Returns IDs of successfully replayed changes — we remove them AFTER the sync loop
        // so the hasPending check still protects those contacts from being overwritten
        replayedChangeIds = await replayPendingChanges(client, accountId)

        const serverAddressBooks = await client.fetchAddressBooks()

        // Update address books in store
        const newAddressBooks: AddressBook[] = serverAddressBooks.map((ab) => ({
          ...ab,
          accountId,
        }))

        // Merge with existing address books
        const existingAddressBooks = useContactStore.getState().addressBooks
        const mergedAddressBooks = [...existingAddressBooks]

        for (const newAb of newAddressBooks) {
          const existingIndex = mergedAddressBooks.findIndex((ab) => ab.url === newAb.url)
          if (existingIndex >= 0) {
            // Preserve syncToken from existing unless server has a new one
            const existingSyncToken = mergedAddressBooks[existingIndex].syncToken
            mergedAddressBooks[existingIndex] = {
              ...mergedAddressBooks[existingIndex],
              name: newAb.name,
              ctag: newAb.ctag,
              syncToken: newAb.syncToken || existingSyncToken,
            }
          } else {
            mergedAddressBooks.push(newAb)
          }
        }

        setAddressBooks(mergedAddressBooks)

        // Incremental sync: use sync-collection (RFC 6578) if token available, otherwise ctag
        const allContacts: Contact[] = []
        let skippedBooks = 0
        const updatedSyncTokens: { url: string; syncToken: string | null }[] = []

        for (const addressBook of newAddressBooks) {
          const existingAb = existingAddressBooks.find((ab) => ab.url === addressBook.url)
          const storedSyncToken = existingAb?.syncToken ?? null

          // Skip if ctag hasn't changed (for non-sync-token based sync)
          if (!storedSyncToken && existingAb?.ctag && existingAb.ctag === addressBook.ctag) {
            skippedBooks++
            continue
          }

          try {
            // Try sync-collection first if we have a stored token
            if (storedSyncToken || !existingAb?.ctag || existingAb.ctag !== addressBook.ctag) {
              const syncResult = await client.syncCollection(addressBook, storedSyncToken)

              if (!syncResult.tokenInvalidated && syncResult.changes.length > 0) {
                // sync-collection succeeded with changes
                const changedUrls = syncResult.changes
                  .filter((c) => c.status !== 'removed')
                  .map((c) => c.url)

                // Fetch changed contacts via multiget
                if (changedUrls.length > 0) {
                  const changedContacts = await client.fetchContactsByUrls(addressBook, changedUrls)
                  allContacts.push(...changedContacts)
                }

                // Store new sync token
                if (syncResult.newSyncToken) {
                  updatedSyncTokens.push({
                    url: addressBook.url,
                    syncToken: syncResult.newSyncToken,
                  })
                }

                console.log(
                  `[CardDAV] sync-collection for ${addressBook.name}: ${syncResult.changes.length} changes`
                )
              } else if (syncResult.tokenInvalidated) {
                // Token invalidated - fall back to full fetch
                console.log(
                  `[CardDAV] sync-token invalidated for ${addressBook.name}, falling back to full fetch`
                )
                const contacts = await client.fetchContacts(addressBook)
                allContacts.push(...contacts)
                // Don't update sync token on fallback
              } else {
                // No changes - nothing to do
                if (syncResult.newSyncToken) {
                  updatedSyncTokens.push({
                    url: addressBook.url,
                    syncToken: syncResult.newSyncToken,
                  })
                }
                skippedBooks++
              }
            } else {
              // No sync token, use ctag-based sync
              const contacts = await client.fetchContacts(addressBook)
              allContacts.push(...contacts)
            }
          } catch (err) {
            console.warn(`[CardDAV] Failed to sync ${addressBook.name}:`, err)
            // Fall back to full fetch on error
            try {
              const contacts = await client.fetchContacts(addressBook)
              allContacts.push(...contacts)
            } catch (fallbackErr) {
              console.warn(
                `[CardDAV] Fallback fetch also failed for ${addressBook.name}:`,
                fallbackErr
              )
            }
          }
        }

        // Update sync tokens in merged address books
        for (const { url, syncToken } of updatedSyncTokens) {
          const abIndex = mergedAddressBooks.findIndex((ab) => ab.url === url)
          if (abIndex >= 0) {
            mergedAddressBooks[abIndex].syncToken = syncToken
          }
        }

        setAddressBooks(mergedAddressBooks)

        // Merge with existing contacts, with conflict detection.
        // Read the store *now*, after all network I/O: anything the user did while the
        // fetches were in flight (most importantly a delete) must not be undone by a
        // snapshot taken before them.
        // Remove contacts that no longer exist on the server
        // For books with sync tokens, we can remove contacts that were reported as removed
        // For books without sync tokens, use ctag-based pruning
        const fullySyncedBookIds = newAddressBooks
          .filter((ab) => {
            const existingAb = existingAddressBooks.find((e) => e.url === ab.url)
            return existingAb?.ctag && existingAb.ctag === ab.ctag
          })
          .map((ab) => ab.id)

        const serverContactIds = new Set(allContacts.map((c) => c.id))
        const conflicts: string[] = []

        // The merge runs *inside* the store updater so that it reads and writes the contact
        // list in one atomic step. Computing it from a separate read leaves a window in
        // which the user can delete a contact and have this write put it straight back —
        // which is exactly what deleting two contacts in quick succession used to hit.
        useContactStore.setState((state) => {
          const pendingDeleteIds = new Set(
            state.pendingChanges.filter((p) => p.type === 'delete').map((p) => p.contactId)
          )
          const hasPending = (contactId: string): boolean =>
            state.pendingChanges.some((p) => p.contactId === contactId)

          const mergedContacts = [...state.contacts]

          for (const newContact of allContacts) {
            const existingIndex = mergedContacts.findIndex((c) => c.id === newContact.id)
            if (existingIndex >= 0) {
              const existing = mergedContacts[existingIndex]

              // Skip if this contact has pending local changes
              if (hasPending(existing.id)) {
                continue
              }

              // Conflict detection: if etag differs and local lastModified is newer, warn
              if (existing.etag && newContact.etag && existing.etag !== newContact.etag) {
                const localModified = new Date(existing.lastModified).getTime()
                const serverModified = new Date(newContact.lastModified).getTime()

                if (localModified > serverModified) {
                  console.warn(
                    `[CardDAV] Conflict on contact ${existing.id}: local modified after server. Server wins.`
                  )
                  conflicts.push(existing.displayName)
                }
              }

              // Server wins: overwrite local with server version
              mergedContacts[existingIndex] = {
                ...newContact,
                syncStatus: 'synced',
              }
            } else {
              // New contact from server — unless we have a delete queued for it, in which
              // case it is only still on the server because the DELETE hasn't landed yet.
              if (pendingDeleteIds.has(newContact.id)) {
                continue
              }
              mergedContacts.push({
                ...newContact,
                syncStatus: 'synced',
              })
            }
          }

          return {
            contacts: mergedContacts.filter((c) => {
              // Don't prune contacts from books we didn't sync
              if (fullySyncedBookIds.includes(c.addressBookId)) return true
              // Don't prune contacts with pending changes
              if (hasPending(c.id)) return true
              // Keep if server had it or if it's from a different account
              return serverContactIds.has(c.id) || c.accountId !== accountId
            }),
          }
        })

        for (const displayName of conflicts) {
          showToast(`Conflict on "${displayName}" — server version kept`)
        }

        setSyncState((prev) => ({
          ...prev,
          status: 'idle',
          lastSyncAt: new Date().toISOString(),
        }))

        const skippedMsg = skippedBooks > 0 ? ` (${skippedBooks} unchanged)` : ''
        console.log(
          `[CardDAV] Synced ${allContacts.length} contacts from ${newAddressBooks.length - skippedBooks} address books${skippedMsg}`
        )
      } catch (error) {
        console.error('[CardDAV] syncAccount failed:', error)
        const msg = error instanceof Error ? error.message : 'Sync failed'
        setSyncState((prev) => ({
          ...prev,
          status: 'error',
          error: msg,
        }))
        // Only show toast for real errors, not during initial mount
        if (syncState.lastSyncAt) {
          showToast(`Contacts sync failed: ${msg}`)
        }
      } finally {
        // Now safe to remove successfully replayed pending changes
        for (const changeId of replayedChangeIds) {
          removePendingChange(changeId)
        }
      }
    },
    [setAddressBooks, removePendingChange, replayPendingChanges, syncState.lastSyncAt]
  )

  /**
   * Public entry point. Serializes syncs of the same account so two overlapping passes
   * cannot write conflicting contact lists, while still guaranteeing that every caller's
   * changes get a replay pass: a request made mid-sync is answered by one trailing run.
   */
  const syncAccount = useCallback(
    (accountId: string): Promise<void> => {
      const start = (): Promise<void> => {
        const run = runSync(accountId).finally(() => {
          inFlightSyncs.delete(accountId)
        })
        inFlightSyncs.set(accountId, run)
        return run
      }

      const inFlight = inFlightSyncs.get(accountId)
      if (!inFlight) return start()

      // Coalesce every mid-flight request onto a single trailing run
      const queued = queuedSyncs.get(accountId)
      if (queued) return queued

      const follow = inFlight
        .catch(() => {})
        .then(() => {
          queuedSyncs.delete(accountId)
          return start()
        })
      queuedSyncs.set(accountId, follow)
      return follow
    },
    [runSync]
  )

  // Auto-sync contacts from all accounts on mount
  useEffect(() => {
    const syncAllAccounts = async () => {
      const accounts = storage.getAllAccounts()
      for (const account of accounts) {
        try {
          await syncAccount(account.id)
        } catch (err) {
          console.warn('[CardDAV] Failed to sync account:', account.name, err)
        }
      }
    }
    syncAllAccounts()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    addressBooks: storeAddressBooks,
    contacts: storeContacts,
    syncState,
    syncAccount,
    hasAddressBooks,
  }
}
