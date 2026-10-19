import type { JSX, KeyboardEvent, PointerEvent } from 'react'
import { useMemo, useRef, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
/*  Tag filter                                                                 */
/* -------------------------------------------------------------------------- */

/** Pointer travel before a press on the tag row counts as a drag, not a click. */
const DRAG_THRESHOLD_PX = 4

interface TagFilterProps {
  /** Tags with the number of contacts carrying each, already sorted. */
  tags: Array<{ tag: string; count: number }>
  selectedTags: string[]
  onToggle: (tag: string) => void
  onClear: () => void
}

/** Above this many tags the chip row gives way to a checkbox dropdown. */
const TAG_DROPDOWN_THRESHOLD = 6

/** Picks the chip row for a handful of tags and the dropdown for many. */
function TagFilter(props: TagFilterProps): JSX.Element {
  return props.tags.length > TAG_DROPDOWN_THRESHOLD ? (
    <TagDropdown {...props} />
  ) : (
    <TagChips {...props} />
  )
}

/**
 * Chip row listing every tag in scope plus "All". It scrolls sideways when the
 * tags don't fit, fading each edge while more tags are hidden beyond it.
 */
function TagChips({ tags, selectedTags, onToggle, onClear }: TagFilterProps): JSX.Element {
  const { t } = useTranslation('contacts')
  const rowRef = useRef<HTMLDivElement>(null)
  const [moreToTheLeft, setMoreToTheLeft] = useState(false)
  const [moreToTheRight, setMoreToTheRight] = useState(false)

  // Mouse drag-to-scroll. Touch already scrolls natively, so only mice are handled.
  const drag = useRef({ startX: 0, startScroll: 0, active: false, moved: false })

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    drag.current = {
      startX: e.clientX,
      startScroll: e.currentTarget.scrollLeft,
      active: true,
      moved: false,
    }
  }

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d.active) return
    const dx = e.clientX - d.startX
    if (!d.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) return
      d.moved = true
      // Capture only once it is a drag, so a plain click still reaches its chip.
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    e.currentTarget.scrollLeft = d.startScroll - dx
  }

  const handlePointerEnd = (e: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current.active) return
    drag.current.active = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const updateFade = useCallback((): void => {
    const row = rowRef.current
    if (!row) return
    setMoreToTheLeft(row.scrollLeft > 1)
    setMoreToTheRight(row.scrollLeft + row.clientWidth < row.scrollWidth - 1)
  }, [])

  useEffect(() => {
    updateFade()
    const row = rowRef.current
    if (!row || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateFade)
    observer.observe(row)
    return () => observer.disconnect()
  }, [tags, updateFade])

  // A tag picked elsewhere (the contact detail) may sit off-screen in the row.
  useEffect(() => {
    rowRef.current
      ?.querySelector<HTMLElement>('[aria-pressed="true"]')
      ?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' })
  }, [selectedTags])

  return (
    <div
      ref={rowRef}
      className={`${styles.tagRow} ${moreToTheLeft ? styles.tagRowFadeStart : ''} ${moreToTheRight ? styles.tagRowFadeEnd : ''}`}
      role="group"
      aria-label={t('list.filterByTag')}
      data-component="contact-tag-filter"
      onScroll={updateFade}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onClickCapture={(e) => {
        // A drag that ends over a chip must not also toggle it.
        if (drag.current.moved) {
          e.preventDefault()
          e.stopPropagation()
          drag.current.moved = false
        }
      }}
      onWheel={(e) => {
        // Let a plain mouse wheel scroll the row sideways.
        if (e.deltaX === 0) e.currentTarget.scrollLeft += e.deltaY
      }}
    >
      <button
        type="button"
        className={`${styles.tagChip} ${selectedTags.length === 0 ? styles.tagChipActive : ''}`}
        aria-pressed={selectedTags.length === 0}
        onClick={onClear}
      >
        {t('list.allTags')}
      </button>
      {tags.map(({ tag, count }) => {
        const active = selectedTags.includes(tag)
        return (
          <button
            key={tag}
            type="button"
            className={`${styles.tagChip} ${active ? styles.tagChipActive : ''}`}
            aria-pressed={active}
            onClick={() => onToggle(tag)}
          >
            {tag}
            {active && <span className={styles.tagChipCount}>{count}</span>}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Dropdown with a checkbox per tag, for lists too long for the chip row. The
 * trigger summarises the selection; the panel stays open so several tags can
 * be ticked in one go.
 */
function TagDropdown({ tags, selectedTags, onToggle, onClear }: TagFilterProps): JSX.Element {
  const { t } = useTranslation('contacts')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: globalThis.PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
  }

  const summary =
    selectedTags.length === 0
      ? t('list.allTagsLabel')
      : selectedTags.length === 1
        ? selectedTags[0]
        : t('list.tagsMore', { tag: selectedTags[0], count: selectedTags.length - 1 })

  return (
    <div
      ref={rootRef}
      className={styles.tagDropdown}
      role="group"
      aria-label={t('list.filterByTag')}
      data-component="contact-tag-filter"
      onKeyDown={handleKeyDown}
    >
      <div
        className={`${styles.tagTrigger} ${selectedTags.length > 0 ? styles.tagTriggerActive : ''}`}
      >
        <button
          ref={triggerRef}
          type="button"
          className={styles.tagTriggerButton}
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <svg
            className={styles.tagTriggerIcon}
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
            <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
          </svg>
          <span className={styles.tagTriggerLabel}>{summary}</span>
          <svg
            className={`${styles.tagTriggerChevron} ${open ? styles.tagTriggerChevronOpen : ''}`}
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {selectedTags.length > 0 && (
          <button
            type="button"
            className={styles.tagTriggerClear}
            aria-label={t('list.clearTagFilter')}
            onClick={onClear}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        )}
      </div>
      {open && (
        <div className={styles.tagPanel}>
          <label className={styles.tagOption}>
            <input
              type="checkbox"
              className={styles.tagCheckbox}
              checked={selectedTags.length === 0}
              onChange={onClear}
            />
            <span className={styles.tagOptionLabel}>{t('list.allTagsLabel')}</span>
          </label>
          <div className={styles.tagPanelDivider} aria-hidden="true" />
          <div className={styles.tagPanelList}>
            {tags.map(({ tag, count }) => (
              <label key={tag} className={styles.tagOption}>
                <input
                  type="checkbox"
                  className={styles.tagCheckbox}
                  checked={selectedTags.includes(tag)}
                  onChange={() => onToggle(tag)}
                />
                <span className={styles.tagOptionLabel}>{tag}</span>
                <span className={styles.tagOptionCount}>{count}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
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
  const { t } = useTranslation('contacts')
  const searchQuery = useContactStore((s) => s.searchQuery)
  const setSearchQuery = useContactStore((s) => s.setSearchQuery)
  const selectedContactId = useContactStore((s) => s.selectedContactId)
  const setSelectedContactId = useContactStore((s) => s.setSelectedContactId)
  const selectedTags = useContactStore((s) => s.selectedTags)
  const setSelectedTags = useContactStore((s) => s.setSelectedTags)
  const toggleSelectedTag = useContactStore((s) => s.toggleSelectedTag)
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
        tags: selectedTags,
      })
    }

    // No search query — filter manually
    let filtered = contacts.filter((c) => filterAddressBookIds.includes(c.addressBookId))

    if (selectedTags.length > 0) {
      filtered = filtered.filter((c) => selectedTags.some((tag) => c.categories.includes(tag)))
    }

    return filtered.sort((a, b) => a.displayName.localeCompare(b.displayName))
  }, [contacts, addressBooks, searchQuery, selectedTags, filterAddressBookId])

  const groups = useMemo(() => groupByAlpha(filteredContacts), [filteredContacts])

  // Tags offered by the filter: every tag among the contacts of the address
  // books in scope, regardless of search or the tag already chosen, so the
  // chips don't change under the user's finger.
  const tagOptions = useMemo(() => {
    const scope = filterAddressBookId
      ? [filterAddressBookId]
      : addressBooks.filter((ab) => ab.isVisible).map((ab) => ab.id)
    const counts = new Map<string, number>()
    for (const c of contacts) {
      if (!scope.includes(c.addressBookId)) continue
      for (const tag of new Set(c.categories)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
    }
    // Keep active tags listed even when the scope has none, so they can be cleared.
    for (const tag of selectedTags) if (!counts.has(tag)) counts.set(tag, 0)
    return [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([tag, count]) => ({ tag, count }))
  }, [contacts, addressBooks, filterAddressBookId, selectedTags])

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
          placeholder={t('list.searchContacts')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label={t('list.searchContacts')}
        />
        {searchQuery && (
          <button
            type="button"
            className={styles.clearBtn}
            onClick={() => {
              setSearchQuery('')
              inputRef.current?.focus()
            }}
            aria-label={t('list.clearSearch')}
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
          {t('list.contactCount', { count: filteredContacts.length })}
        </span>
        <button type="button" className={styles.newBtn} onClick={onNewContact}>
          {t('list.newContact')}
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
              background: 'var(--color-bg-secondary)',
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
            }}
          >
            <option value="">{t('list.allAddressBooks')}</option>
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

      {/* Tag filter */}
      {tagOptions.length > 0 && (
        <TagFilter
          tags={tagOptions}
          selectedTags={selectedTags}
          onToggle={toggleSelectedTag}
          onClear={() => setSelectedTags([])}
        />
      )}

      {/* Grouped contact list */}
      <div className={styles.list}>
        {groups.length === 0 ? (
          <div className={styles.emptyState}>
            {searchQuery ? (
              <>
                <span className={styles.emptyTitle}>{t('list.noMatches')}</span>
                <span>{t('list.noContactsMatch', { query: searchQuery })}</span>
              </>
            ) : (
              <>
                <span className={styles.emptyTitle}>{t('list.noContacts')}</span>
                <span>{t('list.syncToSeeContacts')}</span>
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
