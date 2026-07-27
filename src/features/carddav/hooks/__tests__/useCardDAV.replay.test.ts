import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useContactStore } from '@/store/contactStore'
import type { AddressBook, PendingContactChange } from '../../types'
import type { PendingDeleteSnapshot } from '@/lib/deleteContactWithUndo'

vi.mock('../../client/CardDAVClient')
vi.mock('@/features/caldav/client/credentials')
vi.mock('@/features/caldav/sync/accountStorage')

import * as CardDAVClientModule from '../../client/CardDAVClient'
import * as credentials from '@/features/caldav/client/credentials'
import * as accountStorage from '@/features/caldav/sync/accountStorage'
import { useCardDAV } from '../useCardDAV'

const ACCOUNT_ID = 'account-1'
const BOOK_URL = 'https://dav.example/book-a/'

const deleteContact = vi.fn()
const fetchAddressBooks = vi.fn()
const fetchContacts = vi.fn()
const syncCollection = vi.fn()

function makeAddressBook(): AddressBook {
  return {
    id: BOOK_URL,
    url: BOOK_URL,
    name: 'Book A',
    accountId: ACCOUNT_ID,
    isVisible: true,
  } as AddressBook
}

beforeEach(() => {
  vi.clearAllMocks()

  deleteContact.mockResolvedValue(undefined)
  fetchAddressBooks.mockResolvedValue([])
  fetchContacts.mockResolvedValue([])
  syncCollection.mockResolvedValue({ tokenInvalidated: true, changes: [], newSyncToken: null })
  ;(CardDAVClientModule.createCardDAVClient as ReturnType<typeof vi.fn>).mockResolvedValue({
    deleteContact,
    fetchAddressBooks,
    fetchContacts,
    syncCollection,
    createContact: vi.fn(),
    updateContact: vi.fn(),
  })
  ;(credentials.getCredentialById as ReturnType<typeof vi.fn>).mockResolvedValue({
    username: 'u',
    password: 'p',
  })
  // The hook kicks off a mount-time sync of all accounts; keep that a no-op
  ;(accountStorage.getAllAccounts as ReturnType<typeof vi.fn>).mockReturnValue([])
  ;(accountStorage.getAccountById as ReturnType<typeof vi.fn>).mockReturnValue({
    id: ACCOUNT_ID,
    serverUrl: 'https://dav.example/',
    credentialId: 'cred-1',
  })

  useContactStore.setState({
    contacts: [],
    addressBooks: [makeAddressBook()],
    pendingChanges: [],
  })
})

describe('useCardDAV — pending delete replay (issue #75)', () => {
  it('issues DELETE for a contact that was already removed from the store', async () => {
    const snapshot: PendingDeleteSnapshot = {
      url: `${BOOK_URL}contact-1.vcf`,
      etag: '"abc123"',
      addressBookId: BOOK_URL,
      accountId: ACCOUNT_ID,
    }
    const change: PendingContactChange = {
      id: 'change-1',
      type: 'delete',
      contactId: 'contact-1',
      addressBookId: BOOK_URL,
      data: JSON.stringify(snapshot),
      timestamp: new Date().toISOString(),
      retryCount: 0,
    }
    // Contact is NOT in the store — it was optimistically deleted
    useContactStore.setState({ pendingChanges: [change] })

    const { result } = renderHook(() => useCardDAV())
    await act(async () => {
      await result.current.syncAccount(ACCOUNT_ID)
    })

    expect(deleteContact).toHaveBeenCalledWith(
      expect.objectContaining({ url: BOOK_URL }),
      snapshot.url,
      snapshot.etag
    )
    // And the change is drained from the queue
    expect(useContactStore.getState().pendingChanges).toHaveLength(0)
  })

  it('drops a delete for a contact that never reached the server', async () => {
    const snapshot: PendingDeleteSnapshot = {
      url: '',
      addressBookId: BOOK_URL,
      accountId: ACCOUNT_ID,
    }
    useContactStore.setState({
      pendingChanges: [
        {
          id: 'change-2',
          type: 'delete',
          contactId: 'contact-2',
          addressBookId: BOOK_URL,
          data: JSON.stringify(snapshot),
          timestamp: new Date().toISOString(),
          retryCount: 0,
        },
      ],
    })

    const { result } = renderHook(() => useCardDAV())
    await act(async () => {
      await result.current.syncAccount(ACCOUNT_ID)
    })

    expect(deleteContact).not.toHaveBeenCalled()
    expect(useContactStore.getState().pendingChanges).toHaveLength(0)
  })

  // ETag is not a CORS-safelisted response header, so a server that doesn't send
  // Access-Control-Expose-Headers leaves us with no etag at all. The DELETE must still go out.
  it('issues DELETE for a contact whose etag was never readable', async () => {
    const snapshot: PendingDeleteSnapshot = {
      url: `${BOOK_URL}contact-3.vcf`,
      addressBookId: BOOK_URL,
      accountId: ACCOUNT_ID,
    }
    useContactStore.setState({
      pendingChanges: [
        {
          id: 'change-3',
          type: 'delete',
          contactId: 'contact-3',
          addressBookId: BOOK_URL,
          data: JSON.stringify(snapshot),
          timestamp: new Date().toISOString(),
          retryCount: 0,
        },
      ],
    })

    const { result } = renderHook(() => useCardDAV())
    await act(async () => {
      await result.current.syncAccount(ACCOUNT_ID)
    })

    expect(deleteContact).toHaveBeenCalledWith(
      expect.objectContaining({ url: BOOK_URL }),
      snapshot.url,
      undefined
    )
    expect(useContactStore.getState().pendingChanges).toHaveLength(0)
  })

  it('retires a change the server keeps rejecting instead of replaying it forever', async () => {
    deleteContact.mockRejectedValue(new Error('Failed to delete contact: 400 Bad Request'))

    const snapshot: PendingDeleteSnapshot = {
      url: `${BOOK_URL}contact-4.vcf`,
      etag: '"e4"',
      addressBookId: BOOK_URL,
      accountId: ACCOUNT_ID,
      displayName: 'Bob',
    }
    useContactStore.setState({
      pendingChanges: [
        {
          id: 'change-4',
          type: 'delete',
          contactId: 'contact-4',
          addressBookId: BOOK_URL,
          data: JSON.stringify(snapshot),
          timestamp: new Date().toISOString(),
          retryCount: 0,
        },
      ],
    })

    const { result } = renderHook(() => useCardDAV())

    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await result.current.syncAccount(ACCOUNT_ID)
      })
    }

    expect(deleteContact).toHaveBeenCalledTimes(3)
    expect(useContactStore.getState().pendingChanges).toHaveLength(0)

    // A fourth sync has nothing left to replay
    await act(async () => {
      await result.current.syncAccount(ACCOUNT_ID)
    })
    expect(deleteContact).toHaveBeenCalledTimes(3)
  })
})

