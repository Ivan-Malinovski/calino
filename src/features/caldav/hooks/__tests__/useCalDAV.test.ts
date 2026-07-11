import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import type { CalendarEvent } from '@/types'

// ---------------------------------------------------------------------------
// Mock every module that useCalDAV imports from
// ---------------------------------------------------------------------------
vi.mock('../../client/discovery')
vi.mock('../../client/credentials')
vi.mock('../../sync/accountStorage')
vi.mock('../../adapter/iCalendarAdapter')
vi.mock('../../client/CalDAVClient')
vi.mock('../../sync/syncEngine')
vi.mock('@/lib/uuid')

// ---------------------------------------------------------------------------
// Helper: typed access to mocked modules
// ---------------------------------------------------------------------------
import * as discovery from '../../client/discovery'
import * as credentials from '../../client/credentials'
import * as accountStorage from '../../sync/accountStorage'
import * as CalDAVClientModule from '../../client/CalDAVClient'
import * as SyncEngineModule from '../../sync/syncEngine'
import { useCalDAV } from '../useCalDAV'

type MockDiscovery = typeof discovery & {
  discoverServerUrl: ReturnType<typeof vi.fn>
  testConnection: ReturnType<typeof vi.fn>
  probeConnection: ReturnType<typeof vi.fn>
  expandProviderUrl: ReturnType<typeof vi.fn>
}
type MockCredentials = typeof credentials & {
  saveCredentials: ReturnType<typeof vi.fn>
  getCredentialById: ReturnType<typeof vi.fn>
  deleteCredential: ReturnType<typeof vi.fn>
  updateCredential: ReturnType<typeof vi.fn>
}
type MockAccountStorage = typeof accountStorage & {
  getAllAccounts: ReturnType<typeof vi.fn>
  getAllCalendars: ReturnType<typeof vi.fn>
  getPendingChanges: ReturnType<typeof vi.fn>
  saveAccount: ReturnType<typeof vi.fn>
  deleteAccount: ReturnType<typeof vi.fn>
  updateAccount: ReturnType<typeof vi.fn>
  getAccountById: ReturnType<typeof vi.fn>
  getCalendarsByAccountId: ReturnType<typeof vi.fn>
  updateAccountLastSync: ReturnType<typeof vi.fn>
  addPendingChange: ReturnType<typeof vi.fn>
  removePendingChange: ReturnType<typeof vi.fn>
  updatePendingChangeRetry: ReturnType<typeof vi.fn>
  saveCalendar: ReturnType<typeof vi.fn>
  deleteCalendarsByAccountId: ReturnType<typeof vi.fn>
  deleteCalendar: ReturnType<typeof vi.fn>
  updateCalendar: ReturnType<typeof vi.fn>
}
type MockCalDAVClient = typeof CalDAVClientModule & {
  createCalDAVClient: ReturnType<typeof vi.fn>
}
type MockSyncEngine = typeof SyncEngineModule & {
  SyncEngine: ReturnType<typeof vi.fn>
}

const mockDiscovery = discovery as unknown as MockDiscovery
const mockCredentials = credentials as unknown as MockCredentials
const mockAccountStorage = accountStorage as unknown as MockAccountStorage
const mockCalDAVClient = CalDAVClientModule as unknown as MockCalDAVClient
const mockSyncEngine = SyncEngineModule as unknown as MockSyncEngine

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const mockEvent: CalendarEvent = {
  id: 'evt-1',
  calendarId: 'cal-1',
  title: 'Test Event',
  start: '2025-06-01T10:00:00',
  end: '2025-06-01T11:00:00',
  isAllDay: false,
}

const mockAccount = {
  id: 'acc-1',
  name: 'Test Account',
  serverUrl: 'https://caldav.example.com',
  proxyUrl: null,
  username: 'user',
  credentialId: 'cred-1',
  createdAt: '2025-01-01T00:00:00Z',
  lastSyncAt: null,
}

