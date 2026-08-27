import type { JSX } from 'react'
import { useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/common/Modal'
import { useContactStore } from '@/store/contactStore'
import { useCardDAV } from '@/features/carddav/hooks/useCardDAV'
import { createUuid } from '@/lib/uuid'
import { findDuplicateGroups, mergeContacts, type DuplicateGroup } from '../lib/mergeContacts'
import { showToast } from '@/lib/toast'
import type { PendingDeleteSnapshot } from '@/lib/deleteContactWithUndo'
import { getInitials } from '../lib/avatars'
import styles from '@/features/calendar/components/EventModal.module.css'

interface MergeDuplicatesModalProps {
  isOpen: boolean
  onClose: () => void
}

const CONFIDENCE_COLORS: Record<string, string> = {
  high: '#4caf50',
  medium: '#e6a817',
  low: '#999',
}

function formatReason(t: (key: string, opts?: Record<string, unknown>) => string, reason: DuplicateGroup['reason']): string {
  switch (reason.kind) {
    case 'sameEmail':
      return t('merge.reasonSameEmail', { value: reason.value })
    case 'samePhone':
      return t('merge.reasonSamePhone', { value: reason.value })
    case 'sameNameAndOrg':
      return t('merge.reasonSameNameAndOrg', { value: reason.value })
    default:
      return t('merge.reasonSameContact')
  }
}

export function MergeDuplicatesModal({
  isOpen,
  onClose,
}: MergeDuplicatesModalProps): JSX.Element | null {
  const { t } = useTranslation(['contacts', 'common'])
  const contacts = useContactStore((s) => s.contacts)
  const updateContact = useContactStore((s) => s.updateContact)
  const deleteContact = useContactStore((s) => s.deleteContact)
  const addPendingChange = useContactStore((s) => s.addPendingChange)
  const { syncAccount } = useCardDAV()

  const [mergedIds, setMergedIds] = useState<Set<string>>(new Set())

  const groups = useMemo(() => (isOpen ? findDuplicateGroups(contacts) : []), [isOpen, contacts])

  const visibleGroups = useMemo(
    () => groups.filter((g) => !g.contacts.every((c) => mergedIds.has(c.id))),
    [groups, mergedIds]
  )

  const handleMerge = useCallback(
    (group: DuplicateGroup) => {
      // First contact is primary, rest are secondary
      const [primary, ...secondaries] = group.contacts

      let merged = { ...primary! }
      for (const secondary of secondaries) {
        merged = mergeContacts(merged, secondary)
      }

      // Update primary in store
      updateContact(primary!.id, merged)

      // Delete secondaries
      for (const secondary of secondaries) {
        deleteContact(secondary.id)
        // Snapshot url/etag/account — the contact is gone from the store by the
        // time the pending change is replayed.
        const snapshot: PendingDeleteSnapshot = {
          url: secondary.url,
          etag: secondary.etag,
          addressBookId: secondary.addressBookId,
          accountId: secondary.accountId,
        }
        addPendingChange({
          id: createUuid(),
          type: 'delete',
          contactId: secondary.id,
          addressBookId: secondary.addressBookId,
          data: JSON.stringify(snapshot),
          timestamp: new Date().toISOString(),
          retryCount: 0,
        })
      }

      // Queue update for primary
      addPendingChange({
          id: createUuid(),
        type: 'update',
        contactId: primary!.id,
        addressBookId: primary!.addressBookId,
        timestamp: new Date().toISOString(),
        retryCount: 0,
      })

      // Mark as merged
      setMergedIds((prev) => {
        const next = new Set(prev)
        for (const c of group.contacts) next.add(c.id)
        return next
      })

      // Sync
      const accounts = new Set(group.contacts.map((c) => c.accountId))
      for (const accountId of accounts) {
        syncAccount(accountId).catch(() => {})
      }

      showToast(t('merge.mergedContacts', { count: group.contacts.length }), {
        duration: 8000,
      })
    },
    [updateContact, deleteContact, addPendingChange, syncAccount]
  )

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('merge.title')}>
      <div className={styles.modalBody} style={{ maxHeight: '60vh', overflow: 'auto' }}>
        {visibleGroups.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--color-text-muted)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>✨</div>
            <div>{t('merge.noDuplicatesFound')}</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {visibleGroups.map((group, i) => (
              <div
                key={i}
                style={{
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--radius-md)',
                  padding: 12,
                }}
              >
                {/* Header */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 8,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      color: CONFIDENCE_COLORS[group.confidence],
                      fontWeight: 600,
                    }}
                  >
                    {t(`merge.confidence.${group.confidence}`)}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                    {formatReason(t, group.reason)}
                  </span>
                </div>

                {/* Contact cards */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  {group.contacts.map((contact) => (
                    <div
                      key={contact.id}
                      style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 8px',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--color-bg-tertiary)',
                        fontSize: 12,
                      }}
                    >
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 'var(--radius-full)',
                          background: 'var(--accent)',
                          color: '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 11,
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                      >
                        {getInitials(contact.displayName)}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 500,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {contact.displayName || t('import.noName')}
                        </div>
                        <div
                          style={{
                            color: 'var(--color-text-muted)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {contact.emails[0]?.value || contact.phones[0]?.value || ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Merge button */}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className={styles.btnSave}
                    onClick={() => handleMerge(group)}
                    style={{ fontSize: 12, padding: 'var(--space-1) var(--space-3)' }}
                  >
                    {t('merge.mergeCount', { count: group.contacts.length })}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className={styles.modalFooter}>
          <button type="button" className={styles.btnCancel} onClick={onClose}>
            {t('common:actions.done')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
