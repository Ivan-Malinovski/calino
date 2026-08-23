import type { JSX } from 'react'
import { useState, useMemo, useCallback, useEffect } from 'react'
import { Modal } from '@/components/common/Modal'
import { useContactStore } from '@/store/contactStore'
import { useCardDAV } from '@/features/carddav/hooks/useCardDAV'
import { v4 as uuidv4 } from 'uuid'
import type { Contact } from '../types'
import styles from '@/features/calendar/components/EventModal.module.css'

interface ImportExportModalProps {
  isOpen: boolean
  onClose: () => void
  parsedContacts: Contact[]
  onImportComplete?: () => void
}

/**
 * Detect if a parsed contact is a duplicate of an existing one.
 */
function detectDuplicate(
  parsed: Contact,
  existing: Contact[]
): { isDupe: boolean; existingContact?: Contact } {
  // Check by email
  for (const email of parsed.emails) {
    const match = existing.find((c) =>
      c.emails.some((e) => e.value.toLowerCase() === email.value.toLowerCase())
    )
    if (match) return { isDupe: true, existingContact: match }
  }

  // Check by phone (digits only)
  for (const phone of parsed.phones) {
    const digits = phone.value.replace(/\D/g, '')
    if (digits.length < 5) continue
    const match = existing.find((c) => c.phones.some((p) => p.value.replace(/\D/g, '') === digits))
    if (match) return { isDupe: true, existingContact: match }
  }

  // Check by display name + org
  if (parsed.displayName && parsed.organization) {
    const match = existing.find(
      (c) =>
        c.displayName.toLowerCase() === parsed.displayName.toLowerCase() &&
        c.organization.toLowerCase() === parsed.organization.toLowerCase()
    )
    if (match) return { isDupe: true, existingContact: match }
  }

  return { isDupe: false }
}

export function ImportExportModal({
  isOpen,
  onClose,
  parsedContacts,
  onImportComplete,
}: ImportExportModalProps): JSX.Element | null {
  const existingContacts = useContactStore((s) => s.contacts)
  const addContact = useContactStore((s) => s.addContact)
  const addPendingChange = useContactStore((s) => s.addPendingChange)
  const { syncAccount } = useCardDAV()

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState(0)

  // Initialize all contacts as selected
  useEffect(() => {
    if (isOpen) {
      setSelectedIds(new Set(parsedContacts.map((c) => c.id)))
    }
  }, [isOpen, parsedContacts])

  // Detect duplicates
  const contactsWithDupes = useMemo(
    () =>
      parsedContacts.map((c) => ({
        contact: c,
        ...detectDuplicate(c, existingContacts),
      })),
    [parsedContacts, existingContacts]
  )

  const dupeCount = contactsWithDupes.filter((c) => c.isDupe).length
  const selectedCount = selectedIds.size

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(parsedContacts.map((c) => c.id)))
  }, [parsedContacts])

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const skipDuplicates = useCallback(() => {
    setSelectedIds(
      new Set(
        parsedContacts.filter((c) => !detectDuplicate(c, existingContacts).isDupe).map((c) => c.id)
      )
    )
  }, [parsedContacts, existingContacts])

  const handleImport = useCallback(async () => {
    setImporting(true)
    let count = 0

    for (const c of parsedContacts) {
      if (!selectedIds.has(c.id)) continue

      // Add to store
      addContact(c)

      // Queue pending create for CardDAV
      addPendingChange({
        id: uuidv4(),
        type: 'create',
        contactId: c.id,
        addressBookId: c.addressBookId,
        timestamp: new Date().toISOString(),
        retryCount: 0,
      })

      count++
      setImported(count)
    }

    // Sync in background
    const accounts = new Set(
      parsedContacts.filter((c) => selectedIds.has(c.id)).map((c) => c.accountId)
    )
    for (const accountId of accounts) {
      syncAccount(accountId).catch(() => {})
    }

    setImporting(false)
    onImportComplete?.()
    onClose()
  }, [
    parsedContacts,
    selectedIds,
    addContact,
    addPendingChange,
    syncAccount,
    onImportComplete,
    onClose,
  ])

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Import Contacts">
      <div className={styles.modalBody} style={{ maxHeight: '60vh', overflow: 'auto' }}>
        {/* Summary */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
            fontSize: 13,
            color: 'var(--color-text-secondary)',
          }}
        >
          <span>
            {parsedContacts.length} contacts found
            {dupeCount > 0 && (
              <span style={{ color: 'var(--color-warning)', marginLeft: 8 }}>
                {dupeCount} duplicate{dupeCount !== 1 ? 's' : ''}
              </span>
            )}
          </span>
          <span>{selectedCount} selected</span>
        </div>

        {/* Batch actions */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={selectAll}
            style={{ fontSize: 11, padding: '3px 8px' }}
          >
            Select All
          </button>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={deselectAll}
            style={{ fontSize: 11, padding: '3px 8px' }}
          >
            Deselect All
          </button>
          {dupeCount > 0 && (
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={skipDuplicates}
              style={{ fontSize: 11, padding: '3px 8px' }}
            >
              Skip Duplicates
            </button>
          )}
        </div>

        {/* Contact list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {contactsWithDupes.map(({ contact, isDupe }) => (
            <label
              key={contact.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                borderRadius: 'var(--radius-sm)',
                background: isDupe ? 'var(--color-bg-tertiary)' : 'transparent',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              <input
                type="checkbox"
                checked={selectedIds.has(contact.id)}
                onChange={() => toggleSelect(contact.id)}
                style={{ flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {contact.displayName || '(no name)'}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--color-text-muted)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {contact.emails[0]?.value || contact.phones[0]?.value || ''}
                  {contact.organization ? ` · ${contact.organization}` : ''}
                </div>
              </div>
              {isDupe && (
                <span
                  style={{
                    fontSize: 10,
                    padding: '1px 6px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--color-warning)',
                    color: '#000',
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  DUPE
                </span>
              )}
            </label>
          ))}
        </div>

        {/* Import button */}
        <div className={styles.modalFooter}>
          {importing ? (
            <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
              Importing {imported}/{selectedCount}...
            </span>
          ) : (
            <>
              <button type="button" className={styles.btnCancel} onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.btnSave}
                onClick={handleImport}
                disabled={selectedCount === 0}
              >
                Import {selectedCount} Contact{selectedCount !== 1 ? 's' : ''}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
