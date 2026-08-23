import type { JSX } from 'react'
import { useState, useMemo, useRef, useEffect } from 'react'
import type { Contact } from '../types'
import { useContactStore } from '@/store/contactStore'
import { resolveContactRef, toContactRef } from '../lib/contactRefs'
import styles from '@/features/calendar/components/EventModal.module.css'

/**
 * Renders a stored MEMBER uid as the contact's name, falling back to the raw
 * value when it can't be resolved (e.g. a member whose contact isn't synced).
 */
export function MemberName({ uid }: { uid: string }): JSX.Element {
  const contacts = useContactStore((s) => s.contacts)
  const target = resolveContactRef(uid, contacts)
  return (
    <span
      data-component="member-name"
      style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}
      title={uid}
    >
      {target ? target.displayName : uid}
    </span>
  )
}

interface ContactPickerProps {
  /** Current raw RELATED/MEMBER value (a `urn:uuid:…` ref or, when allowed, free text). */
  value: string
  onChange: (value: string) => void
  /** Contacts that must not be offered (e.g. the contact being edited). */
  excludeIds?: string[]
  /**
   * When true, a query that matches no contact is kept as a literal value.
   * RELATED may name a person who isn't in the address book (RFC 6350 §6.6.6);
   * MEMBER may not, so groups pass false.
   */
  allowFreeText?: boolean
  placeholder?: string
  'data-component'?: string
}

/**
 * Type-to-search picker for choosing a contact to reference.
 *
 * Writes the canonical `urn:uuid:<uid>` form so the reference resolves on
 * display, which is what issue #87 was about — previously this was a bare text
 * input and users had to paste a UUID by hand.
 */
export function ContactPicker({
  value,
  onChange,
  excludeIds = [],
  allowFreeText = false,
  placeholder,
  'data-component': dataComponent,
}: ContactPickerProps): JSX.Element {
  const contacts = useContactStore((s) => s.contacts)
  const selected = resolveContactRef(value, contacts)

  // The visible text is derived from `value` unless the user is mid-typing, in
  // which case `draft` wins. Deriving rather than syncing in an effect means an
  // external change to `value` shows up without a second render pass.
  const [draft, setDraft] = useState<string | null>(null)
  const query = draft ?? (selected ? selected.displayName : value)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close the dropdown on an outside click.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent): void => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const matches = useMemo(() => {
    const excluded = new Set(excludeIds)
    const pool = contacts.filter((c) => !excluded.has(c.id))
    const q = query.trim().toLowerCase()
    if (!q) return pool.slice(0, 8)
    const haystack = (c: Contact): string =>
      [c.displayName, c.nickname, c.organization, ...c.emails.map((e) => e.value)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
    return pool.filter((c) => haystack(c).includes(q)).slice(0, 8)
  }, [contacts, query, excludeIds])

  const choose = (contact: Contact): void => {
    onChange(toContactRef(contact.id))
    setDraft(null)
    setOpen(false)
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', flex: 1 }}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        data-component={dataComponent}
        placeholder={placeholder ?? 'Search contacts…'}
        value={query}
        className={styles.input}
        style={{ width: '100%' }}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setDraft(e.target.value)
          setOpen(true)
          // Free-text values are stored as typed; a picked contact is stored as
          // a uuid ref by `choose`. Clearing the box clears the value.
          if (allowFreeText) onChange(e.target.value)
          else if (e.target.value === '') onChange('')
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && matches.length > 0) {
            e.preventDefault()
            choose(matches[0])
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {open && matches.length > 0 && (
        <ul
          data-component="contact-picker-options"
          style={{
            position: 'absolute',
            zIndex: 20,
            top: '100%',
            left: 0,
            right: 0,
            margin: 0,
            padding: 4,
            listStyle: 'none',
            maxHeight: 200,
            overflowY: 'auto',
            background: 'var(--color-surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md, 0 4px 12px rgb(0 0 0 / 0.15))',
          }}
        >
          {matches.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                data-component="contact-picker-option"
                data-contact-id={c.id}
                onClick={() => choose(c)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 8px',
                  background: 'none',
                  border: 'none',
                  font: 'inherit',
                  cursor: 'pointer',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                {c.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
