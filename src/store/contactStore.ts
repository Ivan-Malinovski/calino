import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { safeLocalStorage } from '@/lib/storage'
import type { Contact, AddressBook, PendingContactChange } from '@/features/carddav/types'

export interface ContactStore {
  contacts: Contact[]
  addressBooks: AddressBook[]
  selectedContactId: string | null
  selectedTag: string | null
  filterAddressBookId: string | null
  searchQuery: string
  pendingChanges: PendingContactChange[]

  // Actions
  addContact: (contact: Contact) => void
  updateContact: (id: string, updates: Partial<Contact>) => void
  deleteContact: (id: string) => void
  setSelectedContactId: (id: string | null) => void
  setSelectedTag: (tag: string | null) => void
  setFilterAddressBookId: (id: string | null) => void
  setSearchQuery: (query: string) => void

  // Address book actions
  addAddressBook: (addressBook: AddressBook) => void
  updateAddressBook: (id: string, updates: Partial<AddressBook>) => void
  deleteAddressBook: (id: string) => void

  // Bulk operations
  setContacts: (contacts: Contact[]) => void
  setAddressBooks: (addressBooks: AddressBook[]) => void

  // Pending changes
  addPendingChange: (change: PendingContactChange) => void
  removePendingChange: (changeId: string) => void
  incrementRetryCount: (changeId: string) => void
  clearPendingChanges: () => void

  // Selectors
  getContactsForAddressBook: (addressBookId: string) => Contact[]
  getFilteredContacts: () => Contact[]
  getContactById: (id: string) => Contact | undefined
}

