import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useContactStore } from '@/store/contactStore'
import type { AddressBook, Contact } from '../../types'

vi.mock('../../client/CardDAVClient')
vi.mock('@/features/caldav/client/credentials')
vi.mock('@/features/caldav/sync/accountStorage')

import * as CardDAVClientModule from '../../client/CardDAVClient'
import * as credentials from '@/features/caldav/client/credentials'
import * as accountStorage from '@/features/caldav/sync/accountStorage'
import { useCardDAV } from '../useCardDAV'

/**
 * Incremental (sync-collection) sync must be a *delta*: the contacts the server
 * returns are only the ones that changed, so the rest of the book has to survive
 * the merge. These specs guard against treating "not in the response" as "deleted
 * on the server", which would wipe every unchanged contact from a book as soon as
 * one contact changed elsewhere.
 */

const ACCOUNT_ID = 'account-1'
const BOOK_URL = 'https://dav.example/book-a/'

const fetchAddressBooks = vi.fn()
const fetchContacts = vi.fn()
const fetchContactsByUrls = vi.fn()
const syncCollection = vi.fn()

function makeContact(slug: string, overrides: Partial<Contact> = {}): Contact {
  return {
    id: `id-${slug}`,
    addressBookId: BOOK_URL,
    accountId: ACCOUNT_ID,
    url: `${BOOK_URL}${slug}.vcf`,
    etag: `etag-${slug}`,
    displayName: `Person ${slug}`,
    lastModified: '2026-01-01T00:00:00.000Z',
    syncStatus: 'synced',
    ...overrides,
  } as Contact
}

/** The book as the server reports it now (ctag already moved on). */
function serverBook(): AddressBook {
  return {
    id: BOOK_URL,
    url: BOOK_URL,
    name: 'Book A',
    accountId: ACCOUNT_ID,
    ctag: 'ctag-new',
    syncToken: null,
    isVisible: true,
  }
}

function seedStore(contacts: Contact[]): void {
  useContactStore.setState({
    contacts,
    addressBooks: [{ ...serverBook(), ctag: 'ctag-old', syncToken: 'token-1' }],
    pendingChanges: [],
  })
}

async function runSync(): Promise<void> {
  const { result } = renderHook(() => useCardDAV())
  await act(async () => {
    await result.current.syncAccount(ACCOUNT_ID)
  })
}

const urls = (): string[] =>
  useContactStore
    .getState()
    .contacts.map((c) => c.url)
    .sort()

beforeEach(() => {
  vi.clearAllMocks()

  fetchAddressBooks.mockResolvedValue([serverBook()])
  fetchContacts.mockResolvedValue([])
  fetchContactsByUrls.mockResolvedValue([])
  ;(CardDAVClientModule.createCardDAVClient as ReturnType<typeof vi.fn>).mockResolvedValue({
    fetchAddressBooks,
    fetchContacts,
    fetchContactsByUrls,
    syncCollection,
    deleteContact: vi.fn(),
    createContact: vi.fn(),
    updateContact: vi.fn(),
  })
  ;(credentials.getCredentialById as ReturnType<typeof vi.fn>).mockResolvedValue({
    username: 'u',
    password: 'p',
  })
  ;(accountStorage.getAllAccounts as ReturnType<typeof vi.fn>).mockReturnValue([])
  ;(accountStorage.getAccountById as ReturnType<typeof vi.fn>).mockReturnValue({
    id: ACCOUNT_ID,
    serverUrl: 'https://dav.example/',
    credentialId: 'cred-1',
  })
})

