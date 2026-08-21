import { useState, useMemo } from 'react'
import type { JSX } from 'react'
import type { Contact } from '../types'
import { useContactStore } from '@/store/contactStore'
import { MarkdownView } from '@/lib/markdown'
import { getInitials, getAvatarColor } from '../lib/avatars'
import { isContactRef, resolveContactRef, buildContactLookup } from '../lib/contactRefs'
import * as contactDates from '../lib/contactDates'
import styles from './ContactsView.module.css'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const avatarColor = getAvatarColor

function formatDate(dateStr: string): string {
  try {
    const date = contactDates.parseDateOnly(dateStr)
    if (!date) return dateStr
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return dateStr
  }
}

/**
 * A RELATED / MEMBER value.
 *
 * vCard lets these be either a plain name or a UID reference (`urn:uuid:…`).
 * When it's a reference we resolve it to the contact and render a link;
 * otherwise we fall back to showing the value as typed. Resolution is not
 * scoped to the current address book — see lib/contactRefs.
 */
function RelationValue({
  value,
  siblingOf,
  contactLookup,
}: {
  value: string
  siblingOf: Contact
  /** Memoized id → contact map, built once in the parent (see #2.2). */
  contactLookup: Map<string, Contact>
}): JSX.Element {
  const addressBooks = useContactStore((s) => s.addressBooks)
  const setSelectedContactId = useContactStore((s) => s.setSelectedContactId)

  const target = resolveContactRef(value, contactLookup)
  if (!target) {
    // A plain name is a legal RELATED/MEMBER value and renders as-is; only a
    // reference that failed to resolve gets the friendly fallback instead of a
    // raw urn:uuid:… URI (deleted contact, pending sync). The UID stays on the
    // title so a dangling reference is still diagnosable without the raw URI
    // taking over the row.
    const unresolvedRef = isContactRef(value)
    return (
      <span className={styles.infoFieldValue} title={unresolvedRef ? value : undefined}>
        {unresolvedRef ? 'Unknown Contact' : value}
      </span>
    )
  }

  const otherBook =
    target.addressBookId !== siblingOf.addressBookId
      ? addressBooks.find((a) => a.id === target.addressBookId)
      : undefined

  return (
    <button
      type="button"
      data-component="contact-relation-link"
      data-contact-id={target.id}
      className={styles.infoFieldValue}
      onClick={() => setSelectedContactId(target.id)}
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        font: 'inherit',
        color: 'var(--accent)',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      {target.displayName}
      {otherBook && (
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}> · {otherBook.name}</span>
      )}
    </button>
  )
}

function getAge(birthday: string): number {
  return contactDates.getAge(birthday)
}

function daysUntilNext(date: string): number {
  return contactDates.daysUntilNext(date)
}

function formatAddress(addr: Contact['addresses'][0]): string {
  const lines: string[] = []
  if (addr.street) lines.push(addr.street)
  const cityRegion: string[] = []
  if (addr.city) cityRegion.push(addr.city)
  if (addr.region) cityRegion.push(addr.region)
  if (addr.postalCode) cityRegion.push(addr.postalCode)
  if (addr.country) cityRegion.push(addr.country)
  if (cityRegion.length > 0) lines.push(cityRegion.join(', '))
  return lines.join('\n') || addr.extended || ''
}

// ---------------------------------------------------------------------------
// Label maps
// ---------------------------------------------------------------------------

const EMAIL_TYPE_LABELS: Record<string, string> = {
  home: 'Home',
  work: 'Work',
  other: 'Other',
  pref: 'Preferred',
}

const PHONE_TYPE_LABELS: Record<string, string> = {
  home: 'Home',
  work: 'Work',
  cell: 'Mobile',
  fax: 'Fax',
  other: 'Other',
  pref: 'Preferred',
}

const ADDRESS_TYPE_LABELS: Record<string, string> = {
  home: 'Home',
  work: 'Work',
  other: 'Other',
  pref: 'Preferred',
}

const RELATED_TYPE_LABELS: Record<string, string> = {
  friend: 'Friend',
  'co-worker': 'Co-worker',
  family: 'Family',
  child: 'Child',
  spouse: 'Spouse',
  agent: 'Agent',
  emergency: 'Emergency',
  other: 'Other',
}

