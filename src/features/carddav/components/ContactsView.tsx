import type { JSX } from 'react'
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuidv4 } from 'uuid'
import { useContactStore } from '@/store/contactStore'
import { useCalendarStore } from '@/store/calendarStore'
import { useCardDAV } from '@/features/carddav/hooks/useCardDAV'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { safeCalDAVUpdate, safeCalDAVDelete } from '@/lib/caldavHelpers'
import { Modal } from '@/components/common/Modal'
import type { CalendarEvent } from '@/types'
import { useIsMobile } from '@/hooks/useIsMobile'
import { deleteContactWithUndo } from '@/lib/deleteContactWithUndo'
import {
  createBirthdayEvent,
  hasBirthdayEvent,
  createAnniversaryEvent,
  hasAnniversaryEvent,
} from '@/lib/birthdayReminders'
import { useSettingsStore } from '@/store/settingsStore'
import { showToast } from '@/lib/toast'
import type { Contact } from '../types'
import { ContactList } from './ContactList'
import { ContactDetail } from './ContactDetail'
import { ContactFormModal } from './ContactFormModal'
import styles from './ContactsView.module.css'

type ContactEventKind = 'birthday' | 'anniversary'

export function ContactsView(): JSX.Element {
  const { t } = useTranslation('contacts')
  const selectedContactId = useContactStore((s) => s.selectedContactId)
  const getContactById = useContactStore((s) => s.getContactById)
  const setSelectedContactId = useContactStore((s) => s.setSelectedContactId)
  const addContact = useContactStore((s) => s.addContact)
  const updateContact = useContactStore((s) => s.updateContact)
  const deleteContact = useContactStore((s) => s.deleteContact)
  const addressBooks = useContactStore((s) => s.addressBooks)
  const addPendingChange = useContactStore((s) => s.addPendingChange)
  const removePendingChange = useContactStore((s) => s.removePendingChange)

  const calendars = useCalendarStore((s) => s.calendars)
  const addEvent = useCalendarStore((s) => s.addEvent)
  const events = useCalendarStore((s) => s.events)

  const { syncAccount, syncState } = useCardDAV()
  const { createEvent: createCalDAVEvent, deleteEvent: deleteCalDAVEvent } = useCalDAV()
  const isMobile = useIsMobile()

  // Form modal state
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingContact, setEditingContact] = useState<Contact | null>(null)
  const [pendingAccountId, setPendingAccountId] = useState<string>('')
  const [pendingAddressBookId, setPendingAddressBookId] = useState<string>('')

  // Calendar picker for "Add to calendar" when >1 writable calendar
  const [calendarPicker, setCalendarPicker] = useState<{
    kind: ContactEventKind
    contact: Contact
  } | null>(null)

  // Address book picker for "+ New" when >1 books
  const [showPicker, setShowPicker] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  // Delete confirmation state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const confirmDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // In-flight promise for calendar-event deletes tied to a contact, so an
  // undo can never restore an event that is still being removed (2.3).
  const contactEventDeletesRef = useRef<Promise<void> | null>(null)

  /**
   * Snapshot the birthday/anniversary events for a contact and start deleting
   * them (store + server). Returns the snapshot synchronously for undo.
   */
  const deleteContactCalendarEvents = useCallback(
    (contactId: string): CalendarEvent[] => {
      const store = useCalendarStore.getState()
      const events = store.events.filter((e) => e.url === `calino:contact:${contactId}`)
      if (events.length > 0) {
        // deleteCalDAVEvent removes the server resource AND the local record.
        contactEventDeletesRef.current = Promise.all(
          events.map((e) => safeCalDAVDelete(deleteCalDAVEvent, e.calendarId, e.id))
        ).then(() => undefined)
      }
      return events
    },
    [deleteCalDAVEvent]
  )

  /** Re-add previously deleted contact events (local + server) on undo. */
  const restoreContactCalendarEvents = useCallback(
    async (events: CalendarEvent[]): Promise<void> => {
      // Never race a pending delete: wait for it to finish first.
      await contactEventDeletesRef.current
      for (const event of events) {
        useCalendarStore.getState().addEvent({ ...event, syncStatus: 'pending' })
        await safeCalDAVUpdate(createCalDAVEvent, event.calendarId, event, {})
      }
    },
    [createCalDAVEvent]
  )

  // Webcal subscriptions can't be written to, so they're never a valid target.
  const targetCalendars = useMemo(() => calendars.filter((c) => !c.readOnly), [calendars])

  // Fall back to all books if none are flagged visible, so "+ New" is never a no-op
  const visibleAddressBooks = useMemo(() => {
    const visible = addressBooks.filter((ab) => ab.isVisible)
    return visible.length > 0 ? visible : addressBooks
  }, [addressBooks])

  const selectedContact = selectedContactId ? getContactById(selectedContactId) : null

  const showDetail = isMobile && selectedContact !== null

  const handleBack = (): void => {
    setSelectedContactId(null)
  }

  const openFormFor = (addressBookId: string, accountId: string): void => {
    setEditingContact(null)
    setPendingAddressBookId(addressBookId)
    setPendingAccountId(accountId)
    setIsFormOpen(true)
    setShowPicker(false)
  }

  // "+ New" — if 1 address book go straight to form, if >1 show picker
  const handleNewClick = (): void => {
    if (visibleAddressBooks.length === 0) {
      showToast(t('view.noAddressBookAvailable'))
      return
    }
    if (visibleAddressBooks.length === 1) {
      const [ab] = visibleAddressBooks
      openFormFor(ab.id, ab.accountId)
    } else {
      // Always open — the outside-click/Escape handler below is what closes it
      setShowPicker(true)
    }
  }

  const handlePickAddressBook = (addressBookId: string, accountId: string): void => {
    openFormFor(addressBookId, accountId)
  }

  const handleEdit = useCallback((contact: Contact): void => {
    setEditingContact(contact)
    setPendingAddressBookId(contact.addressBookId)
    setPendingAccountId(contact.accountId)
    setIsFormOpen(true)
  }, [])

  // Close the address book picker on outside click or Escape
  useEffect(() => {
    if (!showPicker) return

    const handlePointerDown = (e: MouseEvent): void => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setShowPicker(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [showPicker])

  const handleDelete = useCallback(
    async (contact: Contact): Promise<void> => {
      // Second click — actually delete
      if (confirmDeleteId === contact.id) {
        if (confirmDeleteTimerRef.current) {
          clearTimeout(confirmDeleteTimerRef.current)
          confirmDeleteTimerRef.current = null
        }
        setConfirmDeleteId(null)

        // Delete with undo toast
        deleteContactWithUndo({
          contact,
          deleteContact,
          addContact,
          addPendingChange,
          hasPendingChange: (changeId) =>
            useContactStore.getState().pendingChanges.some((c) => c.id === changeId),
          removePendingChange,
          syncAccount,
          deleteCalendarEvents: deleteContactCalendarEvents,
          restoreCalendarEvents: restoreContactCalendarEvents,
          onAfterDelete: () => {
            if (selectedContactId === contact.id) {
              setSelectedContactId(null)
            }
          },
        })
        return
      }

      // First click — show confirm
      setConfirmDeleteId(contact.id)

      // Auto-reset after 3 seconds
      if (confirmDeleteTimerRef.current) {
        clearTimeout(confirmDeleteTimerRef.current)
      }
      confirmDeleteTimerRef.current = setTimeout(() => {
        setConfirmDeleteId(null)
        confirmDeleteTimerRef.current = null
      }, 3000)
    },
    [
      deleteContact,
      addContact,
      addPendingChange,
      removePendingChange,
      selectedContactId,
      setSelectedContactId,
      syncAccount,
      confirmDeleteId,
      deleteContactCalendarEvents,
      restoreContactCalendarEvents,
    ]
  )

  const handleFieldSave = useCallback(
    async (contact: Contact, field: string, value: unknown): Promise<void> => {
      const ab = addressBooks.find((a) => a.id === contact.addressBookId)
      const accountId = contact.accountId || ab?.accountId
      const now = new Date().toISOString()

      // Update store optimistically
      updateContact(contact.id, { [field]: value, lastModified: now, syncStatus: 'pending' })

      // Queue pending update
      addPendingChange({
        id: uuidv4(),
        type: 'update',
        contactId: contact.id,
        addressBookId: contact.addressBookId,
        timestamp: now,
        retryCount: 0,
      })

      // Sync the account
      if (accountId) {
        await syncAccount(accountId)
      }
    },
    [addressBooks, updateContact, addPendingChange, syncAccount]
  )

  const handleFormSave = useCallback(
    async (contact: Contact): Promise<void> => {
      const now = new Date().toISOString()
      const existingContact = useContactStore.getState().contacts.find((c) => c.id === contact.id)
      const isNew = !existingContact

      if (isNew) {
        // Optimistic add to store
        addContact(contact)

        // Queue pending create
        addPendingChange({
          id: uuidv4(),
          type: 'create',
          contactId: contact.id,
          addressBookId: contact.addressBookId,
          timestamp: now,
          retryCount: 0,
        })

        // Select the new contact
        setSelectedContactId(contact.id)

        // Sync in background
        syncAccount(pendingAccountId).catch(() => {})
      } else {
        // Optimistic update in store
        updateContact(contact.id, { ...contact, lastModified: now, syncStatus: 'pending' })

        // Queue pending update
        addPendingChange({
          id: uuidv4(),
          type: 'update',
          contactId: contact.id,
          addressBookId: contact.addressBookId,
          timestamp: now,
          retryCount: 0,
        })

        // Sync in background — don't await, let the optimistic update stay visible
        syncAccount(contact.accountId).catch(() => {})
      }

      setIsFormOpen(false)
      setEditingContact(null)
    },
    [
      addContact,
      updateContact,
      addPendingChange,
      setSelectedContactId,
      syncAccount,
      pendingAccountId,
    ]
  )

  // Adding to the local store alone leaves the event invisible to the server,
  // and the next sync pass overwrites the store with server truth — so the
  // event vanished even within the session. Push it to CalDAV like the event
  // editor does, and undo has to retract it from the server too.
  const addContactEventToCalendar = useCallback(
    async (event: CalendarEvent, toastMessage: string): Promise<void> => {
      addEvent(event)
      showToast(toastMessage, {
        duration: 8000,
        onUndo: () => {
          useCalendarStore.getState().deleteEvent(event.id)
          void safeCalDAVDelete(deleteCalDAVEvent, event.calendarId, event.id)
        },
      })
      await safeCalDAVUpdate(createCalDAVEvent, event.calendarId, event, {})
    },
    [addEvent, createCalDAVEvent, deleteCalDAVEvent]
  )

  const buildContactEvent = useCallback(
    (kind: ContactEventKind, contact: Contact, calendarId: string): CalendarEvent | null => {
      if (kind === 'birthday') {
        if (!contact.birthday) return null
        return createBirthdayEvent({
          contactId: contact.id,
          contactName: contact.displayName,
          birthday: contact.birthday,
          calendarId,
          defaultReminderMinutes: useSettingsStore.getState().defaultReminderMinutes,
        })
      }
      if (!contact.anniversary) return null
      return createAnniversaryEvent({
        contactId: contact.id,
        contactName: contact.displayName,
        anniversary: contact.anniversary,
        calendarId,
        defaultReminderMinutes: useSettingsStore.getState().defaultReminderMinutes,
      })
    },
    []
  )

  // One calendar means there's nothing to ask about — create straight away.
  // With several, let the user say where it goes rather than silently picking
  // whichever calendar the server happened to list first (#84).
  const handleAddContactEventToCalendar = useCallback(
    async (kind: ContactEventKind, contact: Contact): Promise<void> => {
      if (targetCalendars.length === 0) {
        showToast(t('view.noCalendarAvailable'))
        return
      }
      if (targetCalendars.length > 1) {
        setCalendarPicker({ kind, contact })
        return
      }

      const event = buildContactEvent(kind, contact, targetCalendars[0].id)
      if (!event) return
      await addContactEventToCalendar(
        event,
        kind === 'birthday' ? t('view.birthdayAddedToCalendar') : t('view.anniversaryAddedToCalendar')
      )
    },
    [targetCalendars, buildContactEvent, addContactEventToCalendar]
  )

  const handlePickCalendar = useCallback(
    async (calendarId: string): Promise<void> => {
      if (!calendarPicker) return
      const { kind, contact } = calendarPicker
      setCalendarPicker(null)

      const event = buildContactEvent(kind, contact, calendarId)
      if (!event) return
      await addContactEventToCalendar(
        event,
        kind === 'birthday' ? t('view.birthdayAddedToCalendar') : t('view.anniversaryAddedToCalendar')
      )
    },
    [calendarPicker, buildContactEvent, addContactEventToCalendar]
  )

  const handleFormClose = (): void => {
    setIsFormOpen(false)
    setEditingContact(null)
    setShowPicker(false)
  }

  return (
    <div className={`${styles.contactsPage} ${showDetail ? styles.showDetail : ''}`}>
      {/* Left panel */}
      <div className={styles.clist}>
        <ContactList onNewContact={handleNewClick} loading={syncState.status === 'syncing'} />

        {/* Address book picker dropdown — anchored to the list panel, which is
            position: relative, so it lands under the "+ New" button */}
        {showPicker && visibleAddressBooks.length > 1 && (
          <div className={styles.addressBookPicker} ref={pickerRef}>
            <div className={styles.addressBookPickerLabel}>{t('view.chooseAddressBook')}</div>
            {visibleAddressBooks.map((ab) => (
              <button
                key={ab.id}
                type="button"
                className={styles.addressBookPickerItem}
                onClick={() => handlePickAddressBook(ab.id, ab.accountId)}
              >
                {ab.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right panel */}
      <div className={styles.cdetail}>
        {showDetail && (
          <button type="button" className={styles.mobileBack} onClick={handleBack}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M19 12H5" />
              <path d="m12 19-7-7 7-7" />
            </svg>
            {t('view.contacts')}
          </button>
        )}

        {selectedContact ? (
          <ContactDetail
            contact={selectedContact}
            onEdit={() => handleEdit(selectedContact)}
            onDelete={() => handleDelete(selectedContact)}
            onFieldSave={(field, value) => handleFieldSave(selectedContact, field, value)}
            confirmDelete={confirmDeleteId === selectedContact.id}
            onAddBirthdayToCalendar={
              selectedContact.birthday
                ? () => void handleAddContactEventToCalendar('birthday', selectedContact)
                : undefined
            }
            hasBirthdayEvent={
              selectedContact.birthday != null && hasBirthdayEvent(selectedContact.id, events)
            }
            onAddAnniversaryToCalendar={
              selectedContact.anniversary
                ? () => void handleAddContactEventToCalendar('anniversary', selectedContact)
                : undefined
            }
            hasAnniversaryEvent={
              selectedContact.anniversary != null && hasAnniversaryEvent(selectedContact.id, events)
            }
          />
        ) : (
          !isMobile && (
            <div className={styles.cdetailEmpty}>
              <svg
                viewBox="0 0 40 40"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M34 35v-2a8 8 0 0 0-8-8H14a8 8 0 0 0-8 8v2" />
                <circle cx="20" cy="12" r="8" />
              </svg>
              <p>{t('view.selectAContact')}</p>
            </div>
          )
        )}
      </div>

      {/* Contact form modal */}
      <ContactFormModal
        isOpen={isFormOpen}
        onClose={handleFormClose}
        contact={editingContact}
        addressBookId={
          editingContact?.addressBookId || pendingAddressBookId || visibleAddressBooks[0]?.id || ''
        }
        accountId={pendingAccountId}
        onSave={handleFormSave}
        onDelete={editingContact ? (c) => handleDelete(c) : undefined}
      />

      <Modal
        isOpen={calendarPicker !== null}
        onClose={() => setCalendarPicker(null)}
        title={
          calendarPicker?.kind === 'anniversary'
            ? t('view.addAnniversaryTo')
            : t('view.addBirthdayTo')
        }
      >
        <div className={styles.calendarPickerList}>
          {targetCalendars.map((cal) => (
            <button
              key={cal.id}
              type="button"
              className={styles.calendarPickerItem}
              onClick={() => void handlePickCalendar(cal.id)}
            >
              <span className={styles.calendarPickerDot} style={{ background: cal.color }} />
              {cal.name}
            </button>
          ))}
        </div>
      </Modal>
    </div>
  )
}