describe('useCardDAV — incremental sync keeps the unchanged contacts', () => {
  it('applies one changed contact without dropping the rest of the book', async () => {
    seedStore([makeContact('a'), makeContact('b'), makeContact('c')])
    syncCollection.mockResolvedValue({
      tokenInvalidated: false,
      newSyncToken: 'token-2',
      changes: [{ url: '/book-a/b.vcf', etag: 'etag-b2', status: 'added' }],
    })
    fetchContactsByUrls.mockResolvedValue([
      makeContact('b', { etag: 'etag-b2', displayName: 'Person b (edited)' }),
    ])

    await runSync()

    expect(fetchContacts).not.toHaveBeenCalled()
    expect(urls()).toEqual([`${BOOK_URL}a.vcf`, `${BOOK_URL}b.vcf`, `${BOOK_URL}c.vcf`])
    expect(useContactStore.getState().contacts.find((c) => c.id === 'id-b')?.displayName).toBe(
      'Person b (edited)'
    )
    expect(useContactStore.getState().addressBooks[0].syncToken).toBe('token-2')
  })

  it('keeps everything when the token is valid and nothing changed, even if the ctag moved', async () => {
    seedStore([makeContact('a'), makeContact('b')])
    syncCollection.mockResolvedValue({
      tokenInvalidated: false,
      newSyncToken: 'token-2',
      changes: [],
    })

    await runSync()

    expect(urls()).toEqual([`${BOOK_URL}a.vcf`, `${BOOK_URL}b.vcf`])
    expect(useContactStore.getState().addressBooks[0].syncToken).toBe('token-2')
  })

  it('removes a contact the server reports as removed, and only that one', async () => {
    seedStore([makeContact('a'), makeContact('b'), makeContact('c')])
    syncCollection.mockResolvedValue({
      tokenInvalidated: false,
      newSyncToken: 'token-2',
      changes: [{ url: '/book-a/b.vcf', etag: null, status: 'removed' }],
    })

    await runSync()

    expect(urls()).toEqual([`${BOOK_URL}a.vcf`, `${BOOK_URL}c.vcf`])
  })

  it('matches a removed href that is percent-encoded differently from the stored url', async () => {
    seedStore([makeContact('josé', { url: `${BOOK_URL}jos%C3%A9.vcf` }), makeContact('b')])
    syncCollection.mockResolvedValue({
      tokenInvalidated: false,
      newSyncToken: 'token-2',
      // parseMultistatus hands back decoded hrefs
      changes: [{ url: '/book-a/josé.vcf', etag: null, status: 'removed' }],
    })

    await runSync()

    expect(urls()).toEqual([`${BOOK_URL}b.vcf`])
  })

  it('does not remove a pending local contact the server also reports removed', async () => {
    seedStore([makeContact('a'), makeContact('b')])
    useContactStore.setState({
      pendingChanges: [
        {
          id: 'change-1',
          type: 'update',
          contactId: 'id-b',
          addressBookId: BOOK_URL,
          data: '{}',
          timestamp: new Date().toISOString(),
          retryCount: 0,
        },
      ],
    })
    syncCollection.mockResolvedValue({
      tokenInvalidated: false,
      newSyncToken: 'token-2',
      changes: [{ url: '/book-a/b.vcf', etag: null, status: 'removed' }],
    })

    await runSync()

    expect(urls()).toEqual([`${BOOK_URL}a.vcf`, `${BOOK_URL}b.vcf`])
  })
})

describe('useCardDAV — full fetch still prunes', () => {
  it('drops a contact missing from a full fetch when the token was invalidated', async () => {
    seedStore([makeContact('a'), makeContact('gone')])
    syncCollection.mockResolvedValue({ tokenInvalidated: true, newSyncToken: null, changes: [] })
    fetchContacts.mockResolvedValue([makeContact('a')])

    await runSync()

    expect(urls()).toEqual([`${BOOK_URL}a.vcf`])
  })
})

describe('useCardDAV — an incomplete multiget must not advance the token', () => {
  it('falls back to a full fetch and keeps the old token', async () => {
    seedStore([makeContact('a'), makeContact('b'), makeContact('gone')])
    syncCollection.mockResolvedValue({
      tokenInvalidated: false,
      newSyncToken: 'token-2',
      changes: [
        { url: '/book-a/b.vcf', etag: 'etag-b2', status: 'added' },
        { url: '/book-a/new.vcf', etag: 'etag-n', status: 'added' },
      ],
    })
    // One of the two changed cards could not be fetched or parsed
    fetchContactsByUrls.mockResolvedValue([makeContact('b', { etag: 'etag-b2' })])
    fetchContacts.mockResolvedValue([makeContact('a'), makeContact('b'), makeContact('new')])

    await runSync()

    expect(fetchContacts).toHaveBeenCalledTimes(1)
    expect(useContactStore.getState().addressBooks[0].syncToken).toBe('token-1')
    // The full fetch is a complete listing, so it prunes what the server no longer has
    expect(urls()).toEqual([`${BOOK_URL}a.vcf`, `${BOOK_URL}b.vcf`, `${BOOK_URL}new.vcf`])
  })
})