// ---------------------------------------------------------------------------
// Inline edit helpers
// ---------------------------------------------------------------------------

interface InlineEdit {
  field: string
  original: string
  value: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ContactDetailProps {
  contact: Contact
  onEdit?: () => void
  onDelete?: () => void
  onFieldSave?: (field: string, value: unknown) => void
  confirmDelete?: boolean
  onAddBirthdayToCalendar?: () => void
  hasBirthdayEvent?: boolean
  onAddAnniversaryToCalendar?: () => void
  hasAnniversaryEvent?: boolean
}

export function ContactDetail({
  contact,
  onEdit,
  onDelete,
  onFieldSave,
  confirmDelete,
  onAddBirthdayToCalendar,
  hasBirthdayEvent = false,
  onAddAnniversaryToCalendar,
  hasAnniversaryEvent = false,
}: ContactDetailProps): JSX.Element {
  const [inlineEditing, setInlineEditing] = useState<InlineEdit | null>(null)

  // One subscription + one O(N) pass, memoized: every RelationValue renders
  // against this map instead of each subscribing to the whole contacts array
  // and scanning it per relation (O(M×N) and a re-render of every relation on
  // any contact change — see review finding 2.2).
  const allContacts = useContactStore((s) => s.contacts)
  const contactLookup = useMemo(() => buildContactLookup(allContacts), [allContacts])

  function startInlineEdit(field: string, currentValue: string) {
    setInlineEditing({ field, original: currentValue, value: currentValue })
  }

  function saveInlineEdit() {
    if (inlineEditing && onFieldSave) {
      const { field, value } = inlineEditing
      onFieldSave(field, value)
    }
    setInlineEditing(null)
  }

  function cancelInlineEdit() {
    setInlineEditing(null)
  }

  function saveInlineEditEmail(index: number) {
    if (inlineEditing && onFieldSave) {
      const newEmails = [...contact.emails]
      newEmails[index] = { ...newEmails[index], value: inlineEditing.value }
      onFieldSave('emails', newEmails)
    }
    setInlineEditing(null)
  }

  function saveInlineEditPhone(index: number) {
    if (inlineEditing && onFieldSave) {
      const newPhones = [...contact.phones]
      newPhones[index] = { ...newPhones[index], value: inlineEditing.value }
      onFieldSave('phones', newPhones)
    }
    setInlineEditing(null)
  }

  const color = avatarColor(contact.displayName)
  const initials = getInitials(contact.displayName)

  const roleOrg = [contact.role || contact.title, contact.organization]
    .filter(Boolean)
    .join(' \u00b7 ')

  const hasInfo =
    contact.emails.length > 0 ||
    contact.phones.length > 0 ||
    contact.addresses.length > 0 ||
    contact.urls.length > 0 ||
    contact.ims.length > 0 ||
    // The same block renders LANGUAGE / RELATED / MEMBERS, so a contact whose
    // only extra data is a relation or group membership must not be treated as
    // having no info — that hid the section entirely.
    (contact.langs?.length ?? 0) > 0 ||
    (contact.related?.length ?? 0) > 0 ||
    (contact.isGroup && contact.memberUids.length > 0)

  return (
    <div className={styles.detailContent}>
      {/* ─── Hero ─── */}
      <div className={styles.hero}>
        <div className={styles.heroAvatar} style={{ background: color }}>
          {contact.photo ? (
            <img src={contact.photo} alt={contact.displayName} />
          ) : (
            <span>{initials}</span>
          )}
        </div>

        <div className={styles.heroText}>
          <div
            className={styles.inlineEditWrapper}
            onDoubleClick={() => startInlineEdit('displayName', contact.displayName)}
          >
            {inlineEditing?.field === 'displayName' ? (
              <input
                className={`${styles.inlineInput} ${styles.heroNameInput}`}
                value={inlineEditing.value}
                onChange={(e) => setInlineEditing({ ...inlineEditing, value: e.target.value })}
                onBlur={() => saveInlineEdit()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveInlineEdit()
                  if (e.key === 'Escape') cancelInlineEdit()
                }}
                autoFocus
              />
            ) : (
              <h2 className={styles.heroName}>{contact.displayName}</h2>
            )}
          </div>
          {roleOrg && <p className={styles.heroRole}>{roleOrg}</p>}
          {contact.nickname && (
            <p className={styles.heroRole} style={{ fontStyle: 'italic' }}>
              “{contact.nickname}”
            </p>
          )}
          {(() => {
            const ab = useContactStore
              .getState()
              .addressBooks.find((a) => a.id === contact.addressBookId)
            return ab && useContactStore.getState().addressBooks.length > 1 ? (
              <p className={styles.heroRole} style={{ fontSize: 12, opacity: 0.6 }}>
                {ab.name}
              </p>
            ) : null
          })()}
          <div className={styles.heroActions}>
            <a
              href={`mailto:${contact.emails[0]?.value ?? ''}`}
              className={styles.btnSecondary}
              hidden={contact.emails.length === 0}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
              Send email
            </a>
          </div>
        </div>

        <div className={styles.heroIconActions}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onEdit}
            title="Edit contact"
            aria-label="Edit contact"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              <path d="m15 5 4 4" />
            </svg>
          </button>
          <button
            type="button"
            className={`${styles.iconBtn} ${confirmDelete ? styles.btnDeleteConfirm : ''}`}
            onClick={onDelete}
            title={confirmDelete ? 'Click again to confirm' : 'Delete contact'}
            aria-label="Delete contact"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
            {confirmDelete && <span className={styles.btnDeleteLabel}>Confirm?</span>}
          </button>
        </div>
      </div>