export const useContactStore = create<ContactStore>()(
  persist(
    (set, get) => ({
      contacts: [],
      addressBooks: [],
      selectedContactId: null,
      selectedTag: null,
      filterAddressBookId: null,
      searchQuery: '',
      pendingChanges: [],

      addContact: (contact: Contact): void => {
        set((state) => ({
          contacts: [...state.contacts, contact],
        }))
      },

      updateContact: (id: string, updates: Partial<Contact>): void => {
        set((state) => ({
          contacts: state.contacts.map((c) => (c.id === id ? { ...c, ...updates } : c)),
        }))
      },

      deleteContact: (id: string): void => {
        set((state) => ({
          contacts: state.contacts.filter((c) => c.id !== id),
          selectedContactId: state.selectedContactId === id ? null : state.selectedContactId,
        }))
      },

      setSelectedContactId: (id: string | null): void => {
        set({ selectedContactId: id })
      },

      setSelectedTag: (tag: string | null): void => {
        set({ selectedTag: tag })
      },

      setFilterAddressBookId: (id: string | null): void => {
        set({ filterAddressBookId: id })
      },

      setSearchQuery: (query: string): void => {
        set({ searchQuery: query })
      },

      addAddressBook: (addressBook: AddressBook): void => {
        set((state) => ({
          addressBooks: [...state.addressBooks, addressBook],
        }))
      },

      updateAddressBook: (id: string, updates: Partial<AddressBook>): void => {
        set((state) => ({
          addressBooks: state.addressBooks.map((ab) => (ab.id === id ? { ...ab, ...updates } : ab)),
        }))
      },

      deleteAddressBook: (id: string): void => {
        set((state) => ({
          addressBooks: state.addressBooks.filter((ab) => ab.id !== id),
          contacts: state.contacts.filter((c) => c.addressBookId !== id),
        }))
      },

      setContacts: (contacts: Contact[]): void => {
        set({ contacts })
      },

      setAddressBooks: (addressBooks: AddressBook[]): void => {
        set({ addressBooks })
      },

      /**
       * Queue a change, collapsing it against anything already queued for the same contact.
       *
       * Without this the queue grows one entry per keystroke-save and replays redundant
       * writes; worse, a create followed by a delete would push a card to the server just to
       * delete it again (or fail, since the delete has no url to work with).
       */
      addPendingChange: (change: PendingContactChange): void => {
        set((state) => {
          const others = state.pendingChanges.filter((c) => c.contactId !== change.contactId)
          const forContact = state.pendingChanges.filter((c) => c.contactId === change.contactId)

          if (change.type === 'delete') {
            const queuedCreate = forContact.find((c) => c.type === 'create')
            if (queuedCreate) {
              // Never reached the server — creating and deleting cancel out entirely.
              return { pendingChanges: others }
            }
            return { pendingChanges: [...others, change] }
          }

          if (change.type === 'update') {
            const queuedCreate = forContact.find((c) => c.type === 'create')
            if (queuedCreate) {
              // The create replays from the live contact, so it already carries this edit.
              return { pendingChanges: [...others, queuedCreate] }
            }
            // Supersede any earlier update; replay reads the live contact anyway.
            const queuedDeletes = forContact.filter((c) => c.type === 'delete')
            return { pendingChanges: [...others, ...queuedDeletes, change] }
          }

          return { pendingChanges: [...others, change] }
        })
      },

      incrementRetryCount: (changeId: string): void => {
        set((state) => ({
          pendingChanges: state.pendingChanges.map((c) =>
            c.id === changeId ? { ...c, retryCount: c.retryCount + 1 } : c
          ),
        }))
      },

      removePendingChange: (changeId: string): void => {
        set((state) => ({
          pendingChanges: state.pendingChanges.filter((c) => c.id !== changeId),
        }))
      },

      clearPendingChanges: (): void => {
        set({ pendingChanges: [] })
      },

      getContactsForAddressBook: (addressBookId: string): Contact[] => {
        return get().contacts.filter((c) => c.addressBookId === addressBookId)
      },

      getFilteredContacts: (): Contact[] => {
        const { contacts, searchQuery, selectedTag, filterAddressBookId, addressBooks } = get()

        // Filter by visible address books
        const visibleAddressBookIds = addressBooks.filter((ab) => ab.isVisible).map((ab) => ab.id)

        let filtered = contacts.filter((c) => visibleAddressBookIds.includes(c.addressBookId))

        // Filter by specific address book
        if (filterAddressBookId) {
          filtered = filtered.filter((c) => c.addressBookId === filterAddressBookId)
        }

        // Filter by tag
        if (selectedTag) {
          filtered = filtered.filter((c) => c.categories.includes(selectedTag))
        }

        // Filter by search query
        if (searchQuery.trim()) {
          const query = searchQuery.toLowerCase()
          filtered = filtered.filter(
            (c) =>
              c.displayName.toLowerCase().includes(query) ||
              c.nickname.toLowerCase().includes(query) ||
              c.organization.toLowerCase().includes(query) ||
              c.emails.some((e) => e.value.toLowerCase().includes(query)) ||
              c.phones.some((p) => p.value.includes(query))
          )
        }

        // Sort by display name
        return filtered.sort((a, b) => a.displayName.localeCompare(b.displayName))
      },

      getContactById: (id: string): Contact | undefined => {
        return get().contacts.find((c) => c.id === id)
      },
    }),
    {
      name: 'calino-contacts',
      storage: createJSONStorage(() => safeLocalStorage),
      version: 3,
      migrate: (persistedState: unknown) => {
        const state = persistedState as Record<string, unknown> | undefined
        const contacts = (state?.contacts ?? []) as Contact[]
        // Add defaults for new fields on existing contacts
        const migratedContacts = contacts.map((c) => ({
          ...c,
          langs: c.langs ?? [],
          related: c.related ?? [],
          xmlData: c.xmlData ?? null,
        }))
        return {
          // Photos survive: initContactPhotos() copies any still-inline photo
          // into IndexedDB before the first persist rewrites this blob.
          contacts: migratedContacts,
          addressBooks: state?.addressBooks ?? [],
          pendingChanges: state?.pendingChanges ?? [],
          selectedContactId: null,
          filterAddressBookId: null,
          searchQuery: '',
        }
      },
      partialize: (state) => ({
        // Contacts are the biggest thing we persist, and photos used to be in
        // here twice — once as `photo`, once more embedded in `rawVCard` — which
        // is what pushed installs with a few hundred contacts past the
        // localStorage quota. Both are dropped: photo data lives in IndexedDB
        // (see lib/contactPhotoStore), and rawVCard is regenerated on parse.
        contacts: state.contacts.map((contact) => {
          const persisted = {
            ...contact,
            // Keep external URLs (they round-trip as PHOTO;VALUE=URI), clear
            // inline data URIs.
            photo: contact.photo?.startsWith('data:') ? null : contact.photo,
          }
          delete persisted.rawVCard
          return persisted
        }),
        addressBooks: state.addressBooks,
        pendingChanges: state.pendingChanges,
      }),
    }
  )
)
