import type { Contact } from '../types'

/**
 * Resolution of vCard RELATED / MEMBER values to the contacts they point at.
 *
 * `Contact.id` is the vCard UID (see vCardAdapter), so a reference of the form
 * `urn:uuid:<uid>` can be resolved with a plain lookup — there is no separate
 * index to maintain.
 *
 * Deliberately NOT scoped to a single address book. RFC 6350 makes UID globally
 * unique (§6.7.6) and RELATED/MEMBER URI-valued (§6.6.6, §6.6.5), and the
 * contact store keeps every address book in one flat list, so a cross-book
 * reference resolves for free. Restricting it would mean adding code to make a
 * working lookup fail.
 */

/** A canonical RFC 4122 UUID, e.g. 3f2504e0-4f89-11d3-9a0c-0305e82c3301. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Leading `urn:uuid:` or `uuid:` scheme, in any case. */
const UUID_SCHEME_RE = /^(?:urn:)?uuid:/i

/**
 * Strip a `urn:uuid:` / `uuid:` scheme, case-insensitively, and trim.
 *
 * The scheme is matched case-insensitively on purpose: the edit UI has long
 * hinted at `URN:uuid:` (uppercase) while servers commonly write the lowercase
 * form, and both are valid per RFC 6350.
 */
export function normalizeContactRef(value: string): string {
  return value.trim().replace(UUID_SCHEME_RE, '')
}

/** True when a RELATED/MEMBER value references a contact by UID rather than by name. */
export function isContactRef(value: string): boolean {
  return UUID_RE.test(normalizeContactRef(value))
}

/**
 * Resolve a RELATED/MEMBER value to the contact it references.
 *
 * `contacts` may be an array (O(N) scan) or a prebuilt case-folded
 * Map<string, Contact> for hot paths — callers rendering many relations at
 * once should pass a map built once with `buildContactLookup`.
 *
 * Returns undefined when the value isn't UID-shaped (a plain name such as
 * "Jane Doe" is a legal RELATED value and should keep rendering as text), or
 * when no contact with that UID is loaded.
 */
export function resolveContactRef(
  value: string,
  contacts: Contact[] | ReadonlyMap<string, Contact>
): Contact | undefined {
  const uid = normalizeContactRef(value)
  if (!UUID_RE.test(uid)) return undefined
  // UUID hex case varies between servers, so compare case-insensitively.
  const needle = uid.toLowerCase()
  if (Array.isArray(contacts)) {
    return contacts.find((c) => c.id.toLowerCase() === needle)
  }
  return contacts.get(needle)
}

/** Build a case-folded id → contact map for O(1) reference resolution. */
export function buildContactLookup(contacts: Contact[]): Map<string, Contact> {
  return new Map(contacts.map((c) => [c.id.toLowerCase(), c]))
}

/** Format a contact UID as the canonical reference we write to the address book. */
export function toContactRef(uid: string): string {
  return `urn:uuid:${normalizeContactRef(uid)}`
}