      {/* ─── Body ─── */}
      <div className={styles.body}>
        {/* Main column */}
        <div className={styles.bodyMain}>
          {/* Info card */}
          {hasInfo && (
            <div className={styles.infoCard}>
              {/* Emails */}
              {contact.emails.length > 0 && (
                <div className={styles.infoField}>
                  <span className={styles.infoFieldLabel}>EMAIL</span>
                  {contact.emails.map((email, i) => (
                    <div key={`email-${i}`} className={styles.infoFieldGrid}>
                      <span className={styles.infoFieldSub}>
                        {EMAIL_TYPE_LABELS[email.type] ?? email.type}
                      </span>
                      {inlineEditing?.field === `email_${i}` ? (
                        <input
                          className={styles.inlineInput}
                          value={inlineEditing.value}
                          onChange={(e) =>
                            setInlineEditing({ ...inlineEditing, value: e.target.value })
                          }
                          onBlur={() => saveInlineEditEmail(i)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveInlineEditEmail(i)
                            if (e.key === 'Escape') cancelInlineEdit()
                          }}
                          autoFocus
                        />
                      ) : (
                        <span
                          className={styles.infoFieldValue}
                          onDoubleClick={() => startInlineEdit(`email_${i}`, email.value)}
                        >
                          <a href={`mailto:${email.value}`}>{email.value}</a>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Phones */}
              {contact.phones.length > 0 && (
                <div className={styles.infoField}>
                  <span className={styles.infoFieldLabel}>PHONE</span>
                  {contact.phones.map((phone, i) => (
                    <div key={`phone-${i}`} className={styles.infoFieldGrid}>
                      <span className={styles.infoFieldSub}>
                        {PHONE_TYPE_LABELS[phone.type] ?? phone.type}
                      </span>
                      {inlineEditing?.field === `phone_${i}` ? (
                        <input
                          className={styles.inlineInput}
                          value={inlineEditing.value}
                          onChange={(e) =>
                            setInlineEditing({ ...inlineEditing, value: e.target.value })
                          }
                          onBlur={() => saveInlineEditPhone(i)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveInlineEditPhone(i)
                            if (e.key === 'Escape') cancelInlineEdit()
                          }}
                          autoFocus
                        />
                      ) : (
                        <span
                          className={styles.infoFieldValue}
                          onDoubleClick={() => startInlineEdit(`phone_${i}`, phone.value)}
                        >
                          <a href={`tel:${phone.value}`}>{phone.value}</a>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* URLs */}
              {contact.urls.length > 0 && (
                <div className={styles.infoField}>
                  <span className={styles.infoFieldLabel}>URL</span>
                  {contact.urls.map((url, i) => (
                    <div key={`url-${i}`} className={styles.infoFieldGrid}>
                      <span className={styles.infoFieldSub}>
                        {EMAIL_TYPE_LABELS[url.type] ?? url.type}
                      </span>
                      <span className={styles.infoFieldValue}>
                        <a
                          href={url.value.startsWith('http') ? url.value : `https://${url.value}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {url.value}
                        </a>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Instant messaging */}
              {contact.ims.length > 0 && (
                <div className={styles.infoField}>
                  <span className={styles.infoFieldLabel}>IM</span>
                  {contact.ims.map((im, i) => (
                    <div key={`im-${i}`} className={styles.infoFieldGrid}>
                      <span className={styles.infoFieldSub}>
                        {im.protocol !== 'other'
                          ? im.protocol.toUpperCase()
                          : (EMAIL_TYPE_LABELS[im.type] ?? im.type)}
                      </span>
                      <span className={styles.infoFieldValue}>{im.value}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Addresses */}
              {contact.addresses.length > 0 && (
                <>
                  {contact.addresses.map((addr, i) => {
                    const formatted = formatAddress(addr)
                    if (!formatted) return null
                    return (
                      <div key={`addr-${i}`} className={styles.infoField}>
                        <span className={styles.infoFieldLabel}>ADDRESS</span>
                        <div className={styles.infoFieldGrid}>
                          <span className={styles.infoFieldSub}>
                            {ADDRESS_TYPE_LABELS[addr.type] ?? addr.type}
                          </span>
                          <span className={styles.infoFieldValue}>
                            {formatted.split('\n').map((line, j) => (
                              <span key={j}>
                                {line}
                                {j < formatted.split('\n').length - 1 && <br />}
                              </span>
                            ))}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </>
              )}

              {/* Languages */}
              {contact.langs && contact.langs.length > 0 && (
                <div className={styles.infoField}>
                  <span className={styles.infoFieldLabel}>LANGUAGE</span>
                  {contact.langs.map((lang, i) => (
                    <div key={`lang-${i}`} className={styles.infoFieldGrid}>
                      <span className={styles.infoFieldSub}>
                        {EMAIL_TYPE_LABELS[lang.type] ?? lang.type}
                      </span>
                      <span className={styles.infoFieldValue}>{lang.value}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Related contacts */}
              {contact.related && contact.related.length > 0 && (
                <div className={styles.infoField}>
                  <span className={styles.infoFieldLabel}>RELATED</span>
                  {contact.related.map((rel, i) => (
                    <div key={`rel-${i}`} className={styles.infoFieldGrid}>
                      <span className={styles.infoFieldSub}>
                        {RELATED_TYPE_LABELS[rel.type] ?? rel.type}
                      </span>
                      <RelationValue
                        value={rel.value}
                        siblingOf={contact}
                        contactLookup={contactLookup}
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Group members */}
              {contact.isGroup && contact.memberUids.length > 0 && (
                <div className={styles.infoField}>
                  <span className={styles.infoFieldLabel}>MEMBERS</span>
                  {contact.memberUids.map((uid, i) => (
                    <div key={`member-${i}`} className={styles.infoFieldGrid}>
                      <RelationValue
                        value={uid}
                        siblingOf={contact}
                        contactLookup={contactLookup}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Aside column */}
        <div className={styles.bodyAside}>
          {/* Birthday card */}
          {contact.birthday && (
            <div className={styles.birthdayCard}>
              <span className={styles.birthdayEmoji}>{'\uD83C\uDF82'}</span>
              <div className={styles.birthdayLabel}>
                BIRTHDAY
                {daysUntilNext(contact.birthday) > 0 && (
                  <span className={styles.birthdayCountdown}>
                    (in {daysUntilNext(contact.birthday)} days)
                  </span>
                )}
                {daysUntilNext(contact.birthday) === 0 && (
                  <span className={styles.birthdayCountdown}>(today!)</span>
                )}
              </div>
              <div className={styles.birthdayDate}>{formatDate(contact.birthday)}</div>
              <div className={styles.birthdayAge}>{getAge(contact.birthday)} years old</div>
              {onAddBirthdayToCalendar && (
                <button
                  type="button"
                  onClick={onAddBirthdayToCalendar}
                  disabled={hasBirthdayEvent}
                  style={{
                    marginTop: 8,
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--line)',
                    background: hasBirthdayEvent ? 'var(--color-bg-tertiary)' : 'transparent',
                    color: hasBirthdayEvent ? 'var(--text-muted)' : 'var(--accent)',
                    cursor: hasBirthdayEvent ? 'default' : 'pointer',
                    fontSize: 11,
                    fontFamily: 'inherit',
                    fontWeight: 500,
                    transition: 'background 0.2s, color 0.2s',
                  }}
                >
                  {hasBirthdayEvent ? '✓ On calendar' : '📅 Add to calendar'}
                </button>
              )}
            </div>
          )}

          {/* Anniversary */}
          {contact.anniversary && (
            <div className={styles.birthdayCard}>
              <span className={styles.birthdayEmoji}>{'\u2764\uFE0F'}</span>
              <div className={styles.birthdayLabel}>
                ANNIVERSARY
                {daysUntilNext(contact.anniversary) > 0 && (
                  <span className={styles.birthdayCountdown}>
                    (in {daysUntilNext(contact.anniversary)} days)
                  </span>
                )}
                {daysUntilNext(contact.anniversary) === 0 && (
                  <span className={styles.birthdayCountdown}>(today!)</span>
                )}
              </div>
              <div className={styles.birthdayDate}>{formatDate(contact.anniversary)}</div>
              {onAddAnniversaryToCalendar && (
                <button
                  type="button"
                  onClick={onAddAnniversaryToCalendar}
                  disabled={hasAnniversaryEvent}
                  style={{
                    marginTop: 8,
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--line)',
                    background: hasAnniversaryEvent ? 'var(--color-bg-tertiary)' : 'transparent',
                    color: hasAnniversaryEvent ? 'var(--text-muted)' : 'var(--accent)',
                    cursor: hasAnniversaryEvent ? 'default' : 'pointer',
                    fontSize: 11,
                    fontFamily: 'inherit',
                    fontWeight: 500,
                    transition: 'background 0.2s, color 0.2s',
                  }}
                >
                  {hasAnniversaryEvent ? '\u2713 On calendar' : '\uD83D\uDCC5 Add to calendar'}
                </button>
              )}
            </div>
          )}

          {/* Categories card */}
          {contact.categories.length > 0 && (
            <div className={styles.categoriesCard}>
              <div className={styles.asideSectionLabel}>TAGS</div>
              <div className={styles.tagList}>
                {contact.categories.map((cat) => (
                  <button
                    key={cat}
                    className={styles.tagPill}
                    onClick={() => useContactStore.getState().setSelectedTag(cat)}
                    type="button"
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* XML data card */}
          {contact.xmlData && (
            <div className={styles.categoriesCard}>
              <div className={styles.asideSectionLabel}>XML DATA</div>
              <pre
                style={{
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  margin: 0,
                  padding: 'var(--space-2)',
                  background: 'var(--bg-secondary)',
                  borderRadius: 'var(--radius-sm)',
                  maxHeight: '200px',
                  overflow: 'auto',
                }}
              >
                {contact.xmlData}
              </pre>
            </div>
          )}
        </div>

        {/* Notes card - full width */}
        {contact.note && (
          <div className={styles.notesFull}>
            <div className={styles.notesCard}>
              <div className={styles.notesTitle}>NOTES</div>
              {inlineEditing?.field === 'note' ? (
                <textarea
                  className={styles.inlineInput}
                  style={{ width: '100%', minHeight: '60px', resize: 'vertical' }}
                  value={inlineEditing.value}
                  onChange={(e) => setInlineEditing({ ...inlineEditing, value: e.target.value })}
                  onBlur={() => saveInlineEdit()}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') cancelInlineEdit()
                  }}
                  autoFocus
                />
              ) : (
                <div
                  className={styles.notesText}
                  onDoubleClick={() => startInlineEdit('note', contact.note)}
                >
                  <MarkdownView text={contact.note} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
