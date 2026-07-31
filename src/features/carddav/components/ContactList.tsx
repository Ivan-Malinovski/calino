import type { JSX, KeyboardEvent } from 'react'
import { useMemo, useRef, useCallback, useEffect } from 'react'
import { useContactStore } from '@/store/contactStore'
import type { Contact } from '../types'
import { initializeContactSearchIndex, searchContacts } from '../lib/contactSearchIndex'
import { getInitials, getAvatarColor } from '../lib/avatars'
import styles from './ContactList.module.css'

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Get the primary email or first email. */
function getPrimaryEmail(contact: Contact): string | null {
  const primary = contact.emails.find((e) => e.isPrimary)
  if (primary) return primary.value
  return contact.emails[0]?.value ?? null
}

/** Return the uppercase first letter for section grouping. */
function getAlphaKey(name: string): string {
  if (!name) return '#'
  const first = name.trim().charAt(0).toUpperCase()
  return /[A-Z]/.test(first) ? first : '#'
}

/* -------------------------------------------------------------------------- */
/*  Sub-components                                                             */
/* -------------------------------------------------------------------------- */

function ContactListItem({
  contact,
  isSelected,
  onSelect,
}: {
  contact: Contact
  isSelected: boolean
  onSelect: () => void
}): JSX.Element {
  const email = getPrimaryEmail(contact)
  const initials = getInitials(contact.displayName)
  const avatarColor = getAvatarColor(contact.displayName)

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect()
    }
  }

  return (
    <div
      className={`${styles.contactItem} ${isSelected ? styles.selected : ''}`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
    >
      {isSelected && <div className={styles.selectedRail} />}

      <div className={styles.avatar} style={{ backgroundColor: avatarColor }}>
        {contact.photo ? <img src={contact.photo} alt="" /> : initials}
      </div>

      <div className={styles.contactInfo}>
        <div className={styles.contactName}>{contact.displayName}</div>
        {contact.organization ? (
          <div className={styles.contactOrg}>{contact.organization}</div>
        ) : email ? (
          <div className={styles.contactEmail}>{email}</div>
        ) : null}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Alphabetical grouping                                                      */
/* -------------------------------------------------------------------------- */

interface AlphaGroup {
  letter: string
  contacts: Contact[]
}

function groupByAlpha(contacts: Contact[]): AlphaGroup[] {
  const map = new Map<string, Contact[]>()
  for (const c of contacts) {
    const key = getAlphaKey(c.displayName)
    const arr = map.get(key)
    if (arr) {
      arr.push(c)
    } else {
      map.set(key, [c])
    }
  }
  // Sort groups alphabetically, with '#' at the end
  const sorted = [...map.entries()].sort(([a], [b]) => {
    if (a === '#') return 1
    if (b === '#') return -1
    return a.localeCompare(b)
  })
  return sorted.map(([letter, list]) => ({ letter, contacts: list }))
}

/* -------------------------------------------------------------------------- */
/*  ContactList                                                                */
/* -------------------------------------------------------------------------- */

function ContactListSkeleton(): JSX.Element {
  return (
    <div className={styles.skeletonContactList}>
      <div className={styles.skeletonSearchBar} />
      <div className={styles.skeletonMetaBar}>
        <div className={styles.skeletonCount} />
        <div className={styles.skeletonNewBtn} />
      </div>
      {[0, 1, 2].map((g) => (
        <div key={g}>
          <div className={styles.skeletonAlphaHeader} />
          {[0, 1, 2].map((i) => (
            <div key={i} className={styles.skeletonContactItem}>
              <div className={styles.skeletonAvatar} />
              <div className={styles.skeletonContactText}>
                <div className={`${styles.skeletonBar} ${styles['skeletonBar--name']}`} />
                <div className={`${styles.skeletonBar} ${styles['skeletonBar--sub']}`} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

interface ContactListProps {
  onNewContact?: () => void
  loading?: boolean
}

export function ContactList({ onNewContact, loading }: ContactListProps = {}): JSX.Element {
  const searchQuery = useContactStore((s) => s.searchQuery)
  const setSearchQuery = useContactStore((s) => s.setSearchQuery)
  const selectedContactId = useContactStore((s) => s.selectedContactId)
  const setSelectedContactId = useContactStore((s) => s.setSelectedContactId)
  const selectedTag = useContactStore((s) => s.selectedTag)
  const filterAddressBookId = useContactStore((s) => s.filterAddressBookId)
  const setFilterAddressBookId = useContactStore((s) => s.setFilterAddressBookId)
  const contacts = useContactStore((s) => s.contacts)
  const addressBooks = useContactStore((s) => s.addressBooks)

  const inputRef = useRef<HTMLInputElement>(null)

  // Rebuild the Fuse index when contacts change, deferred to idle time.
  //
  // Building it synchronously in the effect blocked the commit on every
  // contact mutation — during a CardDAV sync that's once per contact written,
  // each rebuild walking the whole collection. The index is only read by
  // searchContacts below, so a frame of staleness is invisible: a search
  // issued in that window falls back to the previous collection and is
  // corrected as soon as the rebuild lands.
  useEffect(() => {
    const build = (): void => initializeContactSearchIndex(contacts)
    if (typeof globalThis.requestIdleCallback === 'function') {
      const handle = globalThis.requestIdleCallback(build, { timeout: 1000 })
      return () => globalThis.cancelIdleCallback(handle)
    }
    const handle = setTimeout(build, 0)
    return () => clearTimeout(handle)
  }, [contacts])

  const filteredContacts = useMemo(() => {
    // Filter by visible address books
    const visibleAddressBookIds = addressBooks.filter((ab) => ab.isVisible).map((ab) => ab.id)

    // Build filter criteria
    const filterAddressBookIds = filterAddressBookId ? [filterAddressBookId] : visibleAddressBookIds

    if (searchQuery.trim()) {
      // Use Fuse.js search
      return searchContacts(searchQuery, {
        addressBookIds: filterAddressBookIds,
        tag: selectedTag ?? undefined,
      })
    }

    // No search query — filter manually
    let filtered = contacts.filter((c) => filterAddressBookIds.includes(c.addressBookId))

    if (selectedTag) {
      filtered = filtered.filter((c) => c.categories.includes(selectedTag))
    }

    return filtered.sort((a, b) => a.displayName.localeCompare(b.displayName))
  }, [contacts, addressBooks, searchQuery, selectedTag, filterAddressBookId])

  const groups = useMemo(() => groupByAlpha(filteredContacts), [filteredContacts])

  const handleSelect = useCallback(
    (id: string) => {
      setSelectedContactId(id)
    },
    [setSelectedContactId]
  )

  if (loading && contacts.length === 0) {
    return (
      <div className={styles.container}>
        <ContactListSkeleton />
      </div>
    )
  }

  return (
    <div className={styles.container}>
      {/* Search bar */}
      <div className={styles.searchBar}>
        <svg
          className={styles.searchIcon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          className={styles.searchInput}
          placeholder="Search contacts…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search contacts"
        />
        {searchQuery && (
          <button
            type="button"
            className={styles.clearBtn}
            onClick={() => {
              setSearchQuery('')
              inputRef.current?.focus()
            }}
            aria-label="Clear search"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Meta bar: count + new button */}
      <div className={styles.metaBar}>
        <span className={styles.count}>
          {filteredContacts.length} {filteredContacts.length === 1 ? 'contact' : 'contacts'}
        </span>
        <button type="button" className={styles.newBtn} onClick={onNewContact}>
          + New
        </button>
      </div>

      {/* Address book filter */}
      {addressBooks.length > 1 && (
        <div style={{ padding: '0 12px 6px' }}>
          <select
            value={filterAddressBookId || ''}
            onChange={(e) => setFilterAddressBookId(e.target.value || null)}
            style={{
              width: '100%',
              padding: '4px 8px',
              fontSize: '11px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--line)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
          >
            <option value="">All address books</option>
            {addressBooks
              .filter((ab) => ab.isVisible)
              .map((ab) => (
                <option key={ab.id} value={ab.id}>
                  {ab.name}
                </option>
              ))}
          </select>
        </div>
      )}

      {/* Active tag filter */}
      {selectedTag && (
        <div className={styles.tagFilter}>
          <span className={styles.tagFilterLabel}>Filtered by:</span>
          <span className={styles.tagFilterTag}>{selectedTag}</span>
          <button
            type="button"
            className={styles.tagFilterClear}
            onClick={() => useContactStore.getState().setSelectedTag(null)}
          >
            ×
          </button>
        </div>
      )}

      {/* Grouped contact list */}
      <div className={styles.list}>
        {groups.length === 0 ? (
          <div className={styles.emptyState}>
            {searchQuery ? (
              <>
                <span className={styles.emptyTitle}>No matches</span>
                <span>No contacts match &ldquo;{searchQuery}&rdquo;</span>
              </>
            ) : (
              <>
                <span className={styles.emptyTitle}>No contacts</span>
                <span>Sync your CardDAV account to see contacts here.</span>
              </>
            )}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.letter} className={styles.alphaGroup}>
              <div className={styles.alphaHeader}>{group.letter}</div>
              {group.contacts.map((contact) => (
                <ContactListItem
                  key={contact.id}
                  contact={contact}
                  isSelected={contact.id === selectedContactId}
                  onSelect={() => handleSelect(contact.id)}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
