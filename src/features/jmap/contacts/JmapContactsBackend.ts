import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { CalDAVCredentials } from '@/features/caldav/types'
import type { AddressBook, Contact } from '@/features/carddav/types'
import type { ContactsBackend, ContactsSyncResult } from '@/features/carddav/client/ContactsBackend'
import { CardDAVConflictError, CardDAVPermissionError } from '@/features/carddav/client/errors'
import { contactToVCard, parseVCard } from '@/features/carddav/adapter/vCardAdapter'
import { JmapError, methodError } from '../client/errors'
import { normalizeJmapUrl } from '../client/session'
import { JMAP_CORE, JMAP_CONTACTS, type JsonObject, type JsonValue } from '../types'
import { applyJmapPatch } from '../convert/jscalendarDiff'
import { ContactsJmapClient } from './ContactsJmapClient'
import { jscontactToVCard } from './convert/jscontactToVCard'
import { vCardToJscontact } from './convert/vCardToJscontact'
import { contactPatch } from './convert/jscontactDiff'
import { entries, fold, isJsonObject, object, string, type JSContactCard } from './convert/values'

const strings = (value: JsonValue | undefined): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
const list = (value: JsonValue | undefined): JsonObject[] =>
  Array.isArray(value) ? value.filter(isJsonObject) : []
