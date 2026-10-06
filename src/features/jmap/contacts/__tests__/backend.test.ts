import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CardDAVConflictError, CardDAVPermissionError } from '@/features/carddav/client/errors'
import { JmapContactsBackend, contactEtag, createJmapContactsBackend } from '../JmapContactsBackend'
import type { AddressBook } from '@/features/carddav/types'
import { JMAP_CALENDARS, JMAP_CONTACTS, type JsonObject } from '../../types'
import { FakeContactsServer } from './fakeServer'
import person from './fixtures/person.json'
import vcard from './fixtures/person.vcf?raw'

const origin = 'https://contacts.test'
const credentials = { id: 'test', serverUrl: origin, username: 'test', password: '' }
describe('JMAP contacts backend with real transport and an in-memory wire server', () => {
  let server: FakeContactsServer, backend: JmapContactsBackend, book: AddressBook
  beforeEach(async () => {
    server = new FakeContactsServer()
    vi.stubGlobal('fetch', server.fetch)
    backend = new JmapContactsBackend(origin, credentials)
    await backend.connect()
    book = {
      ...(await backend.fetchAddressBooks())[0],
      id: 'local-book',
      accountId: 'local-account',
    }
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  const href = (id: string) => `${origin}/.jmap/contacts%2Faccount/ab/default/${id}`
  const last = (method: string): JsonObject =>
    server.calls.filter(([name]) => name === method).at(-1)![1]
  it('derives canWrite from RFC 9610 mayWrite, legacy item rights, or read-only rights', async () => {
    const canWrite = async (myRights: JsonObject) => {
      server.books.set('default', { id: 'default', name: 'Contacts', myRights })
      return (await backend.fetchAddressBooks())[0].canWrite
    }
    expect(await canWrite({ mayRead: true, mayWrite: true })).toBe(true)
    expect(await canWrite({ mayAddItems: true })).toBe(true)
    expect(await canWrite({ mayRead: true })).toBe(false)
  })
  it('uses the real contacts account in contacts-only and mixed sessions', async () => {
    expect((await createJmapContactsBackend(origin, credentials)).protocol).toBe('jmap')
    expect(backend.getServerUrl()).toBe(`${origin}/`)
    expect(backend.getProxyUrl()).toBeNull()
    expect(book).toMatchObject({
      url: `${origin}/.jmap/contacts%2Faccount/ab/default/`,
      syncToken: null,
      supportedVersions: ['4.0', '3.0'],
      canWrite: true,
    })
    server.session.capabilities[JMAP_CALENDARS] = {}
    server.session.primaryAccounts[JMAP_CALENDARS] = 'calendar-account'
    server.session.accounts['calendar-account'] = {
      name: 'Calendar',
      isPersonal: true,
      isReadOnly: false,
      accountCapabilities: { [JMAP_CALENDARS]: {} },
    }
    await backend.connect()
    await backend.fetchAddressBooks()
    expect(last('AddressBook/get').accountId).toBe(server.accountId)
    expect(server.requests.every((request) => request.using.includes(JMAP_CONTACTS))).toBe(true)
    delete server.session.capabilities[JMAP_CONTACTS]
    await expect(backend.connect()).rejects.toMatchObject({ type: 'accountNotFound' })
  })
  it('pages query/get, filters books and restores caller ids and raw vCard', async () => {
    for (let i = 0; i < 5; i++) server.seed({ ...person, uid: `uid${i}` })
    server.seed(person, { elsewhere: true })
    const contacts = await backend.fetchContacts(book)
    expect(contacts).toHaveLength(5)
    expect(contacts[0]).toMatchObject({
      id: 'uid0',
      addressBookId: 'local-book',
      accountId: 'local-account',
      displayName: 'Ada Lovelace',
      url: href('card1'),
    })
    expect(contacts[0].rawVCard).toContain('VERSION:4.0')
    expect(server.calls.filter(([method]) => method === 'ContactCard/query')).toHaveLength(3)
    expect(server.calls.filter(([method]) => method === 'ContactCard/get')).toHaveLength(3)
    expect(
      await backend.fetchContactsByUrls(book, [href('card1'), href('missing'), href('card1')])
    ).toHaveLength(1)
    expect(await backend.fetchContact(book, href('missing'))).toBeNull()
  })
  it('creates, edits through the actual Contact serializer, checks conflicts and deletes', async () => {
    const created = await backend.createCard(book, vcard)
    expect(created.url).toBe(href('card1'))
    const contact = (await backend.fetchContact(book, created.url))!
    expect(contact.etag).toBe(created.etag)
    const noChange = await backend.updateContact(book, contact, created.url, created.etag)
    expect(noChange.etag).toBe(created.etag)
    expect(
      server.calls.filter(([method, args]) => method === 'ContactCard/set' && args.update)
    ).toHaveLength(0)
    contact.displayName = 'Changed name'
    const updated = await backend.updateContact(book, contact, created.url, created.etag)
    expect(updated.etag).not.toBe(created.etag)
    expect(last('ContactCard/set').update).toEqual({
      card1: { 'jsCard/name/full': 'Changed name' },
    })
    await expect(
      backend.updateContact(book, contact, created.url, created.etag)
    ).rejects.toBeInstanceOf(CardDAVConflictError)
    await expect(backend.deleteContact(book, created.url, created.etag)).rejects.toBeInstanceOf(
      CardDAVConflictError
    )
    await backend.deleteContact(book, created.url, updated.etag)
    await backend.deleteContact(book, created.url, updated.etag)
    expect(await backend.fetchContact(book, created.url)).toBeNull()
    expect(contactEtag({ b: 1, a: { d: 2, c: 3 } })).toBe(contactEtag({ a: { c: 3, d: 2 }, b: 1 }))
  })
  it('preserves server metadata and opaque fields on a focused update', async () => {
    const id = server.seed({
      ...person,
      localizations: { da: { 'name/full': 'Dansk' } },
      custom: 'retained',
      emails: {
        opaque: { '@type': 'EmailAddress', address: 'a@test', label: 'Retained', pref: 8 },
      },
    })
    const contact = (await backend.fetchContact(book, href(id)))!
    contact.emails[0].value = 'changed@test'
    await backend.updateContact(book, contact, href(id), contact.etag)
    expect(last('ContactCard/set').update).toEqual({
      [id]: { 'jsCard/emails/opaque/address': 'changed@test' },
    })
    expect(server.cards.get(id)?.jsCard).toMatchObject({
      custom: 'retained',
      emails: { opaque: { label: 'Retained', pref: 8 } },
    })
  })
  it('falls back to inline photo data URIs when the server rejects media blobIds', async () => {
    server.rejectMediaBlobs = true
    const data = vcard.replace('https://example.test/ada.png', 'data:image/png;base64,aGVsbG8=')
    const created = await backend.createCard(book, data)
    expect(server.uploads).toBe(1)
    expect((server.cards.get('card1')!.jsCard as JsonObject).media).toEqual({
      media1: expect.objectContaining({ kind: 'photo', uri: 'data:image/png;base64,aGVsbG8=' }),
    })
    const contact = (await backend.fetchContact(book, created.url))!
    contact.photo = 'data:image/png;base64,bmV3'
    await backend.updateContact(book, contact, created.url, undefined)
    expect(server.uploads).toBe(1)
    expect((await backend.fetchContact(book, created.url))?.photo).toBe(
      'data:image/png;base64,bmV3'
    )
  })
  it('uploads inline photos and downloads only missing photo URIs, using the contacts account', async () => {
    const data = vcard.replace('https://example.test/ada.png', 'data:image/png;base64,aGVsbG8=')
    const created = await backend.createCard(book, data)
    expect(server.uploads).toBe(1)
    expect((server.cards.get('card1')!.jsCard as JsonObject).media).toEqual({
      media1: { '@type': 'Media', kind: 'photo', blobId: 'photo1', mediaType: 'image/png' },
    })
    expect((await backend.fetchContact(book, created.url))?.photo).toBe(
      'data:image/png;base64,aGVsbG8='
    )
    expect(server.downloads).toBe(0)
    backend.clearCache()
    const contact = (await backend.fetchContact(book, created.url))!
    expect(contact.photo).toBe('data:image/png;base64,aGVsbG8=')
    expect(server.downloads).toBe(1)
    contact.displayName = 'Photo unchanged'
    await backend.updateContact(book, contact, created.url, contact.etag)
    expect(server.uploads).toBe(1)
    expect(last('ContactCard/set').update).toEqual({
      card1: { 'jsCard/name/full': 'Photo unchanged' },
    })
    contact.photo = 'data:image/png;base64,bmV3'
    const updated = await backend.updateContact(book, contact, created.url, undefined)
    expect(server.uploads).toBe(2)
    expect((await backend.fetchContact(book, updated.url))?.photo).toBe(
      'data:image/png;base64,bmV3'
    )
    await backend.createCard(book, vcard)
    await backend.fetchContacts(book)
    expect(server.downloads).toBe(1)
  })
  it('supports book CRUD, moves and removing one of several memberships', async () => {
    const target = await backend.createAddressBook('Temporary')
    await backend.updateAddressBook(target.url, 'Renamed')
    expect(
      (await backend.fetchAddressBooks()).find((entry) => entry.url === target.url)?.name
    ).toBe('Renamed')
    const created = await backend.createCard(book, vcard)
    const moved = await backend.updateCard(target, vcard, created.url, created.etag)
    expect(moved.url.split('/').at(-1)).toBe('card2')
    expect(await backend.fetchContact(book, created.url)).toBeNull()
    expect(await backend.fetchContact(target, moved.url)).toBeTruthy()
    await backend.deleteContact(book, created.url, created.etag)
    const id = server.seed(person, { default: true, other: true })
    await backend.deleteContact(book, href(id), undefined)
    expect(server.cards.get(id)?.addressBookIds).toEqual({ other: true })
    await backend.deleteAddressBook(target.url)
    expect(await backend.fetchAddressBooks()).toHaveLength(1)
  })
  it('reports full/delta sync, create/update/move/destroy across paginated cursors', async () => {
    const initial = await backend.syncCollection(book, null)
    expect(initial).toEqual({ changes: [], newSyncToken: 'card-0', tokenInvalidated: false })
    const first = await backend.createCard(book, vcard),
      second = await backend.createCard(book, vcard)
    const third = await backend.createCard(book, vcard)
    await backend.updateCard(
      book,
      vcard.replace('FN:Ada Lovelace', 'FN:Edited'),
      first.url,
      first.etag
    )
    await backend.deleteContact(book, second.url, second.etag)
    const thirdId = third.url.split('/').at(-1)!
    server.cards.get(thirdId)!.addressBookIds = { elsewhere: true }
    server.history.push({ id: thirdId, kind: 'updated' })
    const changes = await backend.syncCollection(book, initial.newSyncToken)
    expect(changes.tokenInvalidated).toBe(false)
    expect(changes.newSyncToken).toBe('card-6')
    expect(changes.changes).toContainEqual({
      url: first.url,
      etag: contactEtag(server.cards.get('card1')!),
      status: 'changed',
    })
    expect(changes.changes).toContainEqual({ url: second.url, etag: null, status: 'removed' })
    expect(changes.changes).toContainEqual({ url: third.url, etag: null, status: 'removed' })
    expect((await backend.syncCollection(book, null)).changes).toHaveLength(1)
    expect(await backend.syncCollection(book, 'invalid')).toEqual({
      changes: [],
      newSyncToken: null,
      tokenInvalidated: true,
    })
  })
  it('captures a full sync cursor before listing so racing changes are replayable', async () => {
    server.afterQuery = () => {
      server.seed(person)
    }
    const initial = await backend.syncCollection(book, null)
    expect(initial.newSyncToken).toBe('card-0')
    expect((await backend.syncCollection(book, initial.newSyncToken)).changes[0].url).toBe(
      href('card1')
    )
  })
  it('rejects query races, malformed/foreign URLs and maps per-object errors', async () => {
    for (let i = 0; i < 3; i++) server.seed(person)
    server.afterQuery = () => {
      server.seed(person)
    }
    await expect(backend.fetchContacts(book)).rejects.toMatchObject({ status: 412 })
    for (const url of [
      href('card1').replace(origin, 'https://evil.test'),
      href('card1') + '?x=1',
      href('card1').replace('contacts%2Faccount', 'wrong'),
      href('card1') + '/nested',
    ])
      await expect(backend.fetchContact(book, url)).rejects.toThrow()
    await expect(
      backend.fetchContactsByUrls(book, [href('card1').replace('/default/', '/other/')])
    ).rejects.toThrow()
    server.failSet = { type: 'forbidden' }
    await expect(backend.createCard(book, vcard)).rejects.toBeInstanceOf(CardDAVPermissionError)
    server.failSet = { type: 'invalidProperties', properties: ['jsCard'] }
    await expect(backend.createCard(book, vcard)).rejects.toMatchObject({
      type: 'invalidProperties',
    })
    server.failSet = null
    server.failMethod = { method: 'ContactCard/get', type: 'serverFail' }
    expect((await backend.syncCollection(book, null)).tokenInvalidated).toBe(true)
  })
  it('preserves empty groups through the Contact API', async () => {
    const created = await backend.createCard(
      book,
      'BEGIN:VCARD\nVERSION:4.0\nUID:group\nFN:Empty group\nKIND:group\nEND:VCARD'
    )
    const contact = (await backend.fetchContact(book, created.url))!
    expect(contact.isGroup).toBe(true)
    contact.displayName = 'Renamed group'
    await backend.updateContact(book, contact, created.url, contact.etag)
    expect((await backend.fetchContact(book, created.url))?.isGroup).toBe(true)
    const clone = await backend.createContact(
      book,
      { ...contact, id: 'another-group' },
      'ignored.vcf'
    )
    expect((await backend.fetchContact(book, clone.url))?.isGroup).toBe(true)
  })
})
