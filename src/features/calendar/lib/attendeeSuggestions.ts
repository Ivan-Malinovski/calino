import type { CalDAVAccount } from '@/features/caldav/types'
import type { Contact } from '@/features/carddav/types'
import type { CalendarEvent } from '@/types'

/** Someone the attendee field can offer. */
export interface AttendeeSuggestion {
  /** Lower-cased address, without `mailto:`. */
  email: string
  name?: string
  /** Higher first. Anyone met in an event outranks a calendar owner or contact. */
  score: number
}

/** A person known some other way than from an event: a calendar's owner, a contact. */
export interface KnownPerson {
  email: string
  name?: string
}

export interface SuggestionSources {
  /** Events and tasks in the local store. */
  events: readonly CalendarEvent[]
  /** Owners of the calendars in the account list. */
  calendarOwners?: readonly KnownPerson[]
  /** Address-book entries, one per email. */
  contacts?: readonly KnownPerson[]
  /** The user's own addresses: never suggested. */
  ownAddresses?: readonly string[]
  /** Reference time for recency. */
  now?: Date
}

/** An account as far as the suggestions are concerned: who the user is on it. */
export type SuggestionAccount = Pick<CalDAVAccount, 'username' | 'calendarUserAddress'>

/**
 * The addresses the user goes by on their accounts, never offered to them: the
 * calendar user address each account reported (a CalDAV principal's
 * calendar-user-address-set, a JMAP account's default participant identity,
 * as the organizer uses them) and the account username, which only counts
 * when it is itself an address. Leaving out an address the user might not own
 * costs one suggestion; it is never claimed as theirs.
 */
export function ownAddressesOf(accounts: readonly SuggestionAccount[]): string[] {
  return accounts.flatMap((account) => [account.calendarUserAddress ?? '', account.username])
}

/**
 * Address-book entries as people the field can offer, one per email. Contacts
 * from CardDAV and from JMAP accounts are the same in the store.
 */
export function contactPeople(contacts: readonly Contact[]): KnownPerson[] {
  return contacts.flatMap((contact) =>
    contact.emails.map((email) => ({ email: email.value, name: contact.displayName }))
  )
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DAY_MS = 24 * 60 * 60 * 1000
// Seen in an event within this window (either side of now) counts double:
// the people of current meetings come first.
const RECENT_DAYS = 90
// Below any event count, so history always wins, and owners above contacts:
// a calendar in the sidebar is a colleague; an address book holds everyone.
const OWNER_SCORE = 0.5
const CONTACT_SCORE = 0.25

function clean(email: string | undefined): string | null {
  const address = (email ?? '')
    .trim()
    .replace(/^mailto:/i, '')
    .toLowerCase()
  return EMAIL_RE.test(address) ? address : null
}

/** One id per meeting: every occurrence or fragment of a series counts once. */
function meetingKey(event: CalendarEvent): string {
  return event.occurrenceMasterId ?? event.recurrenceMasterId ?? event.uid ?? event.id
}

/**
 * Everyone the user has met in an event or task, owns a calendar they see, or
 * is in their address book, most relevant first. Built from data already in
 * the browser: no request is made.
 *
 * Ranking: the number of distinct meetings an address took part in (as
 * attendee or organizer), a meeting within RECENT_DAYS counting double; then
 * calendar owners, then contacts. The name kept is the one from the most
 * recently modified meeting, else the owner's or contact's. Ties go by
 * address, so the order is stable.
 */
export function collectAttendeeSuggestions(sources: SuggestionSources): AttendeeSuggestion[] {
  const now = (sources.now ?? new Date()).getTime()
  const own = new Set<string>()
  for (const address of sources.ownAddresses ?? []) {
    const email = clean(address)
    if (email) own.add(email)
  }

  interface Entry {
    meetings: Map<string, number>
    name?: string
    nameAt: number
    score: number
  }
  const entries = new Map<string, Entry>()
  const entry = (email: string): Entry => {
    let found = entries.get(email)
    if (!found) {
      found = { meetings: new Map(), nameAt: -Infinity, score: 0 }
      entries.set(email, found)
    }
    return found
  }

  for (const event of sources.events) {
    const people = [...(event.attendees ?? []), ...(event.organizer ? [event.organizer] : [])]
    if (people.length === 0) continue
    const when = Date.parse(event.start)
    const weight = Number.isFinite(when) && Math.abs(when - now) <= RECENT_DAYS * DAY_MS ? 2 : 1
    const modified = Date.parse(event.lastModified ?? event.created ?? event.start)
    const key = meetingKey(event)
    for (const person of people) {
      const email = clean(person.email)
      if (!email || own.has(email)) continue
      const found = entry(email)
      found.meetings.set(key, Math.max(found.meetings.get(key) ?? 0, weight))
      const name = person.name?.trim()
      const at = Number.isFinite(modified) ? modified : 0
      if (name && at >= found.nameAt) {
        found.name = name
        found.nameAt = at
      }
    }
  }
  for (const found of entries.values()) {
    for (const weight of found.meetings.values()) found.score += weight
  }

  const addKnown = (people: readonly KnownPerson[] | undefined, score: number): void => {
    for (const person of people ?? []) {
      const email = clean(person.email)
      if (!email || own.has(email)) continue
      const found = entry(email)
      found.score = Math.max(found.score, score)
      const name = person.name?.trim()
      if (name && !found.name) found.name = name
    }
  }
  addKnown(sources.calendarOwners, OWNER_SCORE)
  addKnown(sources.contacts, CONTACT_SCORE)

  return [...entries.entries()]
    .map(([email, found]) => ({ email, name: found.name, score: found.score }))
    .sort((a, b) => b.score - a.score || a.email.localeCompare(b.email))
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/**
 * The suggestions matching what is typed: the start of the address, of its
 * domain, or of any word of the name (accents and case ignored). An empty
 * query keeps the best ones. Already-added attendees are left out.
 */
export function matchAttendeeSuggestions(
  suggestions: readonly AttendeeSuggestion[],
  query: string,
  exclude: readonly string[] = [],
  limit = 8
): AttendeeSuggestion[] {
  const skip = new Set(exclude.map((email) => email.trim().toLowerCase()))
  const q = fold(query.trim())
  const result: AttendeeSuggestion[] = []
  for (const suggestion of suggestions) {
    if (skip.has(suggestion.email)) continue
    if (q && !matches(suggestion, q)) continue
    result.push(suggestion)
    if (result.length >= limit) break
  }
  return result
}

function matches(suggestion: AttendeeSuggestion, q: string): boolean {
  const email = fold(suggestion.email)
  if (email.startsWith(q)) return true
  const [local = '', domain = ''] = email.split('@')
  if (domain.startsWith(q.replace(/^@/, '')) && q.startsWith('@')) return true
  if (local.split(/[._+-]/).some((part) => part.startsWith(q))) return true
  const name = fold(suggestion.name ?? '')
  return name.split(/\s+/).some((word) => word.startsWith(q)) || name.startsWith(q)
}
