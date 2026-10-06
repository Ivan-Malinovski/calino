import { applyJmapPatch } from '../../convert/jscalendarDiff'
import { JMAP_CONTACTS, JMAP_CORE, type JsonObject } from '../../types'
import type { JmapInvocation, JmapSession } from '../../client/session'

/** Hand-authored RFC-shaped wire fake, not captured Stalwart responses. */
export class FakeContactsServer {
  accountId = 'contacts/account'
  books = new Map<string, JsonObject>([
    [
      'default',
      {
        id: 'default',
        name: 'Contacts',
        myRights: { mayRead: true, mayWrite: true, mayDelete: true, mayShare: true },
      },
    ],
  ])
  cards = new Map<string, JsonObject>()
  blobs = new Map<string, { bytes: ArrayBuffer; type: string }>()
  calls: JmapInvocation[] = []
  requests: { using: string[]; methodCalls: JmapInvocation[] }[] = []
  history: { id: string; kind: 'created' | 'updated' | 'destroyed' }[] = []
  queryPageSize = 2
  changesPageSize = 2
  uploads = 0
  downloads = 0
  sequence = 0
  failMethod: { method: string; type: string } | null = null
  failSet: JsonObject | null = null
  /** Emulates Stalwart, which rejects `blobId` in Media on create and update. */
  rejectMediaBlobs = false
  afterQuery: (() => void) | null = null
  session: JmapSession = {
    capabilities: {
      [JMAP_CORE]: { maxCallsInRequest: 4, maxObjectsInGet: 2, maxObjectsInSet: 2 },
      [JMAP_CONTACTS]: {},
    },
    accounts: {
      [this.accountId]: {
        name: 'Contacts',
        isPersonal: true,
        isReadOnly: false,
        accountCapabilities: { [JMAP_CONTACTS]: {} },
      },
    },
    primaryAccounts: { [JMAP_CONTACTS]: this.accountId },
    username: 'test@example.test',
    apiUrl: 'https://localhost/jmap/api',
    uploadUrl: '/upload/{accountId}',
    downloadUrl: '/download/{accountId}/{blobId}/{name}?type={type}',
    eventSourceUrl: '/events',
    state: 'session-1',
  }
  seed(jsCard: JsonObject, addressBookIds: JsonObject = { default: true }): string {
    const id = `card${++this.sequence}`
    this.cards.set(id, {
      id,
      jsCard: structuredClone(jsCard),
      addressBookIds,
      blobId: `raw-${id}`,
      size: 99,
    })
    this.history.push({ id, kind: 'created' })
    return id
  }
  state(): string {
    return `card-${this.history.length}`
  }
  private response(value: unknown, url?: string): Response {
    const response = new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    if (url) Object.defineProperty(response, 'url', { value: url })
    return response
  }
  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    if (url.includes('/upload/')) {
      if (!url.includes(encodeURIComponent(this.accountId)))
        throw new Error('Blob upload used wrong account')
      const blobId = `photo${++this.uploads}`,
        type = new Headers(init?.headers).get('Content-Type') || 'application/octet-stream'
      this.blobs.set(blobId, { bytes: init!.body as ArrayBuffer, type })
      return this.response({ blobId, type, size: (init!.body as ArrayBuffer).byteLength })
    }
    if (url.includes('/download/')) {
      if (!url.includes(encodeURIComponent(this.accountId)))
        throw new Error('Blob download used wrong account')
      this.downloads++
      const id = new URL(url).pathname.split('/')[3],
        blob = this.blobs.get(decodeURIComponent(id))
      if (!blob) return new Response(null, { status: 404 })
      return new Response(blob.bytes, { headers: { 'Content-Type': blob.type } })
    }
    if (init?.method !== 'POST')
      return this.response(this.session, 'https://contacts.test/jmap/session')
    const request = JSON.parse(String(init.body)) as {
      using: string[]
      methodCalls: JmapInvocation[]
    }
    if (
      !request.using.includes(JMAP_CONTACTS) ||
      request.using.some((value) => value.includes(':calendars'))
    )
      throw new Error('Wrong capability set')
    this.requests.push(request)
    const methodResponses = request.methodCalls.map(([method, args, callId]): JmapInvocation => {
      this.calls.push([method, structuredClone(args), callId])
      if (args.accountId !== this.accountId) return ['error', { type: 'accountNotFound' }, callId]
      if (this.failMethod?.method === method)
        return ['error', { type: this.failMethod.type }, callId]
      const [type, operation] = method.split('/')
      const storage = type === 'AddressBook' ? this.books : this.cards
      if (operation === 'get') {
        const ids = args.ids === null ? [...storage.keys()] : (args.ids as string[])
        return [
          method,
          {
            accountId: this.accountId,
            state: type === 'ContactCard' ? this.state() : 'book-1',
            list: ids.flatMap((id) => (storage.has(id) ? [structuredClone(storage.get(id)!)] : [])),
            notFound: ids.filter((id) => !storage.has(id)),
          },
          callId,
        ]
      }
      if (operation === 'query') {
        const filter = args.filter as JsonObject,
          position = args.position as number
        const ids = [...this.cards]
          .filter(
            ([, card]) =>
              (card.addressBookIds as JsonObject)[filter.inAddressBook as string] === true
          )
          .map(([id]) => id)
        const state = this.state()
        this.afterQuery?.()
        this.afterQuery = null
        return [
          method,
          {
            accountId: this.accountId,
            queryState: state,
            position,
            ids: ids.slice(position, position + this.queryPageSize),
            total: ids.length,
          },
          callId,
        ]
      }
      if (operation === 'changes') {
        const since = Number(String(args.sinceState).replace(/^card-/, ''))
        if (
          !String(args.sinceState).startsWith('card-') ||
          !Number.isInteger(since) ||
          since < 0 ||
          since > this.history.length
        )
          return ['error', { type: 'cannotCalculateChanges' }, callId]
        const until = Math.min(this.history.length, since + this.changesPageSize)
        const kinds = new Map(this.history.slice(since, until).map(({ id, kind }) => [id, kind]))
        return [
          method,
          {
            accountId: this.accountId,
            oldState: args.sinceState,
            newState: `card-${until}`,
            hasMoreChanges: until < this.history.length,
            created: [...kinds].filter(([, kind]) => kind === 'created').map(([id]) => id),
            updated: [...kinds].filter(([, kind]) => kind === 'updated').map(([id]) => id),
            destroyed: [...kinds].filter(([, kind]) => kind === 'destroyed').map(([id]) => id),
          },
          callId,
        ]
      }
      if (operation === 'set') {
        const result: JsonObject = { accountId: this.accountId, oldState: this.state() }
        for (const action of ['create', 'update', 'destroy'] as const) {
          const data = args[action]
          if (!data) continue
          const failures = { create: 'notCreated', update: 'notUpdated', destroy: 'notDestroyed' }[
            action
          ]
          const pairs =
            action === 'destroy'
              ? (data as string[]).map((id) => [id, {}] as const)
              : Object.entries(data as JsonObject)
          for (const [key, value] of pairs) {
            if (this.failSet || (action !== 'create' && !storage.has(key))) {
              ;((result[failures] ??= {}) as JsonObject)[key] = this.failSet ?? { type: 'notFound' }
              continue
            }
            if (
              this.rejectMediaBlobs &&
              type === 'ContactCard' &&
              JSON.stringify(value).includes('blobId')
            ) {
              ;((result[failures] ??= {}) as JsonObject)[key] = {
                type: 'invalidProperties',
                description: 'blobIds in media is not supported.',
              }
              continue
            }
            if (
              action === 'create' &&
              type === 'ContactCard' &&
              'jsCard' in (value as JsonObject)
            ) {
              // Real servers (Stalwart) reject the pre-RFC `jsCard` envelope on create.
              ;((result[failures] ??= {}) as JsonObject)[key] = {
                type: 'invalidProperties',
                properties: ['jsCard'],
              }
              continue
            }
            if (action === 'create') {
              const { addressBookIds, ...card } = value as JsonObject
              const id =
                type === 'ContactCard'
                  ? this.seed(card, addressBookIds as JsonObject)
                  : `book${++this.sequence}`
              if (type === 'AddressBook') storage.set(id, { ...(value as JsonObject), id })
              ;((result.created ??= {}) as JsonObject)[key] = { id }
            } else if (action === 'update') {
              storage.set(key, applyJmapPatch(storage.get(key)!, value as JsonObject))
              ;((result.updated ??= {}) as JsonObject)[key] = null
              if (type === 'ContactCard') this.history.push({ id: key, kind: 'updated' })
            } else {
              storage.delete(key)
              ;((result.destroyed ??= []) as string[]).push(key)
              if (type === 'ContactCard') this.history.push({ id: key, kind: 'destroyed' })
              else
                for (const [id, card] of this.cards)
                  if ((card.addressBookIds as JsonObject)[key]) {
                    this.cards.delete(id)
                    this.history.push({ id, kind: 'destroyed' })
                  }
            }
          }
        }
        result.newState = this.state()
        return [method, result, callId]
      }
      return ['error', { type: 'unknownMethod' }, callId]
    })
    return this.response({ methodResponses, sessionState: this.session.state })
  }
}
