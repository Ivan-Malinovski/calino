import type { JSX } from 'react'
import { useState, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { Contact } from '../types'
import { Modal } from '@/components/common/Modal'
import { ContactFormFields } from './ContactFormFields'
import eventModalStyles from '@/features/calendar/components/EventModal.module.css'

interface ContactFormModalProps {
  isOpen: boolean
  onClose: () => void
  contact: Contact | null
  addressBookId: string
  accountId: string
  onSave: (contact: Contact) => void
  onDelete?: (contact: Contact) => void
}

const EMPTY_CONTACT: Partial<Contact> = {
  familyName: '',
  givenName: '',
  additionalNames: '',
  prefixes: '',
  suffixes: '',
  nickname: '',
  displayName: '',
  organization: '',
  department: '',
  title: '',
  role: '',
  emails: [],
  phones: [],
  addresses: [],
  urls: [],
  ims: [],
  birthday: null,
  anniversary: null,
  gender: '',
  note: '',
  categories: [],
  photo: null,
  isGroup: false,
  memberUids: [],
  langs: [],
  related: [],
  xmlData: null,
  opaqueLines: [],
}

export function ContactFormModal({
  isOpen,
  onClose,
  contact,
  addressBookId,
  accountId,
  onSave,
  onDelete,
}: ContactFormModalProps): JSX.Element {
  const [formState, setFormState] = useState<Partial<Contact>>(EMPTY_CONTACT)
  const [title, setTitle] = useState('')

  // Initialize form state when modal opens or contact changes
  useEffect(() => {
    if (isOpen) {
      if (contact) {
        setFormState({ ...contact })
        setTitle(contact.displayName || '')
      } else {
        setFormState({
          ...EMPTY_CONTACT,
          addressBookId,
          accountId,
        })
        setTitle('')
      }
    }
  }, [isOpen, contact, addressBookId, accountId])

  const isEditMode = contact !== null

  // Auto-populate given/family name from displayName for new contacts (on blur)
  const handleTitleBlur = (): void => {
    // Only auto-fill for new contacts when given/family are empty
    if (!isEditMode && !formState.givenName && !formState.familyName) {
      const parts = title.trim().split(/\s+/)
      if (parts.length >= 2) {
        setFormState((prev) => ({
          ...prev,
          givenName: parts[0],
          familyName: parts.slice(1).join(' '),
        }))
      } else if (parts.length === 1 && parts[0]) {
        setFormState((prev) => ({
          ...prev,
          givenName: parts[0],
          familyName: '',
        }))
      }
    }
  }

  const handleSave = (): void => {
    // Merge title into formState as displayName
    const displayName = title.trim() || formState.displayName || ''

    // Validate: at least one of displayName, givenName, or familyName must be non-empty
    if (!displayName && !formState.givenName?.trim() && !formState.familyName?.trim()) {
      // Could show a validation error here; for now, force givenName as fallback
      setFormState((prev) => ({ ...prev, displayName: 'New Contact' }))
      setTitle('New Contact')
      return
    }

    const now = new Date().toISOString()

    const completeContact: Contact = {
      id: contact?.id ?? uuidv4(),
      addressBookId: contact?.addressBookId ?? addressBookId,
      accountId: contact?.accountId ?? accountId,
      url: contact?.url ?? '',
      etag: contact?.etag,

      familyName: formState.familyName ?? '',
      givenName: formState.givenName ?? '',
      additionalNames: formState.additionalNames ?? '',
      prefixes: formState.prefixes ?? '',
      suffixes: formState.suffixes ?? '',
      nickname: formState.nickname ?? '',

      displayName: displayName,

      organization: formState.organization ?? '',
      department: formState.department ?? '',
      title: formState.title ?? '',
      role: formState.role ?? '',

      emails: formState.emails ?? [],
      phones: formState.phones ?? [],
      addresses: formState.addresses ?? [],
      urls: formState.urls ?? [],
      ims: formState.ims ?? [],

      birthday: formState.birthday ?? null,
      anniversary: formState.anniversary ?? null,
      gender: formState.gender ?? '',

      note: formState.note ?? '',
      categories: formState.categories ?? [],

      photo: formState.photo ?? null,

      isGroup: formState.isGroup ?? false,
      memberUids: formState.memberUids ?? [],

      langs: formState.langs ?? [],
      related: formState.related ?? [],
      xmlData: formState.xmlData ?? null,

      opaqueLines: formState.opaqueLines ?? [],

      rawVCard: contact?.rawVCard,

      createdAt: contact?.createdAt ?? now,
      lastModified: now,
      syncStatus: 'pending',
    }

    onSave(completeContact)
    onClose()
  }

  const handleDelete = (): void => {
    if (contact && onDelete) {
      onDelete(contact)
      onClose()
    }
  }

  const handleCancel = (): void => {
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} className={eventModalStyles.contactFormModal}>
      {/* Header */}
      <div className={eventModalStyles.modalHeader} style={{ padding: '20px 22px 14px' }}>
        <div className={eventModalStyles.titleInputWrapper} style={{ flex: 1 }}>
          <input
            type="text"
            placeholder={contact ? contact.displayName || 'New Contact' : 'New Contact'}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleBlur}
            className={eventModalStyles.modalTitle}
            autoFocus
          />
        </div>
        <button
          type="button"
          className={eventModalStyles.modalClose}
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
        <ContactFormFields value={formState} onChange={setFormState} />
      </div>

      {/* Footer */}
      <div className={eventModalStyles.modalFooter} style={{ padding: '12px 22px' }}>
        <div style={{ flex: 1 }}>
          {isEditMode && onDelete && (
            <button type="button" className={eventModalStyles.modalDelete} onClick={handleDelete}>
              Delete
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className={eventModalStyles.modalCancel} onClick={handleCancel}>
            Cancel
          </button>
          <button type="button" className={eventModalStyles.modalSave} onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  )
}