const mockCalendar = {
  id: 'cal-1',
  accountId: 'acc-1',
  url: 'https://caldav.example.com/cal/main/',
  name: 'Main Calendar',
  color: '#4285F4',
  ctag: null,
  syncToken: null,
  isVisible: true,
  isDefault: true,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('useCalDAV', () => {
  // Track sync engine instance mocks so tests can configure pushEvent etc.
  let mockSyncEngineInstance: {
    pushEvent: ReturnType<typeof vi.fn>
    updateEvent: ReturnType<typeof vi.fn>
    deleteEvent: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock returns for store lookups
    mockAccountStorage.getAllAccounts.mockReturnValue([])
    mockAccountStorage.getAllCalendars.mockReturnValue([])
    mockAccountStorage.getPendingChanges.mockReturnValue([])
    mockAccountStorage.getCalendarsByAccountId.mockReturnValue([])
    mockAccountStorage.getAccountById.mockReturnValue(undefined)
    mockAccountStorage.addPendingChange.mockReturnValue(undefined)
    mockAccountStorage.removePendingChange.mockReturnValue(undefined)
    mockAccountStorage.updatePendingChangeRetry.mockReturnValue(undefined)
    mockAccountStorage.updateAccountLastSync.mockReturnValue(undefined)

    // Discovery defaults
    mockDiscovery.discoverServerUrl.mockResolvedValue('https://caldav.example.com')
    mockDiscovery.testConnection.mockResolvedValue(true)
    mockDiscovery.expandProviderUrl.mockReturnValue(null)
    mockDiscovery.probeConnection.mockResolvedValue({
      ok: true,
      status: 207,
      resolvedUrl: 'https://caldav.example.com',
    })
    mockCredentials.saveCredentials.mockReturnValue({
      id: 'cred-1',
      serverUrl: '',
      username: '',
      password: '',
    })
    mockCredentials.getCredentialById.mockReturnValue({
      id: 'cred-1',
      serverUrl: 'https://caldav.example.com',
      username: 'test',
      password: 'test',
    })
    mockCredentials.deleteCredential.mockReturnValue(undefined)

    // Default client (fetchEvents returns empty)
    mockCalDAVClient.createCalDAVClient.mockResolvedValue({
      fetchEvents: vi.fn().mockResolvedValue([]),
      fetchCalendars: vi.fn().mockResolvedValue([]),
      createEvent: vi.fn(),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof CalDAVClientModule.createCalDAVClient>>)

    // SyncEngine instance mock
    mockSyncEngineInstance = {
      pushEvent: vi.fn().mockResolvedValue({ url: 'https://...', etag: 'abc' }),
      updateEvent: vi.fn().mockResolvedValue({ url: 'https://...', etag: 'def' }),
      deleteEvent: vi.fn().mockResolvedValue(undefined),
    }
    mockSyncEngine.SyncEngine.mockImplementation(function () {
      return mockSyncEngineInstance
    })

    // Reset Zustand stores
    const calStore = useCalendarStore.getState()
    calStore.events.forEach((e) => calStore.deleteEvent(e.id))
    calStore.calendars.forEach((c) => calStore.deleteCalendar(c.id))
    calStore.addCalendar({
      id: 'default',
      name: 'Offline calendar',
      color: '#4285F4',
      isVisible: true,
      isDefault: true,
      showTasksInViews: true,
    })

    // Reset settings to defaults
    useSettingsStore.getState().updateSettings({
      caldavDebugMode: false,
      conflictResolution: 'server-wins',
    })
  })

  // -----------------------------------------------------------------------
  // Bug 18: No retry limit on pending changes
  // -----------------------------------------------------------------------
  describe('Bug 18: pending change retry limit', () => {
    it('drops pending changes that have exceeded MAX_RETRIES (10)', async () => {
      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAllCalendars.mockReturnValue([mockCalendar])
      mockAccountStorage.getPendingChanges.mockReturnValue([
        {
          id: 'pc-exhausted',
          type: 'create',
          eventId: 'evt-exhausted',
          calendarId: 'cal-1',
          data: JSON.stringify(mockEvent),
          timestamp: '2025-01-01T00:00:00Z',
          retryCount: 10, // at limit
        },
      ] as any)

      renderHook(() => useCalDAV())

      // Should have been removed without attempting to push
      await waitFor(() => {
        expect(mockAccountStorage.removePendingChange).toHaveBeenCalledWith('pc-exhausted')
      })

      expect(mockSyncEngineInstance.pushEvent).not.toHaveBeenCalled()
    })

    it('drops pending changes that have exceeded MAX_RETRIES (11)', async () => {
      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAllCalendars.mockReturnValue([mockCalendar])
      mockAccountStorage.getPendingChanges.mockReturnValue([
        {
          id: 'pc-over',
          type: 'update',
          eventId: 'evt-over',
          calendarId: 'cal-1',
          data: JSON.stringify(mockEvent),
          timestamp: '2025-01-01T00:00:00Z',
          retryCount: 15, // way over limit
        },
      ] as any)

      renderHook(() => useCalDAV())

      await waitFor(() => {
        expect(mockAccountStorage.removePendingChange).toHaveBeenCalledWith('pc-over')
      })

      expect(mockSyncEngineInstance.updateEvent).not.toHaveBeenCalled()
    })

    it('still processes pending changes below the retry limit', async () => {
      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAllCalendars.mockReturnValue([mockCalendar])
      mockAccountStorage.getPendingChanges.mockReturnValue([
        {
          id: 'pc-ok',
          type: 'create',
          eventId: 'evt-ok',
          calendarId: 'cal-1',
          data: JSON.stringify(mockEvent),
          timestamp: '2025-01-01T00:00:00Z',
          retryCount: 3, // below limit of 10
        },
      ] as any)

      renderHook(() => useCalDAV())

      await waitFor(() => {
        expect(mockSyncEngineInstance.pushEvent).toHaveBeenCalled()
      })

      expect(mockAccountStorage.removePendingChange).toHaveBeenCalledWith('pc-ok')
    })

    it('processes pending changes at retryCount 9 (just below limit)', async () => {
      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAllCalendars.mockReturnValue([mockCalendar])
      mockAccountStorage.getPendingChanges.mockReturnValue([
        {
          id: 'pc-ninth',
          type: 'create',
          eventId: 'evt-ninth',
          calendarId: 'cal-1',
          data: JSON.stringify(mockEvent),
          timestamp: '2025-01-01T00:00:00Z',
          retryCount: 9, // one below limit
        },
      ] as any)

      renderHook(() => useCalDAV())

      await waitFor(() => {
        expect(mockSyncEngineInstance.pushEvent).toHaveBeenCalled()
      })

      expect(mockAccountStorage.removePendingChange).toHaveBeenCalledWith('pc-ninth')
    })

    it('processes a mix of exhausted and valid pending changes', async () => {
      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAllCalendars.mockReturnValue([mockCalendar])
      mockAccountStorage.getPendingChanges.mockReturnValue([
        {
          id: 'pc-exhausted',
          type: 'create',
          eventId: 'evt-exhausted',
          calendarId: 'cal-1',
          data: JSON.stringify(mockEvent),
          timestamp: '2025-01-01T00:00:00Z',
          retryCount: 10,
        },
        {
          id: 'pc-valid',
          type: 'create',
          eventId: 'evt-valid',
          calendarId: 'cal-1',
          data: JSON.stringify(mockEvent),
          timestamp: '2025-01-01T00:00:00Z',
          retryCount: 2,
        },
      ] as any)

      renderHook(() => useCalDAV())

      await waitFor(() => {
        expect(mockSyncEngineInstance.pushEvent).toHaveBeenCalled()
      })

      // The exhausted one was removed, the valid one was processed and removed
      expect(mockAccountStorage.removePendingChange).toHaveBeenCalledWith('pc-exhausted')
      expect(mockAccountStorage.removePendingChange).toHaveBeenCalledWith('pc-valid')
      // Only one push (for the valid one)
      expect(mockSyncEngineInstance.pushEvent).toHaveBeenCalledTimes(1)
    })

    it('does not call updatePendingChangeRetry for exhausted changes', async () => {
      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAllCalendars.mockReturnValue([mockCalendar])
      mockAccountStorage.getPendingChanges.mockReturnValue([
        {
          id: 'pc-exhausted',
          type: 'create',
          eventId: 'evt-exhausted',
          calendarId: 'cal-1',
          data: JSON.stringify(mockEvent),
          timestamp: '2025-01-01T00:00:00Z',
          retryCount: 10,
        },
      ] as any)

      renderHook(() => useCalDAV())

      await waitFor(() => {
        expect(mockAccountStorage.removePendingChange).toHaveBeenCalledWith('pc-exhausted')
      })

      expect(mockAccountStorage.updatePendingChangeRetry).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // Bug 17: deleteEvent uses etag from store
  // -----------------------------------------------------------------------
  describe('Bug 17: deleteEvent uses stored etag', () => {
    beforeEach(() => {
      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAllCalendars.mockReturnValue([mockCalendar])
    })

    it('passes the event etag from the store to deleteEvent', async () => {
      // Add event with etag to the Zustand store
      const eventWithEtag: CalendarEvent = {
        ...mockEvent,
        etag: '"server-etag-abc"',
      }
      act(() => {
        useCalendarStore.getState().addEvent(eventWithEtag)
      })

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      await act(async () => {
        await result.current.deleteEvent('cal-1', 'evt-1')
      })

      expect(mockSyncEngineInstance.deleteEvent).toHaveBeenCalledWith(
        'https://caldav.example.com/cal/main/evt-1.ics',
        '"server-etag-abc"'
      )
    })

    it('falls back to empty string when event has no etag', async () => {
      // Add event without etag
      act(() => {
        useCalendarStore.getState().addEvent(mockEvent)
      })

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      await act(async () => {
        await result.current.deleteEvent('cal-1', 'evt-1')
      })

      expect(mockSyncEngineInstance.deleteEvent).toHaveBeenCalledWith(
        'https://caldav.example.com/cal/main/evt-1.ics',
        ''
      )
    })

    it('falls back to empty string when event is no longer in the store', async () => {
      // Event not added to the store (e.g., optimistic delete removed it)
      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      await act(async () => {
        await result.current.deleteEvent('cal-1', 'evt-gone')
      })

      expect(mockSyncEngineInstance.deleteEvent).toHaveBeenCalledWith(
        'https://caldav.example.com/cal/main/evt-gone.ics',
        ''
      )
    })

    it('passes stored etag when pending change processing triggers a delete', async () => {
      // Add event with etag to the store
      const eventWithEtag: CalendarEvent = {
        ...mockEvent,
        etag: '"pending-etag-xyz"',
      }
      act(() => {
        useCalendarStore.getState().addEvent(eventWithEtag)
      })

      mockAccountStorage.getPendingChanges.mockReturnValue([
        {
          id: 'pc-del',
          type: 'delete',
          eventId: 'evt-1',
          calendarId: 'cal-1',
          timestamp: '2025-01-01T00:00:00Z',
          retryCount: 0,
        },
      ] as any)

      renderHook(() => useCalDAV())

      await waitFor(() => {
        expect(mockSyncEngineInstance.deleteEvent).toHaveBeenCalled()
      })

      // Bug 17: should use the etag from the store, not empty string
      expect(mockSyncEngineInstance.deleteEvent).toHaveBeenCalledWith(
        'https://caldav.example.com/cal/main/evt-1.ics',
        '"pending-etag-xyz"'
      )
    })
  })

  // -----------------------------------------------------------------------
  // createEvent
  // -----------------------------------------------------------------------
  describe('createEvent', () => {
    beforeEach(() => {
      // Set up storage to return a known account + calendar
      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAllCalendars.mockReturnValue([mockCalendar])
    })

    it('pushes event to the server via SyncEngine and records last sync', async () => {
      const { result } = renderHook(() => useCalDAV())
      // Wait for mount effect
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      await act(async () => {
        await result.current.createEvent('cal-1', mockEvent)
      })

      expect(mockSyncEngine.SyncEngine).toHaveBeenCalledWith(
        expect.anything(),
        'cal-1'
      )
      expect(mockSyncEngineInstance.pushEvent).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'evt-1', title: 'Test Event', sequence: 0 })
      )
      expect(mockAccountStorage.updateAccountLastSync).toHaveBeenCalledWith('acc-1')
    })

    it('adds a pending change and re-throws when server push fails', async () => {
      mockSyncEngineInstance.pushEvent.mockRejectedValue(new Error('Network error'))

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      await act(async () => {
        await expect(result.current.createEvent('cal-1', mockEvent)).rejects.toThrow(
          'Network error'
        )
      })

      expect(mockAccountStorage.addPendingChange).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'create',
          eventId: 'evt-1',
          calendarId: 'cal-1',
        })
      )
    })

    it('bumps pendingChanges count in syncState on failure', async () => {
      mockSyncEngineInstance.pushEvent.mockRejectedValue(new Error('Fail'))

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      await act(async () => {
        await expect(result.current.createEvent('cal-1', mockEvent)).rejects.toThrow()
      })

      expect(result.current.syncState.pendingChanges).toBe(1)
    })

    it('gracefully handles missing calendar without throwing', async () => {
      // No calendars or accounts in storage
      mockAccountStorage.getAllAccounts.mockReturnValue([])
      mockAccountStorage.getAllCalendars.mockReturnValue([])

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(0))

      await act(async () => {
        // Should NOT throw
        await result.current.createEvent('non-existent', mockEvent)
      })

      expect(mockSyncEngineInstance.pushEvent).not.toHaveBeenCalled()
      expect(mockAccountStorage.addPendingChange).not.toHaveBeenCalled()
    })

    it('throws "Credentials not found" when credential lookup fails', async () => {
      mockCredentials.getCredentialById.mockReturnValue(undefined)

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      await act(async () => {
        await expect(result.current.createEvent('cal-1', mockEvent)).rejects.toThrow(
          'Credentials not found'
        )
      })
    })

    it('stores serialised event data in the pending change', async () => {
      mockSyncEngineInstance.pushEvent.mockRejectedValue(new Error('Fail'))

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      await act(async () => {
        await expect(result.current.createEvent('cal-1', mockEvent)).rejects.toThrow()
      })

      expect(mockAccountStorage.addPendingChange).toHaveBeenCalledWith(
        expect.objectContaining({
          data: JSON.stringify(mockEvent),
        })
      )
    })
  })

  // -----------------------------------------------------------------------
  // updateEvent
  // -----------------------------------------------------------------------
  describe('updateEvent', () => {
    beforeEach(() => {
      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAllCalendars.mockReturnValue([mockCalendar])
    })

    it('calls SyncEngine.updateEvent with incremented sequence', async () => {
      const eventWithSeq: CalendarEvent = { ...mockEvent, sequence: 2, etag: 'old-etag' }

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      await act(async () => {
        await result.current.updateEvent('cal-1', eventWithSeq)
      })

      expect(mockSyncEngineInstance.updateEvent).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'evt-1', sequence: 3 }),
        'old-etag'
      )
    })

    it('adds a pending change when update fails', async () => {
      mockSyncEngineInstance.updateEvent.mockRejectedValue(new Error('Update failed'))

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      await act(async () => {
        await expect(result.current.updateEvent('cal-1', mockEvent)).rejects.toThrow(
          'Update failed'
        )
      })

      expect(mockAccountStorage.addPendingChange).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'update', eventId: 'evt-1', calendarId: 'cal-1' })
      )
    })

    it('bumps pendingChanges count on update failure', async () => {
      mockSyncEngineInstance.updateEvent.mockRejectedValue(new Error('Fail'))

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      await act(async () => {
        await expect(result.current.updateEvent('cal-1', mockEvent)).rejects.toThrow()
      })

      expect(result.current.syncState.pendingChanges).toBe(1)
    })

    it('gracefully handles missing calendar on update', async () => {
      mockAccountStorage.getAllAccounts.mockReturnValue([])
      mockAccountStorage.getAllCalendars.mockReturnValue([])

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(0))

      await act(async () => {
        await result.current.updateEvent('non-existent', mockEvent)
      })

      expect(mockSyncEngineInstance.updateEvent).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // deleteEvent (direct, not via pending changes)
  // -----------------------------------------------------------------------
  describe('deleteEvent', () => {
    beforeEach(() => {
      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAllCalendars.mockReturnValue([mockCalendar])
    })

    it('calls SyncEngine.deleteEvent with the correct URL and removes from store', async () => {
      // Add event to the Zustand store so we can verify it gets removed
      act(() => {
        useCalendarStore.getState().addEvent(mockEvent)
      })

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      await act(async () => {
        await result.current.deleteEvent('cal-1', 'evt-1')
      })

      expect(mockSyncEngineInstance.deleteEvent).toHaveBeenCalledWith(
        'https://caldav.example.com/cal/main/evt-1.ics',
        ''
      )

      // Verify the event was removed from the store
      const store = useCalendarStore.getState()
      expect(store.events.find((e) => e.id === 'evt-1')).toBeUndefined()
    })

    it('adds a pending change when server delete fails', async () => {
      mockSyncEngineInstance.deleteEvent.mockRejectedValue(new Error('Delete failed'))

      act(() => {
        useCalendarStore.getState().addEvent(mockEvent)
      })

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      await act(async () => {
        await expect(result.current.deleteEvent('cal-1', 'evt-1')).rejects.toThrow('Delete failed')
      })

      expect(mockAccountStorage.addPendingChange).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'delete', eventId: 'evt-1', calendarId: 'cal-1' })
      )
    })

    it('bumps pendingChanges count on delete failure', async () => {
      mockSyncEngineInstance.deleteEvent.mockRejectedValue(new Error('Fail'))

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      await act(async () => {
        await expect(result.current.deleteEvent('cal-1', 'evt-1')).rejects.toThrow()
      })

      expect(result.current.syncState.pendingChanges).toBe(1)
    })

    it('returns early if calendar not found', async () => {
      mockAccountStorage.getAllAccounts.mockReturnValue([])
      mockAccountStorage.getAllCalendars.mockReturnValue([])

      const { result } = renderHook(() => useCalDAV())

      await act(async () => {
        // Should not throw
        await result.current.deleteEvent('non-existent-cal', 'event-1')
      })

      expect(mockSyncEngineInstance.deleteEvent).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // Pending change queue processing
  // -----------------------------------------------------------------------
  describe('pending change queue', () => {
    it('processes pending creates on mount', async () => {
      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAllCalendars.mockReturnValue([mockCalendar])
      mockAccountStorage.getPendingChanges.mockReturnValue([
        {
          id: 'pc-1',
          type: 'create',
          eventId: 'evt-pc',
          calendarId: 'cal-1',
          data: JSON.stringify(mockEvent),
          timestamp: '2025-01-01T00:00:00Z',
          retryCount: 0,
        },
      ] as any)

      renderHook(() => useCalDAV())

      // processPendingChanges runs on mount, should call pushEvent
      await waitFor(() => {
        expect(mockSyncEngineInstance.pushEvent).toHaveBeenCalled()
      })

      // After successful processing, the change is removed
      expect(mockAccountStorage.removePendingChange).toHaveBeenCalledWith('pc-1')
    })

    it('processes pending updates on mount', async () => {
      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAllCalendars.mockReturnValue([mockCalendar])
      mockAccountStorage.getPendingChanges.mockReturnValue([
        {
          id: 'pc-upd',
          type: 'update',
          eventId: 'evt-upd',
          calendarId: 'cal-1',
          data: JSON.stringify(mockEvent),
          timestamp: '2025-01-01T00:00:00Z',
          retryCount: 0,
        },
      ] as any)

      renderHook(() => useCalDAV())

      await waitFor(() => {
        expect(mockSyncEngineInstance.updateEvent).toHaveBeenCalled()
      })

      expect(mockAccountStorage.removePendingChange).toHaveBeenCalledWith('pc-upd')
    })

    it('processes pending deletes on mount', async () => {
      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAllCalendars.mockReturnValue([mockCalendar])
      mockAccountStorage.getPendingChanges.mockReturnValue([
        {
          id: 'pc-del',
          type: 'delete',
          eventId: 'evt-del',
          calendarId: 'cal-1',
          timestamp: '2025-01-01T00:00:00Z',
          retryCount: 0,
        },
      ] as any)

      renderHook(() => useCalDAV())

      await waitFor(() => {
        expect(mockSyncEngineInstance.deleteEvent).toHaveBeenCalled()
      })

      expect(mockAccountStorage.removePendingChange).toHaveBeenCalledWith('pc-del')
    })

    it('removes the event from the store after a successful pending delete', async () => {
      // A failed delete re-adds the event with syncStatus='failed'. When the
      // retry succeeds, processPendingChanges must remove it from the store,
      // otherwise it lingers as a ghost (gone on server, still local).
      act(() => {
        useCalendarStore.getState().addEvent({
          ...mockEvent,
          id: 'evt-del',
          syncStatus: 'failed',
        })
      })
      expect(
        useCalendarStore.getState().events.some((e) => e.id === 'evt-del')
      ).toBe(true)

      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAllCalendars.mockReturnValue([mockCalendar])
      mockAccountStorage.getPendingChanges.mockReturnValue([
        {
          id: 'pc-del',
          type: 'delete',
          eventId: 'evt-del',
          calendarId: 'cal-1',
          timestamp: '2025-01-01T00:00:00Z',
          retryCount: 0,
        },
      ] as any)

      renderHook(() => useCalDAV())

      await waitFor(() => {
        expect(mockSyncEngineInstance.deleteEvent).toHaveBeenCalled()
      })

      await waitFor(() => {
        expect(
          useCalendarStore.getState().events.some((e) => e.id === 'evt-del')
        ).toBe(false)
      })
    })

    it('retries pending changes on 30-second interval', async () => {
      vi.useFakeTimers()

      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAllCalendars.mockReturnValue([mockCalendar])
      mockAccountStorage.getPendingChanges.mockReturnValue([
        {
          id: 'pc-int',
          type: 'create',
          eventId: 'evt-int',
          calendarId: 'cal-1',
          data: JSON.stringify(mockEvent),
          timestamp: '2025-01-01T00:00:00Z',
          retryCount: 0,
        },
      ] as any)

      renderHook(() => useCalDAV())

      // Mount processes pending changes
      await vi.advanceTimersByTimeAsync(100)

      const callsAfterMount = mockSyncEngineInstance.pushEvent.mock.calls.length
      expect(callsAfterMount).toBeGreaterThanOrEqual(1)

      // Advance 30 seconds - should re-process
      const callsBeforeInterval = mockSyncEngineInstance.pushEvent.mock.calls.length
      await vi.advanceTimersByTimeAsync(30000)
      expect(mockSyncEngineInstance.pushEvent.mock.calls.length).toBeGreaterThan(
        callsBeforeInterval
      )

      vi.useRealTimers()
    })

    it('increments retry count when a pending change fails', async () => {
      mockSyncEngineInstance.pushEvent.mockRejectedValue(new Error('Still failing'))

      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAllCalendars.mockReturnValue([mockCalendar])
      mockAccountStorage.getPendingChanges.mockReturnValue([
        {
          id: 'pc-fail',
          type: 'create',
          eventId: 'evt-fail',
          calendarId: 'cal-1',
          data: JSON.stringify(mockEvent),
          timestamp: '2025-01-01T00:00:00Z',
          retryCount: 0,
        },
      ] as any)

      renderHook(() => useCalDAV())

      await waitFor(() => {
        expect(mockAccountStorage.updatePendingChangeRetry).toHaveBeenCalledWith('pc-fail')
      })
    })

    it('handles missing calendar or account for a pending change gracefully', async () => {
      // Only a pending change exists, no accounts/calendars loaded
      mockAccountStorage.getAllAccounts.mockReturnValue([])
      mockAccountStorage.getAllCalendars.mockReturnValue([])
      mockAccountStorage.getPendingChanges.mockReturnValue([
        {
          id: 'pc-orphan',
          type: 'create',
          eventId: 'evt-orphan',
          calendarId: 'cal-missing',
          data: JSON.stringify(mockEvent),
          timestamp: '2025-01-01T00:00:00Z',
          retryCount: 0,
        },
      ] as any)

      renderHook(() => useCalDAV())

      // Should not have called pushEvent since no calendar/account found
      await waitFor(() => {
        expect(mockAccountStorage.updatePendingChangeRetry).toHaveBeenCalled()
      })

      expect(mockSyncEngineInstance.pushEvent).not.toHaveBeenCalled()
    })

    it('cleans the interval on unmount', async () => {
      vi.useFakeTimers()

      mockAccountStorage.getPendingChanges.mockReturnValue([])

      const clearSpy = vi.spyOn(globalThis, 'clearInterval')

      const { unmount } = renderHook(() => useCalDAV())

      unmount()

      expect(clearSpy).toHaveBeenCalled()

      clearSpy.mockRestore()
      vi.useRealTimers()
    })
  })

  // -----------------------------------------------------------------------
  // removeAccount
  // -----------------------------------------------------------------------
  describe('removeAccount', () => {
    it('removes account, credentials, and associated calendars', async () => {
      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAllCalendars.mockReturnValue([mockCalendar])
      mockAccountStorage.getAccountById.mockReturnValue(mockAccount)

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      await act(async () => {
        await result.current.removeAccount('acc-1')
      })

      expect(mockCredentials.deleteCredential).toHaveBeenCalledWith('cred-1')
      expect(mockAccountStorage.deleteCalendarsByAccountId).toHaveBeenCalledWith('acc-1')
      expect(mockAccountStorage.deleteAccount).toHaveBeenCalledWith('acc-1')
    })
  })

  // -----------------------------------------------------------------------
  // addAccount — probes once, and carries the probe's hint on failure
  // -----------------------------------------------------------------------
  describe('addAccount', () => {
    it('saves the credential against the probe-resolved URL', async () => {
      mockDiscovery.probeConnection.mockResolvedValue({
        ok: true,
        status: 207,
        resolvedUrl: 'https://caldav.example.com/dav.php',
      })
      mockAccountStorage.saveAccount.mockReturnValue(mockAccount)

      const { result } = renderHook(() => useCalDAV())

      await act(async () => {
        await result.current.addAccount('https://caldav.example.com', 'user', 'pw', 'Acct')
      })

      // Probed exactly once — no separate pre-flight test.
      expect(mockDiscovery.probeConnection).toHaveBeenCalledTimes(1)
      expect(mockCredentials.saveCredentials).toHaveBeenCalledWith(
        expect.objectContaining({ serverUrl: 'https://caldav.example.com/dav.php' })
      )
    })

    it('throws a CalDAVConnectionError carrying the probe hint', async () => {
      mockDiscovery.probeConnection.mockResolvedValue({
        ok: false,
        status: 401,
        error: 'Server returned status 401',
        hint: 'Needs an app-specific password',
      })

      const { result } = renderHook(() => useCalDAV())

      await act(async () => {
        await expect(
          result.current.addAccount('https://caldav.example.com', 'user', 'bad', 'Acct')
        ).rejects.toThrow('Server returned status 401')
      })

      expect(mockCredentials.saveCredentials).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // updateAccount / testAccount  (issue #24)
  // -----------------------------------------------------------------------
  describe('updateAccount', () => {
    /** Mount the hook with one existing account already loaded. */
    const renderWithAccount = async (): Promise<ReturnType<typeof renderHook<ReturnType<typeof useCalDAV>, unknown>>> => {
      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAllCalendars.mockReturnValue([mockCalendar])
      mockAccountStorage.getAccountById.mockReturnValue(mockAccount)
      mockCredentials.getCredentialById.mockResolvedValue({
        id: 'cred-1',
        serverUrl: 'https://caldav.example.com',
        username: 'user',
        password: 'stored-pw',
      })

      const rendered = renderHook(() => useCalDAV())
      await waitFor(() => expect(rendered.result.current.accounts.length).toBe(1))
      return rendered
    }

    it('persists nothing when the probe fails', async () => {
      mockDiscovery.probeConnection.mockResolvedValue({
        ok: false,
        status: 401,
        error: 'Server returned status 401',
      })
      const { result } = await renderWithAccount()

      await act(async () => {
        await expect(
          result.current.updateAccount('acc-1', {
            name: 'Renamed',
            serverUrl: 'https://caldav.example.com',
            username: 'user',
            password: 'wrong-pw',
          })
        ).rejects.toThrow('Server returned status 401')
      })

      expect(mockCredentials.updateCredential).not.toHaveBeenCalled()
      expect(mockAccountStorage.updateAccount).not.toHaveBeenCalled()
    })

    it('keeps the stored password when the field is left blank', async () => {
      const { result } = await renderWithAccount()

      await act(async () => {
        await result.current.updateAccount('acc-1', {
          name: 'Renamed',
          serverUrl: 'https://caldav.example.com',
          username: 'user',
        })
      })

      // The probe still needs a real password — the stored one.
      expect(mockDiscovery.probeConnection).toHaveBeenCalledWith(
        'https://caldav.example.com',
        'user',
        'stored-pw',
        null,
        'https://caldav.example.com'
      )
      // ...but nothing is re-encrypted.
      expect(mockCredentials.updateCredential).toHaveBeenCalledWith(
        'cred-1',
        expect.objectContaining({ password: undefined })
      )
    })

    it('does not re-fetch calendars for a name-only edit', async () => {
      const { result } = await renderWithAccount()

      await act(async () => {
        await result.current.updateAccount('acc-1', {
          name: 'Renamed',
          serverUrl: 'https://caldav.example.com',
          username: 'user',
        })
      })

      expect(mockAccountStorage.updateAccount).toHaveBeenCalledWith(
        'acc-1',
        expect.objectContaining({ name: 'Renamed' })
      )
      // syncAccount creates a client; a name-only edit must not add calendars.
      expect(mockAccountStorage.saveCalendar).not.toHaveBeenCalled()
    })

    it('reconciles calendars by url when the username changes', async () => {
      const survivor = { ...mockCalendar, id: 'cal-1' }
      const orphan = {
        ...mockCalendar,
        id: 'cal-old',
        url: 'https://caldav.example.com/cal/gone/',
      }
      const fresh = {
        ...mockCalendar,
        id: 'cal-new',
        url: 'https://caldav.example.com/cal/new/',
        name: 'New Calendar',
      }

      const { result } = await renderWithAccount()
      mockAccountStorage.getCalendarsByAccountId.mockReturnValue([survivor, orphan])
      mockCalDAVClient.createCalDAVClient.mockResolvedValue({
        fetchEvents: vi.fn().mockResolvedValue([]),
        fetchCalendars: vi.fn().mockResolvedValue([survivor, fresh]),
        createEvent: vi.fn(),
        updateEvent: vi.fn(),
        deleteEvent: vi.fn(),
      } as unknown as Awaited<ReturnType<typeof CalDAVClientModule.createCalDAVClient>>)

      await act(async () => {
        await result.current.updateAccount('acc-1', {
          name: 'Test Account',
          serverUrl: 'https://caldav.example.com',
          username: 'different-user',
          password: 'pw',
        })
      })

      // The calendar the new principal no longer has is dropped...
      expect(mockAccountStorage.deleteCalendar).toHaveBeenCalledWith('cal-old')
      // ...the new one is added...
      expect(mockAccountStorage.saveCalendar).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'cal-new', accountId: 'acc-1' })
      )
      // ...and the survivor is left alone, so its local color/visibility persist.
      expect(mockAccountStorage.saveCalendar).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: 'cal-1' })
      )
      expect(mockAccountStorage.deleteCalendar).not.toHaveBeenCalledWith('cal-1')
    })
  })

  describe('testAccount', () => {
    it('probes the stored credentials without persisting anything', async () => {
      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAccountById.mockReturnValue(mockAccount)
      mockCredentials.getCredentialById.mockResolvedValue({
        id: 'cred-1',
        serverUrl: 'https://caldav.example.com',
        username: 'user',
        password: 'stored-pw',
      })
      mockDiscovery.probeConnection.mockResolvedValue({ ok: true, status: 207 })

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      let probe: Awaited<ReturnType<typeof result.current.testAccount>> | undefined
      await act(async () => {
        probe = await result.current.testAccount('acc-1')
      })

      expect(probe?.ok).toBe(true)
      expect(mockDiscovery.probeConnection).toHaveBeenCalledWith(
        'https://caldav.example.com',
        'user',
        'stored-pw',
        null
      )
      expect(mockAccountStorage.updateAccount).not.toHaveBeenCalled()
    })

    it('reports a missing account instead of throwing', async () => {
      mockAccountStorage.getAccountById.mockReturnValue(undefined)

      const { result } = renderHook(() => useCalDAV())

      let probe: Awaited<ReturnType<typeof result.current.testAccount>> | undefined
      await act(async () => {
        probe = await result.current.testAccount('nope')
      })

      expect(probe).toEqual({ ok: false, error: 'Account not found' })
    })
  })

  // -----------------------------------------------------------------------
  // syncAccount
  // -----------------------------------------------------------------------
  describe('syncAccount', () => {
    it('skips sync when account is not found in storage', async () => {
      mockAccountStorage.getAccountById.mockReturnValue(undefined)

      const { result } = renderHook(() => useCalDAV())

      await act(async () => {
        await result.current.syncAccount('non-existent')
      })

      // Should return early without creating a client
      expect(mockCalDAVClient.createCalDAVClient).not.toHaveBeenCalled()
    })

    it('sets syncState to error when credentials are missing', async () => {
      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAccountById.mockReturnValue(mockAccount)
      mockCredentials.getCredentialById.mockReturnValue(undefined)

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      await act(async () => {
        await expect(result.current.syncAccount('acc-1')).rejects.toThrow('Credentials not found')
      })

      expect(result.current.syncState.status).toBe('error')
      expect(result.current.syncState.error).toBe('Credentials not found')
    })

    it('discovers new remote calendars and syncs their events', async () => {
      const newCalendar = {
        ...mockCalendar,
        id: 'cal-2',
        url: 'https://caldav.example.com/cal/new/',
        name: 'New Calendar',
        isDefault: false,
        supportedComponents: ['VEVENT'] as const,
      }
      const fetchEvents = vi.fn().mockResolvedValue([])

      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAllCalendars.mockReturnValue([mockCalendar])
      mockAccountStorage.getAccountById.mockReturnValue(mockAccount)
      mockAccountStorage.getCalendarsByAccountId.mockReturnValue([mockCalendar])
      mockCalDAVClient.createCalDAVClient.mockResolvedValue({
        fetchCalendars: vi.fn().mockResolvedValue([mockCalendar, newCalendar]),
        fetchEvents,
        createEvent: vi.fn(),
        updateEvent: vi.fn(),
        deleteEvent: vi.fn(),
      } as unknown as Awaited<ReturnType<typeof CalDAVClientModule.createCalDAVClient>>)

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts).toHaveLength(1))

      await act(async () => {
        await result.current.syncAccount('acc-1')
      })

      expect(mockAccountStorage.saveCalendar).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'cal-2', accountId: 'acc-1' })
      )
      expect(useCalendarStore.getState().calendars).toContainEqual(
        expect.objectContaining({ id: 'cal-2', name: 'New Calendar' })
      )
      expect(fetchEvents).toHaveBeenCalledWith(
        'https://caldav.example.com/cal/new/',
        expect.any(String),
        expect.any(String)
      )
    })

    it('refreshes remote calendar metadata while preserving local preferences', async () => {
      const storedCalendar = {
        ...mockCalendar,
        name: 'Old calendar name',
        color: '#4285F4',
        isVisible: false,
        supportedComponents: ['VEVENT'] as const,
      }
      const serverCalendar = {
        ...storedCalendar,
        name: 'Renamed remotely',
        color: '#FF5722',
        supportedComponents: ['VEVENT', 'VTODO'] as const,
      }

      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAllCalendars.mockReturnValue([storedCalendar])
      mockAccountStorage.getAccountById.mockReturnValue(mockAccount)
      mockAccountStorage.getCalendarsByAccountId.mockReturnValue([storedCalendar])
      mockCalDAVClient.createCalDAVClient.mockResolvedValue({
        fetchCalendars: vi.fn().mockResolvedValue([serverCalendar]),
        fetchEvents: vi.fn().mockResolvedValue([]),
        createEvent: vi.fn(),
        updateEvent: vi.fn(),
        deleteEvent: vi.fn(),
      } as unknown as Awaited<ReturnType<typeof CalDAVClientModule.createCalDAVClient>>)

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(useCalendarStore.getState().calendars).toContainEqual(
        expect.objectContaining({ id: 'cal-1', name: 'Old calendar name' })
      ))

      await act(async () => {
        await result.current.syncAccount('acc-1')
      })

      const updates = {
        name: 'Renamed remotely',
        color: '#FF5722',
        supportedComponents: ['VEVENT', 'VTODO'],
      }
      expect(mockAccountStorage.updateCalendar).toHaveBeenCalledWith('cal-1', updates)
      expect(useCalendarStore.getState().calendars).toContainEqual(
        expect.objectContaining({ ...updates, id: 'cal-1', isVisible: false, isDefault: true })
      )
    })
  })

  // -----------------------------------------------------------------------
  // syncAll
  // -----------------------------------------------------------------------
  describe('syncAll', () => {
    it('syncs all accounts', async () => {
      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAllCalendars.mockReturnValue([])
      mockAccountStorage.getAccountById.mockReturnValue(mockAccount)
      mockAccountStorage.getCalendarsByAccountId.mockReturnValue([])

      const { result } = renderHook(() => useCalDAV())
      // Wait for mount effect
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      await act(async () => {
        await result.current.syncAll()
      })

      expect(mockAccountStorage.updateAccountLastSync).toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // Bug 19: Sync can delete events server didn't return
  // -----------------------------------------------------------------------
  describe('Bug 19: sync must not delete local events based on absence from server', () => {
    beforeEach(() => {
      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAccountById.mockReturnValue(mockAccount)
      mockAccountStorage.getCalendarsByAccountId.mockReturnValue([mockCalendar])
    })

    it('does not delete local events that server did not return', async () => {
      // Add local events to the store
      const localEvent1: CalendarEvent = {
        id: 'local-evt-1',
        calendarId: 'cal-1',
        title: 'Local Event 1',
        start: '2025-06-01T10:00:00',
        end: '2025-06-01T11:00:00',
        isAllDay: false,
      }
      const localEvent2: CalendarEvent = {
        id: 'local-evt-2',
        calendarId: 'cal-1',
        title: 'Local Event 2',
        start: '2025-06-02T10:00:00',
        end: '2025-06-02T11:00:00',
        isAllDay: false,
      }
      act(() => {
        useCalendarStore.getState().addEvent(localEvent1)
        useCalendarStore.getState().addEvent(localEvent2)
      })

      // Server returns only one event (the other was not returned, e.g. due to pagination)
      const serverEvent: CalendarEvent = {
        id: 'server-evt-1',
        calendarId: 'cal-1',
        title: 'Server Event',
        start: '2025-06-03T10:00:00',
        end: '2025-06-03T11:00:00',
        isAllDay: false,
        sequence: 0,
      }

      // Mock parseICALData to return the server event
      const iCalendarAdapter = await import('../../adapter/iCalendarAdapter')
      vi.mocked(iCalendarAdapter.parseICALData).mockReturnValue([serverEvent])

      // Configure fetchEvents to return event data so parseICALData gets called
      mockCalDAVClient.createCalDAVClient.mockResolvedValue({
        fetchEvents: vi.fn().mockResolvedValue([{ url: 'https://...', data: 'ical-data', etag: 'etag1' }]),
        fetchCalendars: vi.fn().mockResolvedValue([]),
      } as any)

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      await act(async () => {
        await result.current.syncAccount('acc-1')
      })

      // Both local events should still exist — sync must NOT delete them
      const store = useCalendarStore.getState()
      expect(store.events.find((e) => e.id === 'local-evt-1')).toBeDefined()
      expect(store.events.find((e) => e.id === 'local-evt-2')).toBeDefined()

      // The server event should have been added
      expect(store.events.find((e) => e.id === 'server-evt-1')).toBeDefined()
    })

    it('still adds events returned by the server', async () => {
      const serverEvent: CalendarEvent = {
        id: 'server-new',
        calendarId: 'cal-1',
        title: 'New from Server',
        start: '2025-06-10T10:00:00',
        end: '2025-06-10T11:00:00',
        isAllDay: false,
        sequence: 0,
      }

      const iCalendarAdapter = await import('../../adapter/iCalendarAdapter')
      vi.mocked(iCalendarAdapter.parseICALData).mockReturnValue([serverEvent])

      mockCalDAVClient.createCalDAVClient.mockResolvedValue({
        fetchEvents: vi.fn().mockResolvedValue([{ url: 'https://...', data: 'ical-data', etag: 'etag1' }]),
        fetchCalendars: vi.fn().mockResolvedValue([]),
      } as any)

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      await act(async () => {
        await result.current.syncAccount('acc-1')
      })

      const store = useCalendarStore.getState()
      expect(store.events.find((e) => e.id === 'server-new')).toBeDefined()
    })
  })

  // -----------------------------------------------------------------------
  // Issue 22: Duplicate UIDs across independent resources corrupt the store
  //
  // Radicale enforces UID uniqueness (rejects the second PUT), so this data
  // can only originate from a lenient server (Baikal/sabre-dav). We replay
  // exactly what such a server returns: two resources with distinct hrefs
  // whose events share one UID.
  // -----------------------------------------------------------------------
  describe('Issue 22: duplicate UID across independent resources', () => {
    beforeEach(() => {
      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAccountById.mockReturnValue(mockAccount)
      mockAccountStorage.getCalendarsByAccountId.mockReturnValue([mockCalendar])
    })

    const eventA: CalendarEvent = {
      id: 'collision-test-0001',
      calendarId: 'cal-1',
      title: 'Event A',
      start: '2024-04-02',
      end: '2024-04-03',
      isAllDay: true,
      rruleString: 'FREQ=YEARLY',
    }
    const eventB: CalendarEvent = {
      id: 'collision-test-0001',
      calendarId: 'cal-1',
      title: 'Event B',
      start: '2024-09-15',
      end: '2024-09-16',
      isAllDay: true,
      rruleString: 'FREQ=YEARLY',
    }

    const wireCollidingServer = async (): Promise<void> => {
      const iCalendarAdapter = await import('../../adapter/iCalendarAdapter')
      // parseICALData returns the event matching each resource's raw data.
      vi.mocked(iCalendarAdapter.parseICALData).mockImplementation((data: string) =>
        data === 'DATA_A' ? [eventA] : [eventB]
      )
      mockCalDAVClient.createCalDAVClient.mockResolvedValue({
        fetchEvents: vi.fn().mockResolvedValue([
          { url: 'https://caldav.example.com/cal/main/event-a.ics', data: 'DATA_A', etag: 'e1' },
          { url: 'https://caldav.example.com/cal/main/event-b.ics', data: 'DATA_B', etag: 'e2' },
        ]),
        fetchCalendars: vi.fn().mockResolvedValue([]),
      } as any)
    }

    it('keeps exactly one event and records a data issue instead of overwriting', async () => {
      await wireCollidingServer()

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      await act(async () => {
        await result.current.syncAccount('acc-1')
      })

      const store = useCalendarStore.getState()
      // Only one event survives (not collapsed unstably, not duplicated).
      const collided = store.events.filter((e) => e.id === 'collision-test-0001')
      expect(collided).toHaveLength(1)
      // Deterministic keep: event-a.ics sorts before event-b.ics.
      expect(collided[0].title).toBe('Event A')

      // The collision is surfaced as a data issue listing both resources.
      expect(store.duplicateUidIssues).toHaveLength(1)
      const issue = store.duplicateUidIssues[0]
      expect(issue.uid).toBe('collision-test-0001')
      expect(issue.resources).toHaveLength(2)
      expect(issue.resources.find((r) => r.kept)?.title).toBe('Event A')
      expect(issue.resources.find((r) => !r.kept)?.title).toBe('Event B')
    })

    it('stays stable across repeated syncs (no flip-flop, no duplicate issues)', async () => {
      await wireCollidingServer()

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      await act(async () => {
        await result.current.syncAccount('acc-1')
      })
      await act(async () => {
        await result.current.syncAccount('acc-1')
      })

      const store = useCalendarStore.getState()
      const collided = store.events.filter((e) => e.id === 'collision-test-0001')
      expect(collided).toHaveLength(1)
      expect(collided[0].title).toBe('Event A')
      // Issues are re-derived each sync, so no accumulation.
      expect(store.duplicateUidIssues).toHaveLength(1)
    })
  })

  // -----------------------------------------------------------------------
  // Bug 22: Ask conflict resolution silently overwrites
  // -----------------------------------------------------------------------
  describe('Bug 22: ask conflict resolution should not auto-update', () => {
    beforeEach(() => {
      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAccountById.mockReturnValue(mockAccount)
      mockAccountStorage.getCalendarsByAccountId.mockReturnValue([mockCalendar])

      // Set conflict resolution to 'ask'
      useSettingsStore.getState().updateSettings({
        conflictResolution: 'ask',
      })
    })

    it('does not overwrite local event when server has higher sequence', async () => {
      // Local event with lower sequence
      const localEvent: CalendarEvent = {
        id: 'evt-conflict',
        calendarId: 'cal-1',
        title: 'Local Title',
        start: '2025-06-01T10:00:00',
        end: '2025-06-01T11:00:00',
        isAllDay: false,
        sequence: 1,
      }
      act(() => {
        useCalendarStore.getState().addEvent(localEvent)
      })

      // Server event with higher sequence
      const serverEvent: CalendarEvent = {
        id: 'evt-conflict',
        calendarId: 'cal-1',
        title: 'Server Title',
        start: '2025-06-01T10:00:00',
        end: '2025-06-01T11:00:00',
        isAllDay: false,
        sequence: 3,
      }

      const iCalendarAdapter = await import('../../adapter/iCalendarAdapter')
      vi.mocked(iCalendarAdapter.parseICALData).mockReturnValue([serverEvent])

      mockCalDAVClient.createCalDAVClient.mockResolvedValue({
        fetchEvents: vi.fn().mockResolvedValue([{ url: 'https://...', data: 'ical-data', etag: 'etag1' }]),
        fetchCalendars: vi.fn().mockResolvedValue([]),
      } as any)

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      await act(async () => {
        await result.current.syncAccount('acc-1')
      })

      // Local event should NOT be overwritten
      const store = useCalendarStore.getState()
      const evt = store.events.find((e) => e.id === 'evt-conflict')
      expect(evt?.title).toBe('Local Title')
      expect(evt?.sequence).toBe(1)
    })

    it('does not overwrite local event when local has higher sequence', async () => {
      const localEvent: CalendarEvent = {
        id: 'evt-conflict-2',
        calendarId: 'cal-1',
        title: 'Local Title 2',
        start: '2025-06-01T10:00:00',
        end: '2025-06-01T11:00:00',
        isAllDay: false,
        sequence: 5,
      }
      act(() => {
        useCalendarStore.getState().addEvent(localEvent)
      })

      const serverEvent: CalendarEvent = {
        id: 'evt-conflict-2',
        calendarId: 'cal-1',
        title: 'Server Title 2',
        start: '2025-06-01T10:00:00',
        end: '2025-06-01T11:00:00',
        isAllDay: false,
        sequence: 2,
      }

      const iCalendarAdapter = await import('../../adapter/iCalendarAdapter')
      vi.mocked(iCalendarAdapter.parseICALData).mockReturnValue([serverEvent])

      mockCalDAVClient.createCalDAVClient.mockResolvedValue({
        fetchEvents: vi.fn().mockResolvedValue([{ url: 'https://...', data: 'ical-data', etag: 'etag1' }]),
        fetchCalendars: vi.fn().mockResolvedValue([]),
      } as any)

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      await act(async () => {
        await result.current.syncAccount('acc-1')
      })

      const store = useCalendarStore.getState()
      const evt = store.events.find((e) => e.id === 'evt-conflict-2')
      expect(evt?.title).toBe('Local Title 2')
      expect(evt?.sequence).toBe(5)
    })

    it('stores conflict info in syncState for UI display', async () => {
      const localEvent: CalendarEvent = {
        id: 'evt-cf',
        calendarId: 'cal-1',
        title: 'Conflict Me',
        start: '2025-06-01T10:00:00',
        end: '2025-06-01T11:00:00',
        isAllDay: false,
        sequence: 1,
      }
      act(() => {
        useCalendarStore.getState().addEvent(localEvent)
      })

      const serverEvent: CalendarEvent = {
        id: 'evt-cf',
        calendarId: 'cal-1',
        title: 'Server Version',
        start: '2025-06-01T10:00:00',
        end: '2025-06-01T11:00:00',
        isAllDay: false,
        sequence: 3,
      }

      const iCalendarAdapter = await import('../../adapter/iCalendarAdapter')
      vi.mocked(iCalendarAdapter.parseICALData).mockReturnValue([serverEvent])

      mockCalDAVClient.createCalDAVClient.mockResolvedValue({
        fetchEvents: vi.fn().mockResolvedValue([{ url: 'https://...', data: 'ical-data', etag: 'etag1' }]),
        fetchCalendars: vi.fn().mockResolvedValue([]),
      } as any)

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      await act(async () => {
        await result.current.syncAccount('acc-1')
      })

      // Should have a conflict entry in syncState
      expect(result.current.syncState.conflicts).toHaveLength(1)
      expect(result.current.syncState.conflicts[0].eventId).toBe('evt-cf')
      expect(result.current.syncState.conflicts[0].resolution).toBe('ask')
      expect(result.current.syncState.conflicts[0].localVersion).toBeDefined()
      expect(result.current.syncState.conflicts[0].serverVersion).toBeDefined()
    })

    it('still adds new server events when conflict resolution is ask', async () => {
      const serverEvent: CalendarEvent = {
        id: 'evt-new',
        calendarId: 'cal-1',
        title: 'New Event',
        start: '2025-06-10T10:00:00',
        end: '2025-06-10T11:00:00',
        isAllDay: false,
        sequence: 0,
      }

      const iCalendarAdapter = await import('../../adapter/iCalendarAdapter')
      vi.mocked(iCalendarAdapter.parseICALData).mockReturnValue([serverEvent])

      mockCalDAVClient.createCalDAVClient.mockResolvedValue({
        fetchEvents: vi.fn().mockResolvedValue([{ url: 'https://...', data: 'ical-data', etag: 'etag1' }]),
        fetchCalendars: vi.fn().mockResolvedValue([]),
      } as any)

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      await act(async () => {
        await result.current.syncAccount('acc-1')
      })

      const store = useCalendarStore.getState()
      expect(store.events.find((e) => e.id === 'evt-new')).toBeDefined()
    })

    it('does not create conflict when sequences are equal (no real conflict)', async () => {
      const localEvent: CalendarEvent = {
        id: 'evt-same',
        calendarId: 'cal-1',
        title: 'Same Version',
        start: '2025-06-01T10:00:00',
        end: '2025-06-01T11:00:00',
        isAllDay: false,
        sequence: 2,
      }
      act(() => {
        useCalendarStore.getState().addEvent(localEvent)
      })

      const serverEvent: CalendarEvent = {
        id: 'evt-same',
        calendarId: 'cal-1',
        title: 'Updated from Server',
        start: '2025-06-01T10:00:00',
        end: '2025-06-01T11:00:00',
        isAllDay: false,
        sequence: 2,
      }

      const iCalendarAdapter = await import('../../adapter/iCalendarAdapter')
      vi.mocked(iCalendarAdapter.parseICALData).mockReturnValue([serverEvent])

      mockCalDAVClient.createCalDAVClient.mockResolvedValue({
        fetchEvents: vi.fn().mockResolvedValue([{ url: 'https://...', data: 'ical-data', etag: 'etag1' }]),
        fetchCalendars: vi.fn().mockResolvedValue([]),
      } as any)

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      await act(async () => {
        await result.current.syncAccount('acc-1')
      })

      // No conflict — same sequence means safe to update
      expect(result.current.syncState.conflicts).toHaveLength(0)

      // Event should be updated
      const store = useCalendarStore.getState()
      const evt = store.events.find((e) => e.id === 'evt-same')
      expect(evt?.title).toBe('Updated from Server')
    })
  })

  // -----------------------------------------------------------------------
  // Bug 23: Concurrent processPendingChanges
  // -----------------------------------------------------------------------
  describe('Bug 23: concurrent processPendingChanges prevention', () => {
    it('does not run processPendingChanges concurrently', async () => {
      vi.useFakeTimers()

      let resolveFirst: () => void
      const firstCall = new Promise<void>((resolve) => {
        resolveFirst = resolve
      })

      // Make pushEvent block until we resolve it
      mockSyncEngineInstance.pushEvent.mockImplementation(() => firstCall)

      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAllCalendars.mockReturnValue([mockCalendar])
      mockAccountStorage.getPendingChanges.mockReturnValue([
        {
          id: 'pc-1',
          type: 'create',
          eventId: 'evt-1',
          calendarId: 'cal-1',
          data: JSON.stringify(mockEvent),
          timestamp: '2025-01-01T00:00:00Z',
          retryCount: 0,
        },
      ] as any)

      renderHook(() => useCalDAV())

      // Wait for mount effect to start processing
      await vi.advanceTimersByTimeAsync(100)

      // The first call should be in progress
      expect(mockSyncEngineInstance.pushEvent).toHaveBeenCalledTimes(1)

      // Fire the interval while first call is still running
      await vi.advanceTimersByTimeAsync(30000)

      // Should NOT have started a second call
      expect(mockSyncEngineInstance.pushEvent).toHaveBeenCalledTimes(1)

      // Resolve the first call
      resolveFirst!()
      await vi.advanceTimersByTimeAsync(100)

      vi.useRealTimers()
    })

    it('allows next call after previous completes', async () => {
      vi.useFakeTimers()

      mockSyncEngineInstance.pushEvent.mockResolvedValue({ url: 'https://...', etag: 'abc' })

      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAllCalendars.mockReturnValue([mockCalendar])
      mockAccountStorage.getPendingChanges.mockReturnValue([
        {
          id: 'pc-2',
          type: 'create',
          eventId: 'evt-2',
          calendarId: 'cal-1',
          data: JSON.stringify(mockEvent),
          timestamp: '2025-01-01T00:00:00Z',
          retryCount: 0,
        },
      ] as any)

      renderHook(() => useCalDAV())

      // Mount processes pending changes
      await vi.advanceTimersByTimeAsync(100)

      const firstCount = mockSyncEngineInstance.pushEvent.mock.calls.length
      expect(firstCount).toBeGreaterThanOrEqual(1)

      // After first call completes, the next interval should be able to run
      await vi.advanceTimersByTimeAsync(30000)
      expect(mockSyncEngineInstance.pushEvent.mock.calls.length).toBeGreaterThan(firstCount)

      vi.useRealTimers()
    })
  })

  // -----------------------------------------------------------------------
  // Bug 29: Sequence increments unconditionally
  // -----------------------------------------------------------------------
  describe('Bug 29: sequence only increments when data changed', () => {
    beforeEach(() => {
      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAllCalendars.mockReturnValue([mockCalendar])
    })

    it('does not increment sequence when event data is identical', async () => {
      // Add an existing event to the store with the same data
      const existingEvent: CalendarEvent = {
        ...mockEvent,
        sequence: 5,
        etag: 'old-etag',
      }
      act(() => {
        useCalendarStore.getState().addEvent(existingEvent)
      })

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      // Update with identical data (same sequence)
      const sameEvent: CalendarEvent = {
        ...mockEvent,
        sequence: 5,
        etag: 'old-etag',
      }

      await act(async () => {
        await result.current.updateEvent('cal-1', sameEvent)
      })

      // Sequence should NOT have been incremented
      expect(mockSyncEngineInstance.updateEvent).toHaveBeenCalledWith(
        expect.objectContaining({ sequence: 5 }),
        'old-etag'
      )
    })

    it('increments sequence when event title changes', async () => {
      const existingEvent: CalendarEvent = {
        ...mockEvent,
        sequence: 3,
        etag: 'etag-3',
      }
      act(() => {
        useCalendarStore.getState().addEvent(existingEvent)
      })

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      const updatedEvent: CalendarEvent = {
        ...mockEvent,
        title: 'Updated Title',
        sequence: 3,
        etag: 'etag-3',
      }

      await act(async () => {
        await result.current.updateEvent('cal-1', updatedEvent)
      })

      // Sequence should have been incremented
      expect(mockSyncEngineInstance.updateEvent).toHaveBeenCalledWith(
        expect.objectContaining({ sequence: 4 }),
        'etag-3'
      )
    })

    it('increments sequence when event start time changes', async () => {
      const existingEvent: CalendarEvent = {
        ...mockEvent,
        sequence: 0,
        etag: 'etag-0',
      }
      act(() => {
        useCalendarStore.getState().addEvent(existingEvent)
      })

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      const updatedEvent: CalendarEvent = {
        ...mockEvent,
        start: '2025-06-01T12:00:00',
        end: '2025-06-01T13:00:00',
        sequence: 0,
        etag: 'etag-0',
      }

      await act(async () => {
        await result.current.updateEvent('cal-1', updatedEvent)
      })

      expect(mockSyncEngineInstance.updateEvent).toHaveBeenCalledWith(
        expect.objectContaining({ sequence: 1 }),
        'etag-0'
      )
    })

    it('increments sequence when categories change', async () => {
      const existingEvent: CalendarEvent = {
        ...mockEvent,
        categories: ['work'],
        sequence: 2,
        etag: 'etag-2',
      }
      act(() => {
        useCalendarStore.getState().addEvent(existingEvent)
      })

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      const updatedEvent: CalendarEvent = {
        ...mockEvent,
        categories: ['work', 'important'],
        sequence: 2,
        etag: 'etag-2',
      }

      await act(async () => {
        await result.current.updateEvent('cal-1', updatedEvent)
      })

      expect(mockSyncEngineInstance.updateEvent).toHaveBeenCalledWith(
        expect.objectContaining({ sequence: 3 }),
        'etag-2'
      )
    })

    it('increments sequence when event has no existing store entry', async () => {
      // No event in the store (new event being synced)
      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      const newEvent: CalendarEvent = {
        ...mockEvent,
        sequence: 0,
        etag: 'new-etag',
      }

      await act(async () => {
        await result.current.updateEvent('cal-1', newEvent)
      })

      // Should increment since no existing event means it's new
      expect(mockSyncEngineInstance.updateEvent).toHaveBeenCalledWith(
        expect.objectContaining({ sequence: 1 }),
        'new-etag'
      )
    })
  })

  // -----------------------------------------------------------------------
  // Bug 31: Category UUID filtering
  // -----------------------------------------------------------------------
  describe('Bug 31: categories are not filtered by UUID pattern', () => {
    beforeEach(() => {
      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAccountById.mockReturnValue(mockAccount)
      mockAccountStorage.getCalendarsByAccountId.mockReturnValue([mockCalendar])
    })

    it('does not filter categories that look like UUIDs during sync', async () => {
      const serverEvent: CalendarEvent = {
        id: 'evt-uuid-cats',
        calendarId: 'cal-1',
        title: 'UUID Category Event',
        start: '2025-06-10T10:00:00',
        end: '2025-06-10T11:00:00',
        isAllDay: false,
        sequence: 0,
        categories: ['550e8400-e29b-41d4-a716-446655440000', 'normal-category'],
      }

      const iCalendarAdapter = await import('../../adapter/iCalendarAdapter')
      const uuidMod = await import('@/lib/uuid')
      vi.mocked(iCalendarAdapter.parseICALData).mockReturnValue([serverEvent])
      vi.mocked(uuidMod.isUUID).mockReturnValue(true)

      mockCalDAVClient.createCalDAVClient.mockResolvedValue({
        fetchEvents: vi.fn().mockResolvedValue([
          { url: 'https://...', data: 'ical-data', etag: 'etag1' },
        ]),
        fetchCalendars: vi.fn().mockResolvedValue([]),
      } as any)

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      await act(async () => {
        await result.current.syncAccount('acc-1')
      })

      // The event should have BOTH categories, not filtered
      const store = useCalendarStore.getState()
      const evt = store.events.find((e) => e.id === 'evt-uuid-cats')
      expect(evt).toBeDefined()
      expect(evt?.categories).toContain('550e8400-e29b-41d4-a716-446655440000')
      expect(evt?.categories).toContain('normal-category')
    })

    it('does not filter UUID-looking categories during addAccount', async () => {
      const iCalendarAdapter = await import('../../adapter/iCalendarAdapter')
      const uuidMod = await import('@/lib/uuid')
      vi.mocked(iCalendarAdapter.parseICALData).mockReturnValue([])
      vi.mocked(uuidMod.isUUID).mockReturnValue(true)

      // Mock saveAccount to return an object with an id
      mockAccountStorage.saveAccount.mockReturnValue({
        id: 'new-acc',
        name: 'Test Account',
        serverUrl: 'https://caldav.example.com',
        proxyUrl: null,
        username: 'user',
        credentialId: 'cred-1',
      })
      // Set up initial accounts so hook mount finds them
      mockAccountStorage.getAllAccounts.mockReturnValue([mockAccount])
      mockAccountStorage.getAllCalendars.mockReturnValue([mockCalendar])

      mockCalDAVClient.createCalDAVClient.mockResolvedValue({
        fetchEvents: vi.fn().mockResolvedValue([
          {
            url: 'https://...',
            data: 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:test\r\nSUMMARY:Test\r\nDTSTART:20250615T100000Z\r\nDTEND:20250615T110000Z\r\nCATEGORIES:550e8400-e29b-41d4-a716-446655440000,my-tag\r\nEND:VEVENT\r\nEND:VCALENDAR',
            etag: 'etag1',
          },
        ]),
        fetchCalendars: vi.fn().mockResolvedValue([
          {
            id: 'cal-1',
            url: 'https://caldav.example.com/cal/',
            name: 'Test',
            color: '#4285F4',
            isVisible: true,
            isDefault: true,
          },
        ]),
      } as any)

      // The parsed event should include UUID categories
      vi.mocked(iCalendarAdapter.parseICALData).mockReturnValue([
        {
          id: 'evt-cats',
          calendarId: 'cal-1',
          title: 'Test',
          start: '2025-06-15T10:00:00',
          end: '2025-06-15T11:00:00',
          isAllDay: false,
          categories: ['550e8400-e29b-41d4-a716-446655440000', 'my-tag'],
        },
      ])

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBeGreaterThanOrEqual(1))

      await act(async () => {
        await result.current.addAccount(
          'https://caldav.example.com',
          'user',
          'pass',
          'Test Account'
        )
      })

      // UUID category should have been auto-created, not filtered
      const store = useCalendarStore.getState()
      const uuidCat = store.categories.find(
        (c) => c.name === '550e8400-e29b-41d4-a716-446655440000'
      )
      expect(uuidCat).toBeDefined()

      const normalCat = store.categories.find((c) => c.name === 'my-tag')
      expect(normalCat).toBeDefined()
    })

    it('still auto-creates non-UUID categories from server', async () => {
      const serverEvent: CalendarEvent = {
        id: 'evt-normal-cats',
        calendarId: 'cal-1',
        title: 'Normal Category Event',
        start: '2025-06-10T10:00:00',
        end: '2025-06-10T11:00:00',
        isAllDay: false,
        sequence: 0,
        categories: ['work', 'important'],
      }

      const iCalendarAdapter = await import('../../adapter/iCalendarAdapter')
      const uuidMod = await import('@/lib/uuid')
      vi.mocked(iCalendarAdapter.parseICALData).mockReturnValue([serverEvent])
      vi.mocked(uuidMod.isUUID).mockReturnValue(false)

      mockCalDAVClient.createCalDAVClient.mockResolvedValue({
        fetchEvents: vi.fn().mockResolvedValue([
          { url: 'https://...', data: 'ical-data', etag: 'etag1' },
        ]),
        fetchCalendars: vi.fn().mockResolvedValue([]),
      } as any)

      const { result } = renderHook(() => useCalDAV())
      await waitFor(() => expect(result.current.accounts.length).toBe(1))

      await act(async () => {
        await result.current.syncAccount('acc-1')
      })

      const store = useCalendarStore.getState()
      expect(store.categories.find((c) => c.name === 'work')).toBeDefined()
      expect(store.categories.find((c) => c.name === 'important')).toBeDefined()
    })
  })
})
