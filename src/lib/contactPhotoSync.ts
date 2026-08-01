/**
 * Keeps contact photos in IndexedDB in step with the contact store.
 *
 * `calino-contacts` in localStorage deliberately persists contacts without their
 * inline photo data (see contactStore's partialize). This module puts the photos
 * back into the live store on startup and mirrors every later change out to
 * IndexedDB, so the rest of the app can keep treating `contact.photo` as a
 * plain field.
 */

import { useContactStore } from '@/store/contactStore'
import { getAllPhotos, putPhotos, deletePhotos } from '@/lib/contactPhotoStore'

/** Last photo we wrote per contact, so subscribers only persist real changes. */
const known = new Map<string, string>()

let started = false

/** The contacts array we last diffed, to skip unrelated store updates. */
let lastContacts: unknown = null

function isInline(photo: string | null | undefined): photo is string {
  return typeof photo === 'string' && photo.startsWith('data:')
}

/**
 * Mirror the current contacts into IndexedDB, writing only what changed.
 */
function persistChanges(): void {
  const { contacts } = useContactStore.getState()
  // The store also holds search/selection state; those updates can't touch photos.
  if (contacts === lastContacts) return
  lastContacts = contacts

  const changed: { contactId: string; photo: string }[] = []
  const seen = new Set<string>()

  for (const contact of contacts) {
    if (!isInline(contact.photo)) continue
    seen.add(contact.id)
    if (known.get(contact.id) === contact.photo) continue
    known.set(contact.id, contact.photo)
    changed.push({ contactId: contact.id, photo: contact.photo })
  }

  // Anything we were tracking that no longer has an inline photo — the contact
  // was deleted, or its photo was removed or replaced by a URL.
  const removed = [...known.keys()].filter((id) => !seen.has(id))
  for (const id of removed) known.delete(id)

  if (changed.length > 0) putPhotos(changed).catch(() => {})
  if (removed.length > 0) deletePhotos(removed).catch(() => {})
}

/**
 * Load stored photos into the contact store and start mirroring changes back.
 * Safe to call more than once; only the first call does anything.
 */
export async function initContactPhotos(): Promise<void> {
  if (started) return
  started = true

  try {
    // A blob written before photos moved to IndexedDB still carries them. Copy
    // those across first — this is the whole upgrade path.
    const rescued = useContactStore
      .getState()
      .contacts.flatMap((c) => (isInline(c.photo) ? [{ contactId: c.id, photo: c.photo }] : []))
    if (rescued.length > 0) await putPhotos(rescued)

    const stored = await getAllPhotos()

    useContactStore.setState((state) => ({
      contacts: state.contacts.map((contact) => {
        // Only fill gaps: a CardDAV sync may have landed a fresher photo while
        // the read above was in flight, and that one wins.
        if (contact.photo) return contact
        const photo = stored.get(contact.id)
        return photo ? { ...contact, photo } : contact
      }),
    }))

    lastContacts = useContactStore.getState().contacts
    for (const contact of useContactStore.getState().contacts) {
      if (isInline(contact.photo)) known.set(contact.id, contact.photo)
    }
  } catch {
    // A failed hydrate shouldn't stop us tracking changes from here on.
  }

  // Subscribing only after hydration matters: run the diff against a store whose
  // photos are all still null and it would delete every stored photo.
  useContactStore.subscribe(persistChanges)
}