const required = (value: JsonValue | undefined): string => {
  if (typeof value !== 'string' || !value)
    throw new JmapError('JMAP response omitted identifier/state', { type: 'invalidResponse' })
  return value
}
function canonical(value: JsonValue): string {
  return Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : isJsonObject(value)
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(',')}}`
      : JSON.stringify(value)
}
export function contactEtag(card: JsonObject): string {
  return `"${bytesToHex(sha256(new TextEncoder().encode(canonical(card))))}"`
}
function jsCard(card: JsonObject): JSContactCard {
  if (isJsonObject(card.jsCard)) return card.jsCard
  // Accept early implementations exposing the Card fields at the resource root.
  const result = { ...card }
  for (const key of ['id', 'addressBookIds', 'blobId', 'size', 'created', 'updated'])
    delete result[key]
  return result
}
async function blobDataUri(blob: Blob, type: string): Promise<string> {
  if (typeof blob.arrayBuffer === 'function') {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return `data:${type};base64,${btoa(binary)}`
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read contact photo'))
    reader.readAsDataURL(blob)
  })
}

export class JmapContactsBackend implements ContactsBackend {
  readonly protocol = 'jmap' as const
  readonly client: ContactsJmapClient
  private serverUrl: string
  private proxyUrl: string | null
  private photos = new Map<string, Promise<string>>()
  /** Set once a server (Stalwart) rejects `blobId` in Media; photos then stay inline data: URIs. */
  private inlinePhotos = false
  private async withPhotoFallback<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (error) {
      if (this.inlinePhotos || !/blobIds? in media/i.test(String((error as Error)?.message)))
        throw error
      this.inlinePhotos = true
      return run()
    }
  }
  constructor(serverUrl: string, credentials: CalDAVCredentials, proxyUrl: string | null = null) {
    this.serverUrl = normalizeJmapUrl(serverUrl)
    this.proxyUrl = proxyUrl
    this.client = new ContactsJmapClient({
      serverUrl: this.serverUrl,
      username: credentials.username,
      password: credentials.password,
      customHeaders: credentials.customHeaders,
      proxyUrl,
    })
  }
  async connect(): Promise<void> {
    await this.client.connect()
    void this.client.accountId
  }
  getServerUrl(): string {
    return this.serverUrl
  }
  getProxyUrl(): string | null {
    return this.proxyUrl
  }
  clearCache(): void {
    this.photos.clear()
  }
  private bookUrl(id: string): string {
    return `${new URL(this.serverUrl).origin}/.jmap/${encodeURIComponent(this.client.accountId)}/ab/${encodeURIComponent(id)}/`
  }
  private parseUrl(url: string, resource = false): { bookId: string; cardId: string } {
    const parsed = new URL(url)
    const prefix = `/.jmap/${encodeURIComponent(this.client.accountId)}/ab/`
    const parts = parsed.pathname.slice(prefix.length).split('/')
    if (
      parsed.origin !== new URL(this.serverUrl).origin ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      !parsed.pathname.startsWith(prefix) ||
      parts.length !== 2 ||
      !parts[0] ||
      (resource ? !parts[1] : parts[1] !== '')
    )
      throw new JmapError('Invalid JMAP address book/contact URL', {
        type: 'invalidArguments',
        status: 400,
      })
    return { bookId: decodeURIComponent(parts[0]), cardId: decodeURIComponent(parts[1]) }
  }
  private async call(method: string, args: JsonObject): Promise<JsonObject> {
    const response = await this.client.call(
      [[method, { ...args, accountId: this.client.accountId }, 'contacts']],
      [JMAP_CORE, JMAP_CONTACTS]
    )
    const result = response.methodResponses.find(
      ([name, , id]) => name === method && id === 'contacts'
    )
    if (!result)
      throw new JmapError('JMAP response omitted method result', { type: 'invalidResponse' })
    return result[1]
  }
  private async set(
    type: 'AddressBook' | 'ContactCard',
    operation: 'create' | 'update' | 'destroy',
    id: string,
    value?: JsonObject
  ): Promise<JsonObject> {
    const result = await this.call(`${type}/set`, {
      [operation]: operation === 'destroy' ? [id] : { [id]: value! },
      ...(type === 'AddressBook' && operation === 'destroy'
        ? { onDestroyRemoveContents: true }
        : {}),
    })
    const failure = object(
      result[{ create: 'notCreated', update: 'notUpdated', destroy: 'notDestroyed' }[operation]]
    )[id]
    if (isJsonObject(failure)) {
      if (operation === 'destroy' && failure.type === 'notFound') return result
      if (['forbidden', 'accountReadOnly'].includes(string(failure.type)))
        throw new CardDAVPermissionError()
      throw methodError(failure, `${type}/set`, 'contacts')
    }
    const success =
      result[{ create: 'created', update: 'updated', destroy: 'destroyed' }[operation]]
    if (
      operation === 'destroy'
        ? !Array.isArray(success) || !success.includes(id)
        : !isJsonObject(success) || !Object.hasOwn(success, id)
    )
      throw new JmapError('JMAP set response omitted outcome', { type: 'invalidResponse' })
    return result
  }
  private book(value: JsonObject, state: string): AddressBook {
    const url = this.bookUrl(required(value.id)),
      rights = object(value.myRights)
    return {
      id: url,
      url,
      accountId: '',
      name: string(value.name) || 'Unnamed Address Book',
      description: string(value.description) || undefined,
      ctag: state,
      syncToken: null,
      isVisible: value.isSubscribed !== false,
      supportedVersions: ['4.0', '3.0'],
      canWrite:
        !this.client.session.accounts[this.client.accountId].isReadOnly &&
        (value.myRights === undefined ||
          ['mayWrite', 'mayAddItems', 'mayModifyItems', 'mayRemoveItems'].some(
            (key) => rights[key] === true
          )),
    }
  }
  async fetchAddressBooks(): Promise<AddressBook[]> {
    const result = await this.call('AddressBook/get', { ids: null })
    return list(result.list).map((book) => this.book(book, required(result.state)))
  }
  /** Additional concrete-class API; current contact UI has no address book CRUD. */
  async createAddressBook(name: string): Promise<AddressBook> {
    const result = await this.set('AddressBook', 'create', 'book', { name })
    const id = required(object(object(result.created).book).id)
    const fetched = await this.call('AddressBook/get', { ids: [id] })
    const book = list(fetched.list)[0]
    if (!book) throw methodError({ type: 'notFound' }, 'AddressBook/get', 'contacts')
    return this.book(book, required(fetched.state))
  }
  async updateAddressBook(url: string, name: string): Promise<void> {
    await this.set('AddressBook', 'update', this.parseUrl(url).bookId, { name })
  }
  async deleteAddressBook(url: string): Promise<void> {
    await this.set('AddressBook', 'destroy', this.parseUrl(url).bookId)
  }
  private async query(bookId: string): Promise<string[]> {
    const ids: string[] = []
    let state: string | undefined
    while (true) {
      const result = await this.call('ContactCard/query', {
        filter: { inAddressBook: bookId },
        position: ids.length,
        calculateTotal: true,
      })
      const page = strings(result.ids)
      if (result.position !== ids.length || page.some((id) => ids.includes(id)))
        throw new JmapError('Invalid JMAP query pagination', { type: 'invalidResponse' })
      if (state !== undefined && state !== result.queryState)
        throw new JmapError('Contact query changed while paging (HTTP 412)', {
          type: 'stateMismatch',
          status: 412,
        })
      state = required(result.queryState)
      ids.push(...page)
      if (!page.length || (typeof result.total === 'number' && ids.length >= result.total))
        return ids
    }
  }
  private async cards(ids: string[]): Promise<JsonObject[]> {
    return ids.length ? list((await this.call('ContactCard/get', { ids })).list) : []
  }
  private member(card: JsonObject, id: string): boolean {
    return object(card.addressBookIds)[id] === true
  }
  private async hydrated(card: JSContactCard): Promise<JSContactCard> {
    const copy = structuredClone(card)
    for (const [, media] of entries(copy.media)) {
      if (media.kind !== 'photo' || string(media.uri)) continue
      const id = string(media.blobId)
      if (!id) continue
      const type = string(media.mediaType) || 'image/jpeg'
      if (!this.photos.has(id))
        this.photos.set(
          id,
          this.client
            .download(id, 'photo', type)
            .then((blob) => blobDataUri(blob, type))
            .catch((error: unknown) => {
              this.photos.delete(id)
              throw error
            })
        )
      media.uri = await this.photos.get(id)!
    }
    return copy
  }
  private async contact(card: JsonObject, book: AddressBook): Promise<Contact> {
    const data = jscontactToVCard(await this.hydrated(jsCard(card)))
    const contact = parseVCard(data, book.id, book.accountId)
    if (!contact) throw new JmapError('Invalid contact projection', { type: 'invalidResponse' })
    contact.url =
      this.bookUrl(this.parseUrl(book.url).bookId) + encodeURIComponent(required(card.id))
    contact.etag = contactEtag(card)
    contact.isGroup = jsCard(card).kind === 'group' || contact.isGroup
    return contact
  }
  async fetchContacts(book: AddressBook): Promise<Contact[]> {
    const id = this.parseUrl(book.url).bookId
    return Promise.all(
      (await this.cards(await this.query(id)))
        .filter((card) => this.member(card, id))
        .map((card) => this.contact(card, book))
    )
  }
  async fetchContactsByUrls(book: AddressBook, urls: string[]): Promise<Contact[]> {
    const id = this.parseUrl(book.url).bookId
    const ids = [
      ...new Set(
        urls.map((url) => {
          const parsed = this.parseUrl(url, true)
          if (parsed.bookId !== id)
            throw new JmapError('Contact is outside its address book', { type: 'invalidArguments' })
          return parsed.cardId
        })
      ),
    ]
    return Promise.all(
      (await this.cards(ids))
        .filter((card) => this.member(card, id))
        .map((card) => this.contact(card, book))
    )
  }
  async fetchContact(book: AddressBook, url: string): Promise<Contact | null> {
    return (await this.fetchContactsByUrls(book, [url]))[0] ?? null
  }
  private async uploadPhotos(card: JSContactCard): Promise<JSContactCard> {
    const copy = structuredClone(card)
    if (this.inlinePhotos) return copy
    for (const [, media] of entries(copy.media)) {
      if (media.kind !== 'photo' || !string(media.uri).startsWith('data:')) continue
      const uri = string(media.uri),
        match = uri.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/i)
      if (!match)
        throw new JmapError('Invalid contact photo data URI', { type: 'invalidArguments' })
      const type = match[1] || 'application/octet-stream'
      let bytes: Uint8Array
      try {
        bytes = match[2]
          ? Uint8Array.from(atob(match[3]), (char) => char.charCodeAt(0))
          : new TextEncoder().encode(decodeURIComponent(match[3]))
      } catch {
        throw new JmapError('Invalid contact photo encoding', { type: 'invalidArguments' })
      }
      const uploaded = await this.client.upload(bytes.buffer as ArrayBuffer, type)
      delete media.uri
      media.blobId = uploaded.blobId
      media.mediaType = uploaded.type
      this.photos.set(uploaded.blobId, Promise.resolve(uri))
    }
    return copy
  }
  private serialize(contact: Contact): string {
    // Retain the actual photo MIME; the shared serializer labels binary JPEG.
    const lines = contactToVCard(contact)
      .replace(/\r?\n[ \t]/g, '')
      .split(/\r?\n/)
      .filter((line) => !/^(PHOTO|KIND)(?:[:;])/i.test(line))
    const end = lines.findIndex((line) => /^END:VCARD$/i.test(line))
    if (contact.isGroup) lines.splice(end, 0, 'KIND:group')
    if (contact.photo) lines.splice(end, 0, `PHOTO;VALUE=URI:${contact.photo}`)
    return lines.map(fold).join('\r\n')
  }
  async createContact(
    book: AddressBook,
    contact: Contact,
    filename: string
  ): Promise<{ url: string; etag: string }> {
    void filename
    return this.createCard(book, this.serialize(contact))
  }
  /** vCard string entry points for importers and boundary tests. */
  async createCard(book: AddressBook, data: string): Promise<{ url: string; etag: string }> {
    return this.withPhotoFallback(() => this.createCardOnce(book, data))
  }
  private async createCardOnce(
    book: AddressBook,
    data: string
  ): Promise<{ url: string; etag: string }> {
    const id = this.parseUrl(book.url).bookId
    const result = await this.set('ContactCard', 'create', 'card', {
      // RFC 9610 ContactCard is flat: the Card properties sit beside addressBookIds.
      ...(await this.uploadPhotos(vCardToJscontact(data))),
      addressBookIds: { [id]: true },
    })
    const cardId = required(object(object(result.created).card).id)
    const url = this.bookUrl(id) + encodeURIComponent(cardId)
    const [card] = await this.cards([cardId])
    if (!card) throw methodError({ type: 'notFound' }, 'ContactCard/get', 'contacts')
    return { url, etag: contactEtag(card) }
  }
  async updateContact(
    book: AddressBook,
    contact: Contact,
    url: string,
    etag: string | undefined
  ): Promise<{ url: string; etag: string }> {
    return this.updateCard(book, this.serialize(contact), url, etag, true)
  }
  async updateCard(
    book: AddressBook,
    data: string,
    url: string,
    etag: string | undefined,
    editorProjection = false
  ): Promise<{ url: string; etag: string }> {
    return this.withPhotoFallback(() =>
      this.updateCardOnce(book, data, url, etag, editorProjection)
    )
  }
  private async updateCardOnce(
    book: AddressBook,
    data: string,
    url: string,
    etag: string | undefined,
    editorProjection: boolean
  ): Promise<{ url: string; etag: string }> {
    const target = this.parseUrl(book.url).bookId,
      source = this.parseUrl(url, true)
    const [previous] = await this.cards([source.cardId])
    if (!previous || !this.member(previous, source.bookId))
      throw methodError({ type: 'notFound' }, 'ContactCard/get', 'contacts')
    if (etag && etag !== contactEtag(previous))
      throw new CardDAVConflictError(
        contactEtag(previous),
        jscontactToVCard(await this.hydrated(jsCard(previous)))
      )
    const hydrated = await this.hydrated(jsCard(previous))
    const project = (card: JSContactCard): JSContactCard => {
      const copy = structuredClone(card)
      for (const [id, media] of entries(copy.media))
        if (!media.uri && media.blobId) media.uri = object(object(hydrated.media)[id]).uri ?? ''
      const vcard = jscontactToVCard(copy)
      if (!editorProjection) return vCardToJscontact(vcard)
      const contact = parseVCard(vcard, book.id, book.accountId)!
      contact.isGroup = copy.kind === 'group' || contact.isGroup
      return vCardToJscontact(this.serialize(contact))
    }
    const oldCard = jsCard(previous),
      next = vCardToJscontact(data)
    const patch = contactPatch(oldCard, next, project)
    const desired = await this.uploadPhotos(applyJmapPatch(oldCard, patch))
    const wirePatch: JsonObject = {}
    // Uploading changes the inline Media to its server-side blob reference.
    const uploadedPatch = contactPatch(oldCard, desired, (card) => card)
    for (const [path, value] of Object.entries(uploadedPatch))
      wirePatch[`${isJsonObject(previous.jsCard) ? 'jsCard/' : ''}${path}`] = value
    if (target !== source.bookId) {
      wirePatch[`addressBookIds/${source.bookId.replace(/~/g, '~0').replace(/\//g, '~1')}`] = null
      wirePatch[`addressBookIds/${target.replace(/~/g, '~0').replace(/\//g, '~1')}`] = true
    }
    if (Object.keys(wirePatch).length)
      await this.set('ContactCard', 'update', source.cardId, wirePatch)
    const [current] = await this.cards([source.cardId])
    if (!current) throw methodError({ type: 'notFound' }, 'ContactCard/get', 'contacts')
    return {
      url: this.bookUrl(target) + encodeURIComponent(source.cardId),
      etag: contactEtag(current),
    }
  }
  async deleteContact(book: AddressBook, url: string, etag: string | undefined): Promise<void> {
    const source = this.parseUrl(url, true)
    if (source.bookId !== this.parseUrl(book.url).bookId)
      throw new JmapError('Contact is outside its address book', { type: 'invalidArguments' })
    const [previous] = await this.cards([source.cardId])
    if (!previous || !this.member(previous, source.bookId)) return
    if (etag && etag !== contactEtag(previous))
      throw new CardDAVConflictError(contactEtag(previous))
    if (
      Object.entries(object(previous.addressBookIds)).some(
        ([id, member]) => id !== source.bookId && member === true
      )
    )
      await this.set('ContactCard', 'update', source.cardId, {
        [`addressBookIds/${source.bookId.replace(/~/g, '~0').replace(/\//g, '~1')}`]: null,
      })
    else await this.set('ContactCard', 'destroy', source.cardId)
  }
  async syncCollection(book: AddressBook, syncToken: string | null): Promise<ContactsSyncResult> {
    const id = this.parseUrl(book.url).bookId
    try {
      if (syncToken === null) {
        const state = required((await this.call('ContactCard/get', { ids: [] })).state)
        const cards = await this.cards(await this.query(id))
        return {
          changes: cards
            .filter((card) => this.member(card, id))
            .map((card) => ({
              url: this.bookUrl(id) + encodeURIComponent(required(card.id)),
              etag: contactEtag(card),
              status: 'changed' as const,
            })),
          newSyncToken: state,
          tokenInvalidated: false,
        }
      }
      let state = syncToken
      const changed = new Set<string>(),
        destroyed = new Set<string>()
      while (true) {
        const result = await this.call('ContactCard/changes', { sinceState: state })
        for (const key of [...strings(result.created), ...strings(result.updated)]) {
          changed.add(key)
          destroyed.delete(key)
        }
        for (const key of strings(result.destroyed)) {
          changed.delete(key)
          destroyed.add(key)
        }
        const next = required(result.newState)
        if (result.hasMoreChanges && next === state)
          throw new JmapError('Contact changes cursor did not advance', { type: 'invalidResponse' })
        state = next
        if (!result.hasMoreChanges) break
      }
      const cards = new Map(
        (await this.cards([...changed])).map((card) => [required(card.id), card])
      )
      return {
        changes: [...new Set([...changed, ...destroyed])].map((key) => {
          const card = cards.get(key),
            present = card && this.member(card, id)
          return {
            url: this.bookUrl(id) + encodeURIComponent(key),
            etag: present ? contactEtag(card) : null,
            status: present ? ('changed' as const) : ('removed' as const),
          }
        }),
        newSyncToken: state,
        tokenInvalidated: false,
      }
    } catch {
      return { changes: [], newSyncToken: null, tokenInvalidated: true }
    }
  }
}
export async function createJmapContactsBackend(
  serverUrl: string,
  credentials: CalDAVCredentials,
  proxyUrl: string | null = null
): Promise<ContactsBackend> {
  const backend = new JmapContactsBackend(serverUrl, credentials, proxyUrl)
  await backend.connect()
  return backend
}
