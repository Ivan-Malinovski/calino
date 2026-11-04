import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useContactStore } from '@/store/contactStore'
import type { AddressBook } from '../../types'

vi.mock('../../client/CardDAVClient')
vi.mock('@/features/caldav/client/credentials')
vi.mock('@/features/caldav/sync/accountStorage')

import * as CardDAVClientModule from '../../client/CardDAVClient'
import * as credentials from '@/features/caldav/client/credentials'
import * as accountStorage from '@/features/caldav/sync/accountStorage'
import { useCardDAV } from '../useCardDAV'

const ACCOUNT_ID = 'account-1'
const TEAM_URL = 'https://dav.example.com/alice/team/'

const fetchAddressBooks = vi.fn()

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
    syncCollection: vi.fn(),
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
