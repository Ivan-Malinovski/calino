import { describe, expect, it } from 'vitest'
import { JmapContactsBackend } from '../JmapContactsBackend'
import { ContactsJmapClient } from '../ContactsJmapClient'
import { JMAP_CONTACTS } from '../../types'
import vcard from './fixtures/person.vcf?raw'
import groupVcard from './fixtures/group.vcf?raw'
import { JmapError } from '../../client/errors'

const serverUrl = globalThis.process.env.CALINO_TEST_JMAP_URL
const username = globalThis.process.env.CALINO_TEST_JMAP_USER
const password = globalThis.process.env.CALINO_TEST_JMAP_PASS

describe.skipIf(!serverUrl || !username || !password)(
  'live JMAP contacts (requires contacts capability)',
  () => {
    it('probes server group support and round-trips supported members', async (context) => {
      const probe = new ContactsJmapClient({
        serverUrl: serverUrl!,
        username: username!,
        password: password!,
      })
      await probe.connect()
      if (
        !probe.session.capabilities[JMAP_CONTACTS] ||
        !Object.values(probe.session.accounts).some(
          (account) => account.accountCapabilities[JMAP_CONTACTS]
        )
      ) {
        context.skip('Server does not advertise urn:ietf:params:jmap:contacts; group probe skipped')
        return
      }
      const backend = new JmapContactsBackend(serverUrl!, {
        id: 'live',
        serverUrl: serverUrl!,
        username: username!,
        password: password!,
      })
      await backend.connect()
      const book = (await backend.fetchAddressBooks()).find((book) => book.canWrite)
      if (!book)
        throw new Error('Contacts capability advertised but no writable address book available')
      let url: string | undefined
      try {
        let created: { url: string; etag: string }
        try {
          created = await backend.createCard(
            book,
            groupVcard.replace('urn:uuid:calino-group', `urn:uuid:${crypto.randomUUID()}`)
          )
        } catch (error) {
          if (
            error instanceof JmapError &&
            error.type === 'invalidProperties' &&
            Array.isArray(error.details?.properties) &&
            error.details.properties.some(
              (property) => typeof property === 'string' && /kind|members/.test(property)
            )
          ) {
            context.skip(
              'Server rejects group kind/members through JMAP; group support unavailable'
            )
            return
          }
          throw error
        }
        url = created.url
        const contact = (await backend.fetchContact(book, url))!
        expect(contact.isGroup).toBe(true)
        expect(contact.memberUids).toEqual([
          'urn:uuid:calino-person',
          'mailto:charles@example.test',
        ])
        contact.displayName = 'Edited group'
        await backend.updateContact(book, contact, url, created.etag)
        expect((await backend.fetchContact(book, url))?.memberUids).toEqual(contact.memberUids)
      } finally {
        if (url) await backend.deleteContact(book, url, undefined)
      }
    }, 120_000)
    it('creates, reads, patches, syncs and deletes a contact with a photo', async (context) => {
      const probe = new ContactsJmapClient({
        serverUrl: serverUrl!,
        username: username!,
        password: password!,
      })
      await probe.connect()
      if (
        !probe.session.capabilities[JMAP_CONTACTS] ||
        !Object.values(probe.session.accounts).some(
          (account) => account.accountCapabilities[JMAP_CONTACTS]
        )
      ) {
        context.skip(
          'Server does not advertise urn:ietf:params:jmap:contacts; contacts lifecycle skipped'
        )
        return
      }
      const backend = new JmapContactsBackend(serverUrl!, {
        id: 'live',
        serverUrl: serverUrl!,
        username: username!,
        password: password!,
      })
      await backend.connect()
      const suffix = crypto.randomUUID()
      const resources = new Set<string>()
      const books = await backend.fetchAddressBooks()
      const book = books.find((book) => book.canWrite)
      if (!book)
        throw new Error('Contacts capability advertised but no writable address book available')
      const initial = await backend.syncCollection(book, null)
      expect(initial.tokenInvalidated).toBe(false)
      try {
        const data = vcard
          .replace('urn:uuid:calino-person', `urn:uuid:${suffix}`)
          .replace(
            'https://example.test/ada.png',
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBmQAAAAASUVORK5CYII='
          )
        const created = await backend.createCard(book, data)
        resources.add(created.url)
        backend.clearCache()
        const contact = (await backend.fetchContact(book, created.url))!
        expect(contact.displayName).toBe('Ada Lovelace')
        expect(contact.birthday).toBe('1815-12-10')
        expect(contact.photo).toMatch(/^data:image\/png;base64,/)
        const added = await backend.syncCollection(book, initial.newSyncToken)
        expect(added.tokenInvalidated).toBe(false)
        expect(
          added.changes.some((change) => change.url === created.url && change.status === 'changed')
        ).toBe(true)
        contact.displayName = `Calino test ${suffix}`
        const updated = await backend.updateContact(book, contact, created.url, created.etag)
        expect(updated.etag).not.toBe(created.etag)
        expect((await backend.fetchContact(book, updated.url))?.displayName).toBe(
          contact.displayName
        )
        await expect(
          backend.updateContact(book, contact, created.url, created.etag)
        ).rejects.toMatchObject({ name: 'CardDAVConflictError' })
        const edited = await backend.syncCollection(book, added.newSyncToken)
        expect(
          edited.changes.some((change) => change.url === created.url && change.status === 'changed')
        ).toBe(true)
        await backend.deleteContact(book, updated.url, updated.etag)
        resources.delete(updated.url)
        const removed = await backend.syncCollection(book, edited.newSyncToken)
        expect(removed.tokenInvalidated).toBe(false)
        expect(removed.changes).toContainEqual({ url: updated.url, etag: null, status: 'removed' })
        expect(await backend.fetchContact(book, updated.url)).toBeNull()
      } finally {
        let failures = 0
        for (const url of resources)
          try {
            await backend.deleteContact(book, url, undefined)
          } catch {
            failures++
          }
        expect(failures, 'Temporary contact cleanup failed').toBe(0)
      }
    }, 120_000)
  }
)
