import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Contact, PendingContactChange } from '@/features/carddav/types'
import {
  deleteContactWithUndo,
  type PendingDeleteSnapshot,
} from '../deleteContactWithUndo'

const undoHandlers: (() => void)[] = []

vi.mock('../toast', () => ({
  showToast: (_message: string, options?: { onUndo?: () => void }) => {
    if (options?.onUndo) undoHandlers.push(options.onUndo)
  },
}))

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'contact-1',
    addressBookId: 'https://dav.example/book-a/',
    accountId: 'account-1',
    url: 'https://dav.example/book-a/contact-1.vcf',
    etag: '"abc123"',
    familyName: 'Doe',
    givenName: 'Jane',
    additionalNames: '',
    prefixes: '',
    suffixes: '',
    nickname: '',
    displayName: 'Jane Doe',
    organization: '',
    department: '',
    title: '',
    role: '',
    emails: [],
    phones: [],
    addresses: [],
    urls: [],
    ims: [],
    birthday: null,
    anniversary: null,
    gender: '',
    note: '',
    categories: [],
    photo: null,
    isGroup: false,
    memberUids: [],
    langs: [],
    related: [],
    xmlData: null,
    opaqueLines: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    lastModified: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function setup(opts: { stillQueued?: boolean } = {}) {
  const queued: PendingContactChange[] = []
  const added: Contact[] = []
  const removedChangeIds: string[] = []
  const syncedAccounts: string[] = []

  return {
    queued,
    added,
    removedChangeIds,
    syncedAccounts,
    options: {
      deleteContact: vi.fn(),
      addContact: (c: Contact) => added.push(c),
      addPendingChange: (c: PendingContactChange) => queued.push(c),
      hasPendingChange: () => opts.stillQueued ?? false,
      removePendingChange: (id: string) => removedChangeIds.push(id),
      syncAccount: (accountId: string) => {
        syncedAccounts.push(accountId)
        return Promise.resolve()
      },
    },
  }
}

describe('deleteContactWithUndo', () => {
  beforeEach(() => {
    undoHandlers.length = 0
  })

  it('queues a delete carrying a url/etag/account snapshot', () => {
    const contact = makeContact()
    const { queued, options } = setup()

    deleteContactWithUndo({ contact, ...options })

    expect(queued).toHaveLength(1)
    expect(queued[0]!.type).toBe('delete')
    expect(queued[0]!.data).toBeDefined()

    const snapshot = JSON.parse(queued[0]!.data!) as PendingDeleteSnapshot
    expect(snapshot).toEqual({
      url: contact.url,
      etag: contact.etag,
      addressBookId: contact.addressBookId,
      accountId: contact.accountId,
      displayName: contact.displayName,
    })
  })

  it('removes the contact locally and syncs the account immediately', () => {
    const contact = makeContact()
    const { syncedAccounts, options } = setup()

    deleteContactWithUndo({ contact, ...options })

    expect(options.deleteContact).toHaveBeenCalledWith(contact.id)
    expect(syncedAccounts).toEqual(['account-1'])
  })

  it('undo before replay cancels the queued delete instead of re-creating', () => {
    const contact = makeContact()
    const { queued, added, removedChangeIds, options } = setup({ stillQueued: true })

    deleteContactWithUndo({ contact, ...options })
    const deleteChangeId = queued[0]!.id

    undoHandlers[0]!()

    expect(removedChangeIds).toEqual([deleteChangeId])
    expect(added).toHaveLength(1)
    expect(added[0]!.url).toBe(contact.url)
    // No create was queued — the server copy was never touched
    expect(queued.filter((c) => c.type === 'create')).toHaveLength(0)
  })

  it('undo after replay queues a create for a fresh resource', () => {
    const contact = makeContact()
    const { queued, added, removedChangeIds, options } = setup({ stillQueued: false })

    deleteContactWithUndo({ contact, ...options })
    undoHandlers[0]!()

    expect(removedChangeIds).toEqual([])
    expect(added).toHaveLength(1)
    // url/etag cleared so the replay PUTs a new resource
    expect(added[0]!.url).toBe('')
    expect(added[0]!.etag).toBeUndefined()
    expect(queued.filter((c) => c.type === 'create')).toHaveLength(1)
  })
})
