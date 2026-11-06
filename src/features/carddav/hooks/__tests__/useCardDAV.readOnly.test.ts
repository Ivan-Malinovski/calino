import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useContactStore } from '@/store/contactStore'
import type { AddressBook, Contact, PendingContactChange } from '../../types'
import type { PendingDeleteSnapshot } from '@/lib/deleteContactWithUndo'
import { CardDAVPermissionError } from '../../client/errors'

vi.mock('../../client/CardDAVClient')
vi.mock('@/features/caldav/client/credentials')
vi.mock('@/features/caldav/sync/accountStorage')
vi.mock('@/lib/toast')

import * as CardDAVClientModule from '../../client/CardDAVClient'
import { showToast } from '@/lib/toast'
import * as credentials from '@/features/caldav/client/credentials'
import * as accountStorage from '@/features/caldav/sync/accountStorage'
import { useCardDAV } from '../useCardDAV'

const ACCOUNT_ID = 'account-1'
const TEAM_URL = 'https://dav.example.com/alice/team/'

const fetchAddressBooks = vi.fn()
const fetchContactsByUrls = vi.fn()
const createContact = vi.fn()
const updateContact = vi.fn()
const deleteContact = vi.fn()

function teamBook(overrides: Partial<AddressBook> = {}): AddressBook {
  return {
    id: TEAM_URL,
    url: TEAM_URL,
    name: 'Team Directory',
    accountId: ACCOUNT_ID,
    ctag: 'ctag-1',
    syncToken: null,
    isVisible: true,
    ...overrides,
  }
}

async function sync(): Promise<void> {
  const { result } = renderHook(() => useCardDAV())
  await act(async () => {
    await result.current.syncAccount(ACCOUNT_ID)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(CardDAVClientModule.createCardDAVClient as ReturnType<typeof vi.fn>).mockResolvedValue({
    fetchAddressBooks,
    fetchContacts: vi.fn().mockResolvedValue([]),
    fetchContactsByUrls,
    syncCollection: vi.fn(),
    createContact,
    updateContact,
    deleteContact,
  })
  ;(credentials.getCredentialById as ReturnType<typeof vi.fn>).mockResolvedValue({
    username: 'u',
    password: 'p',
  })
  ;(accountStorage.getAllAccounts as ReturnType<typeof vi.fn>).mockReturnValue([])
  ;(accountStorage.getAccountById as ReturnType<typeof vi.fn>).mockReturnValue({
    id: ACCOUNT_ID,
    serverUrl: 'https://dav.example.com/',
    credentialId: 'cred-1',
  })
})

describe('useCardDAV — address book privileges', () => {
  // The book was stored by an earlier sync, before its owner shared it read-only.
  it('refreshes canWrite on a book it already knows', async () => {
    useContactStore.setState({ contacts: [], addressBooks: [teamBook()], pendingChanges: [] })
    fetchAddressBooks.mockResolvedValue([teamBook({ canWrite: false })])

    await sync()
    expect(useContactStore.getState().addressBooks[0].canWrite).toBe(false)

    fetchAddressBooks.mockResolvedValue([teamBook({ canWrite: true })])
    await sync()
    expect(useContactStore.getState().addressBooks[0].canWrite).toBe(true)
  })
})

describe('useCardDAV — a write the server refuses with 403', () => {
  const bobOnServer = {
    id: 'uid-bob',
    addressBookId: TEAM_URL,
    accountId: ACCOUNT_ID,
    url: `${TEAM_URL}bob.vcf`,
    etag: '"e1"',
    displayName: 'Bob Brown',
    lastModified: '2026-01-01T00:00:00.000Z',
  } as Contact

  function queued(type: PendingContactChange['type'], data?: string): PendingContactChange {
    return {
      id: `change-${type}`,
      type,
      contactId: 'uid-bob',
      addressBookId: TEAM_URL,
      data,
      timestamp: new Date().toISOString(),
      retryCount: 0,
    }
  }

  beforeEach(() => {
    fetchAddressBooks.mockResolvedValue([teamBook()])
    fetchContactsByUrls.mockResolvedValue([bobOnServer])
    const forbidden = () => Promise.reject(new CardDAVPermissionError())
    createContact.mockImplementation(forbidden)
    updateContact.mockImplementation(forbidden)
    deleteContact.mockImplementation(forbidden)
  })

  it('puts the server copy back over the local edit, without retrying', async () => {
    useContactStore.setState({
      contacts: [{ ...bobOnServer, displayName: 'Bobby', syncStatus: 'pending' }],
      addressBooks: [teamBook()],
      pendingChanges: [queued('update')],
    })

    await sync()

    expect(updateContact).toHaveBeenCalledTimes(1)
    expect(useContactStore.getState().pendingChanges).toHaveLength(0)
    expect(useContactStore.getState().contacts).toEqual([
      expect.objectContaining({ id: 'uid-bob', displayName: 'Bob Brown', syncStatus: 'synced' }),
    ])
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("Couldn't update"))
  })

  it('brings back a contact whose delete was refused', async () => {
    const snapshot: PendingDeleteSnapshot = {
      url: bobOnServer.url,
      etag: bobOnServer.etag,
      addressBookId: TEAM_URL,
      accountId: ACCOUNT_ID,
      displayName: 'Bob Brown',
    }
    useContactStore.setState({
      contacts: [],
      addressBooks: [teamBook()],
      pendingChanges: [queued('delete', JSON.stringify(snapshot))],
    })

    await sync()

    expect(useContactStore.getState().pendingChanges).toHaveLength(0)
    expect(useContactStore.getState().contacts).toEqual([
      expect.objectContaining({ id: 'uid-bob', displayName: 'Bob Brown' }),
    ])
  })

  it('drops a contact the server refused to create', async () => {
    useContactStore.setState({
      contacts: [{ ...bobOnServer, url: '', etag: undefined, syncStatus: 'pending' }],
      addressBooks: [teamBook()],
      pendingChanges: [queued('create')],
    })

    await sync()

    expect(useContactStore.getState().pendingChanges).toHaveLength(0)
    expect(useContactStore.getState().contacts).toHaveLength(0)
  })
})