describe('useCardDAV — sync merge', () => {
  const serverContact = {
    id: 'contact-9',
    addressBookId: BOOK_URL,
    accountId: ACCOUNT_ID,
    url: `${BOOK_URL}contact-9.vcf`,
    etag: '"e9"',
    displayName: 'Server Contact',
  }

  beforeEach(() => {
    fetchAddressBooks.mockResolvedValue([makeAddressBook()])
    fetchContacts.mockResolvedValue([serverContact])
  })

  it('does not re-add a contact whose delete has not landed yet', async () => {
    // The DELETE fails, so the contact is still on the server — but it must not come back.
    deleteContact.mockRejectedValue(new Error('boom'))

    const snapshot: PendingDeleteSnapshot = {
      url: serverContact.url,
      etag: serverContact.etag,
      addressBookId: BOOK_URL,
      accountId: ACCOUNT_ID,
    }
    useContactStore.setState({
      contacts: [],
      pendingChanges: [
        {
          id: 'change-9',
          type: 'delete',
          contactId: serverContact.id,
          addressBookId: BOOK_URL,
          data: JSON.stringify(snapshot),
          timestamp: new Date().toISOString(),
          retryCount: 0,
        },
      ],
    })

    const { result } = renderHook(() => useCardDAV())
    await act(async () => {
      await result.current.syncAccount(ACCOUNT_ID)
    })

    expect(useContactStore.getState().contacts).toHaveLength(0)
  })

  it('collapses concurrent syncs onto one run plus a single trailing pass', async () => {
    useContactStore.setState({ contacts: [], pendingChanges: [] })

    const { result } = renderHook(() => useCardDAV())
    await act(async () => {
      await Promise.all([
        result.current.syncAccount(ACCOUNT_ID),
        result.current.syncAccount(ACCOUNT_ID),
        result.current.syncAccount(ACCOUNT_ID),
      ])
    })

    // One run for the first caller, one trailing run covering the other two — never three
    // overlapping passes racing to write the contact list.
    expect(fetchAddressBooks).toHaveBeenCalledTimes(2)
    expect(useContactStore.getState().contacts).toHaveLength(1)
  })

  // A sync requested mid-flight must still get its own replay pass: the running sync is
  // already past its replay step, so piggybacking would drop the change silently.
  it('replays a delete queued while another sync is in flight', async () => {
    useContactStore.setState({ contacts: [], pendingChanges: [] })

    let releaseFirstFetch: () => void = () => {}
    const firstFetchStarted = new Promise<void>((resolve) => {
      fetchAddressBooks.mockImplementationOnce(async () => {
        resolve()
        await new Promise<void>((r) => {
          releaseFirstFetch = r
        })
        return [makeAddressBook()]
      })
    })

    const { result } = renderHook(() => useCardDAV())

    await act(async () => {
      const first = result.current.syncAccount(ACCOUNT_ID)
      await firstFetchStarted

      // User deletes a contact while that sync is still fetching
      const snapshot: PendingDeleteSnapshot = {
        url: serverContact.url,
        etag: serverContact.etag,
        addressBookId: BOOK_URL,
        accountId: ACCOUNT_ID,
      }
      useContactStore.setState({
        pendingChanges: [
          {
            id: 'change-mid',
            type: 'delete',
            contactId: serverContact.id,
            addressBookId: BOOK_URL,
            data: JSON.stringify(snapshot),
            timestamp: new Date().toISOString(),
            retryCount: 0,
          },
        ],
      })
      const second = result.current.syncAccount(ACCOUNT_ID)

      releaseFirstFetch()
      await Promise.all([first, second])
    })

    expect(deleteContact).toHaveBeenCalledWith(
      expect.objectContaining({ url: BOOK_URL }),
      serverContact.url,
      serverContact.etag
    )
    // And the contact does not come back from the first sync's server snapshot
    expect(useContactStore.getState().contacts).toHaveLength(0)
    expect(useContactStore.getState().pendingChanges).toHaveLength(0)
  })
})
