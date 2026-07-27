import type { Contact, PendingContactChange } from '@/features/carddav/types'
import { showToast } from './toast'

interface DeleteContactWithUndoOptions {
  contact: Contact
  deleteContact: (id: string) => void
  addContact: (contact: Contact) => void
  addPendingChange: (change: PendingContactChange) => void
  /** Used by undo to cancel the queued delete if it has not been replayed yet */
  hasPendingChange?: (changeId: string) => boolean
  removePendingChange?: (changeId: string) => void
  syncAccount?: (accountId: string) => Promise<void>
  onAfterDelete?: () => void
}

/**
 * Snapshot of everything needed to issue the DELETE after the contact has been
 * removed from the store. Without this the replay has nothing to work with.
 */
export interface PendingDeleteSnapshot {
  url: string
  etag?: string
  addressBookId: string
  accountId: string
  /** Kept so a failure can be reported by name after the contact left the store */
  displayName?: string
}

export function deleteContactWithUndo({
  contact,
  deleteContact,
  addContact,
  addPendingChange,
  hasPendingChange,
  removePendingChange,
  syncAccount,
  onAfterDelete,
}: DeleteContactWithUndoOptions): void {
  // Save full contact for potential restore
  const savedContact = { ...contact }

  // Optimistic local delete
  deleteContact(contact.id)
  onAfterDelete?.()

  // Queue pending delete for CardDAV sync. The snapshot carries url/etag/account
  // because the contact is already gone from the store by now.
  const changeId = crypto.randomUUID()
  const snapshot: PendingDeleteSnapshot = {
    url: contact.url,
    etag: contact.etag,
    addressBookId: contact.addressBookId,
    accountId: contact.accountId,
    displayName: contact.displayName,
  }
  addPendingChange({
    id: changeId,
    type: 'delete',
    contactId: contact.id,
    addressBookId: contact.addressBookId,
    data: JSON.stringify(snapshot),
    timestamp: new Date().toISOString(),
    retryCount: 0,
  })

  // Push the delete to the server right away
  syncAccount?.(contact.accountId)?.catch(() => {})

  // Show undo toast
  showToast('Contact deleted', {
    duration: 8000,
    onUndo: () => {
      // If the delete has not been replayed yet, cancelling it is enough —
      // the server copy was never touched.
      const stillQueued = hasPendingChange?.(changeId) ?? false
      if (stillQueued && removePendingChange) {
        removePendingChange(changeId)
        addContact(savedContact)
        return
      }

      // Already deleted on the server: restore as a fresh resource.
      const restored: Contact = {
        ...savedContact,
        url: '',
        etag: undefined,
        syncStatus: 'pending',
      }
      addContact(restored)

      addPendingChange({
        id: crypto.randomUUID(),
        type: 'create',
        contactId: restored.id,
        addressBookId: restored.addressBookId,
        timestamp: new Date().toISOString(),
        retryCount: 0,
      })

      // Sync in background
      syncAccount?.(restored.accountId)?.catch(() => {})
    },
  })
}
