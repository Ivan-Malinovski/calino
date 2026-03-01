import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import * as discovery from '../../client/discovery'
import * as credentials from '../../client/credentials'
import * as accountStorage from '../../sync/accountStorage'
import { useCalDAV } from '../useCalDAV'

vi.mock('../../client/discovery')
vi.mock('../../client/credentials')
vi.mock('../../sync/accountStorage')
vi.mock('../../adapter/iCalendarAdapter')
vi.mock('../../client/CalDAVClient')
vi.mock('../../sync/syncEngine')

const mockDiscovery = discovery as typeof discovery & {
  discoverServerUrl: ReturnType<typeof vi.fn>
  testConnection: ReturnType<typeof vi.fn>
}
const mockCredentials = credentials as typeof credentials & {
  saveCredentials: ReturnType<typeof vi.fn>
  getCredentialById: ReturnType<typeof vi.fn>
  deleteCredential: ReturnType<typeof vi.fn>
}
const mockAccountStorage = accountStorage as typeof accountStorage & {
  getAllAccounts: ReturnType<typeof vi.fn>
  getAllCalendars: ReturnType<typeof vi.fn>
  getPendingChanges: ReturnType<typeof vi.fn>
  saveAccount: ReturnType<typeof vi.fn>
  deleteAccount: ReturnType<typeof vi.fn>
  getAccountById: ReturnType<typeof vi.fn>
  getCalendarsByAccountId: ReturnType<typeof vi.fn>
}

describe('useCalDAV', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockAccountStorage.getAllAccounts.mockReturnValue([])
    mockAccountStorage.getAllCalendars.mockReturnValue([])
    mockAccountStorage.getPendingChanges.mockReturnValue([])
    mockDiscovery.discoverServerUrl.mockResolvedValue('https://caldav.example.com')
    mockDiscovery.testConnection.mockResolvedValue(true)
    mockCredentials.saveCredentials.mockReturnValue({
      id: 'cred-1',
      serverUrl: '',
      username: '',
      password: '',
    })
    mockCredentials.getCredentialById.mockReturnValue({
      id: 'cred-1',
      serverUrl: '',
      username: '',
      password: '',
    })
    mockCredentials.deleteCredential.mockReturnValue(undefined)
  })

  it('returns initial empty state', () => {
    const { result } = renderHook(() => useCalDAV())

    expect(result.current.accounts).toEqual([])
    expect(result.current.calendars).toEqual([])
    expect(result.current.syncState.status).toBe('idle')
  })

  it('loads accounts and calendars on mount', () => {
    mockAccountStorage.getAllAccounts.mockReturnValue([
      {
        id: 'acc-1',
        name: 'Test Account',
        serverUrl: 'https://test.com',
        username: 'user',
        credentialId: 'cred-1',
      },
    ])
    mockAccountStorage.getAllCalendars.mockReturnValue([
      {
        id: 'cal-1',
        accountId: 'acc-1',
        name: 'Test Calendar',
        url: '/calendars/cal-1',
        color: '#4285F4',
      },
    ])

    const { result } = renderHook(() => useCalDAV())

    expect(result.current.accounts).toHaveLength(1)
    expect(result.current.calendars).toHaveLength(1)
  })

  it('reports pending changes count', () => {
    mockAccountStorage.getPendingChanges.mockReturnValue([
      { type: 'create', eventId: 'evt-1', calendarId: 'cal-1' },
      { type: 'update', eventId: 'evt-2', calendarId: 'cal-1' },
    ])

    const { result } = renderHook(() => useCalDAV())

    expect(result.current.syncState.pendingChanges).toBe(2)
  })

  it('has sync state with idle status initially', () => {
    const { result } = renderHook(() => useCalDAV())

    expect(result.current.syncState.status).toBe('idle')
    expect(result.current.syncState.lastSyncAt).toBeNull()
    expect(result.current.syncState.error).toBeNull()
  })

  it('has empty accounts and calendars initially', () => {
    const { result } = renderHook(() => useCalDAV())

    expect(result.current.accounts).toEqual([])
    expect(result.current.calendars).toEqual([])
  })
})
