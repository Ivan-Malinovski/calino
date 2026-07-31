import type { Contact, ContactRelated } from '../types'

const URN_UUID_RE = /^urn:uuid:(.+)$/i

function normalizeUuid(uuid: string): string {
  return uuid.toLowerCase()
}

/**
 * Resolve a single RELATED entry to its target Contact within the same address book.
 *
 * Per RFC 6350 §6.6.6, the RELATED value can be a URI (typically urn:uuid:<contact-uid>)
 * or text when VALUE=text parameter was present. UUID comparison is case-insensitive per RFC 4122 §3.
 */
export function resolveRelatedInAddressBook(
  related: ContactRelated,
  sourceContact: Pick<Contact, 'addressBookId'>,
  allContacts: Contact[],
): Contact | null {
  const match = URN_UUID_RE.exec(related.value)
  if (!match) return null

  const targetUuid = normalizeUuid(match[1])
  return allContacts.find(
    (c) => normalizeUuid(c.id) === targetUuid && c.addressBookId === sourceContact.addressBookId,
  ) ?? null
}

/** Check if a RELATED value is a URN UUID reference. */
export function isUrnUuid(value: string): boolean {
  return URN_UUID_RE.test(value)
}
