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
  ;(CardDAVClientModule.createCardDAVClient as ReturnType<typeof vi.fn>).mockResolvedValue({
    deleteContact,
    fetchAddressBooks,
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
})
