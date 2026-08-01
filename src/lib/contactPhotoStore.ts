/**
 * IndexedDB-backed storage for contact photos.
 * Keeps base64 data URIs out of localStorage (which has a ~5-10MB quota).
 */

import Dexie, { type EntityTable } from 'dexie'

export interface ContactPhotoRecord {
  contactId: string
  photo: string
}

class ContactPhotoDatabase extends Dexie {
  photos!: EntityTable<ContactPhotoRecord, 'contactId'>

  constructor() {
    super('calino-contact-photos')
    this.version(1).stores({
      photos: 'contactId',
    })
  }
}

const db = new ContactPhotoDatabase()

/**
 * Store photos for contacts. Overwrites any existing photo for the same contact.
 */
export async function putPhotos(entries: ContactPhotoRecord[]): Promise<void> {
  if (entries.length === 0) return
  await db.photos.bulkPut(entries)
}

/**
 * Retrieve every stored photo, keyed by contact id.
 *
 * Unlike attachments, photos are read all at once: the contact list renders an
 * avatar per row, so a lazy per-contact fetch would just be the same read split
 * into hundreds of transactions.
 */
export async function getAllPhotos(): Promise<Map<string, string>> {
  const records = await db.photos.toArray()
  return new Map(records.map((r) => [r.contactId, r.photo]))
}

/**
 * Delete photos for the given contacts.
 */
export async function deletePhotos(contactIds: string[]): Promise<void> {
  if (contactIds.length === 0) return
  await db.photos.bulkDelete(contactIds)
}
