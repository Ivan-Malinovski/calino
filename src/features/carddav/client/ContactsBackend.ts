import type { AddressBook, Contact } from '../types'

export type ContactsProtocol = 'carddav' | 'jmap'

export interface ContactsSyncResult {
  changes: { url: string; etag: string | null; status: 'added' | 'changed' | 'removed' }[]
  newSyncToken: string | null
  tokenInvalidated: boolean
}

/**
 * The existing contact callers' transport-neutral surface. Contact.rawVCard
 * carries the vCard document; URLs and etags are opaque resource identifiers.
 * Missing protocol means CardDAV until the existing client is migrated.
 * Book/account ids on returned contacts come from the caller's AddressBook.
 */
export interface ContactsBackend {
  readonly protocol?: ContactsProtocol
  connect(): Promise<void>
  fetchAddressBooks(): Promise<AddressBook[]>
  fetchContacts(addressBook: AddressBook): Promise<Contact[]>
  fetchContactsByUrls(addressBook: AddressBook, urls: string[]): Promise<Contact[]>
  createContact(
    addressBook: AddressBook,
    contact: Contact,
    filename: string
  ): Promise<{ url: string; etag: string }>
  updateContact(
    addressBook: AddressBook,
    contact: Contact,
    contactUrl: string,
    etag: string | undefined
  ): Promise<{ url: string; etag: string }>
  deleteContact(
    addressBook: AddressBook,
    contactUrl: string,
    etag: string | undefined
  ): Promise<void>
  syncCollection(addressBook: AddressBook, syncToken: string | null): Promise<ContactsSyncResult>
}
