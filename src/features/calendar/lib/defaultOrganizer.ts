import type { CalDAVAccount } from '@/features/caldav/types'
import type { CalendarAttendee, CalendarOrganizer } from '@/types'

// Same shape check the attendee field applies to an address before adding it.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type OrganizerAccount = Pick<
  CalDAVAccount,
  'protocol' | 'username' | 'calendarUserAddress' | 'principalDisplayName'
>

/**
 * The address the account's user organizes meetings as, or undefined when
 * there is no address to claim.
 *
 * In order: the principal's calendar user address (RFC 6638 §2.4.1), then a
 * username that is itself an email address — what servers with no address set
 * (Radicale) identify their users by. A JMAP account's address is its default
 * participant identity, which is what the server ties a meeting to; its
 * username says nothing about that, so it is never guessed from.
 */
export function accountOrganizer(
  account: OrganizerAccount | undefined
): CalendarOrganizer | undefined {
  if (!account) return undefined

  const username = account.username.trim()
  const guessed = account.protocol !== 'jmap' && EMAIL_RE.test(username) ? username : undefined
  const email = account.calendarUserAddress?.trim() || guessed
  if (!email) return undefined

  // A display name that only repeats the address adds nothing to CN.
  const name = account.principalDisplayName?.trim()
  return name && name.toLowerCase() !== email.toLowerCase() ? { email, name } : { email }
}

/**
 * The ORGANIZER an event is saved with. RFC 5545 §3.8.4.3 requires one on an
 * event with attendees, and servers that send invitations (RFC 6638) send none
 * without it. An event that already names its organizer keeps it — it may be
 * someone else's meeting — and an event without attendees is not a meeting.
 */
export function organizerForSave(
  organizer: CalendarOrganizer | undefined,
  attendees: CalendarAttendee[],
  account: OrganizerAccount | undefined
): CalendarOrganizer | undefined {
  if (organizer?.email || attendees.length === 0) return organizer
  return accountOrganizer(account) ?? organizer
}
