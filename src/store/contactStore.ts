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

      addPendingChange: (change: PendingContactChange): void => {
        set((state) => ({
          pendingChanges: [...state.pendingChanges, change],
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
      version: 2,
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
          contacts: migratedContacts,
          addressBooks: state?.addressBooks ?? [],
          pendingChanges: state?.pendingChanges ?? [],
          selectedContactId: null,
          filterAddressBookId: null,
          searchQuery: '',
        }
      },
      partialize: (state) => ({
        contacts: state.contacts,
        addressBooks: state.addressBooks,
        pendingChanges: state.pendingChanges,
      }),
    }
  )
)
