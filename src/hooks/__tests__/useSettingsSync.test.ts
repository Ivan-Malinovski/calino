import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createLocalStorageMock } from '@/test/storageMock'
import { useSettingsSync } from '../useSettingsSync'
import { useSettingsStore } from '@/store/settingsStore'
import {
  getPrimaryAccountId,
  getEtag,
  setPrimaryAccountId,
  clearSyncKeys,
  getLastSyncedAt,
} from '@/lib/settingsSync'
import * as accountStorage from '@/features/caldav/sync/accountStorage'
import { getCredentialById } from '@/features/caldav/client/credentials'
import { createCalDAVClient } from '@/features/caldav/client/CalDAVClient'

// Mock sonner so push()/discoverSettings() toast calls can be asserted
// directly instead of only inferring behavior from side effects.
// `vi.mock` factories are hoisted above imports, so the mock must be
// created via `vi.hoisted` rather than a plain top-level const.
const { mockToast } = vi.hoisted(() => ({ mockToast: Object.assign(vi.fn(), { error: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: mockToast }))

// In-memory localStorage
const storage = createLocalStorageMock()

// Mock CalDAV client methods
const mockFetchSettingsEvent = vi.fn()
const mockExtractSettingsFromVEVENT = vi.fn()
const mockPutSettingsEvent = vi.fn()
const mockDeleteSettingsEvent = vi.fn()
const mockDeleteSettingsCalendar = vi.fn()
const mockDiscoverSettingsCalendar = vi.fn()
const mockCreateSettingsCalendar = vi.fn()

const mockClient = {
  fetchSettingsEvent: mockFetchSettingsEvent,
  extractSettingsFromVEVENT: mockExtractSettingsFromVEVENT,
  putSettingsEvent: mockPutSettingsEvent,
  deleteSettingsEvent: mockDeleteSettingsEvent,
  deleteSettingsCalendar: mockDeleteSettingsCalendar,
  discoverSettingsCalendar: mockDiscoverSettingsCalendar,
  createSettingsCalendar: mockCreateSettingsCalendar,
  fetchCalendars: vi.fn().mockResolvedValue([]),
} as const

vi.mock('@/features/caldav/client/CalDAVClient', () => ({
  createCalDAVClient: vi.fn(),
}))
vi.mock('@/features/caldav/client/credentials', () => ({
  getCredentialById: vi.fn(),
}))
vi.mock('@/features/caldav/sync/accountStorage', () => ({
  getAllAccounts: vi.fn(),
  getAccountById: vi.fn(),
  getCalendarsByAccountId: vi.fn(),
}))

describe('useSettingsSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storage.install()
    useSettingsStore.getState().resetSettings()
    vi.mocked(createCalDAVClient).mockResolvedValue(
      mockClient as unknown as Awaited<ReturnType<typeof createCalDAVClient>>
    )
    vi.mocked(getCredentialById).mockResolvedValue({
      id: 'cred-1',
      serverUrl: 'https://example.com',
      username: 'user',
      password: 'pass',
    })
    vi.mocked(accountStorage.getAccountById).mockReturnValue({
      id: 'account-1',
      name: 'Test',
      serverUrl: 'https://example.com',
      proxyUrl: null,
      username: 'user',
      credentialId: 'cred-1',
      createdAt: '2025-01-01T00:00:00Z',
      lastSyncAt: null,
    })
    vi.mocked(accountStorage.getCalendarsByAccountId).mockReturnValue([
      {
        id: 'cal-1',
        url: 'https://example.com/dav.php/calendars/user/cal/',
        name: 'Cal',
        color: '#4285F4',
        ctag: null,
        syncToken: null,
        isVisible: true,
        isDefault: true,
      },
    ])
    vi.mocked(accountStorage.getAllAccounts).mockReturnValue([])
  })

  afterEach(() => {
    clearSyncKeys()
    storage.reset()
  })

  describe('initial state', () => {
    it('should be disabled when no primary account', () => {
      const { result } = renderHook(() => useSettingsSync())
      expect(result.current.enabled).toBe(false)
      expect(result.current.syncing).toBe(false)
      expect(result.current.error).toBeNull()
    })

    it('should be enabled when primary account is set', () => {
      setPrimaryAccountId('account-1')
      const { result } = renderHook(() => useSettingsSync())
      expect(result.current.enabled).toBe(true)
    })
  })

  describe('disable', () => {
    it('should clear primaryAccountId without deleting remote', async () => {
      setPrimaryAccountId('account-1')
      const { result } = renderHook(() => useSettingsSync())
      await act(async () => {
        await result.current.disable(false)
      })
      expect(result.current.enabled).toBe(false)
      expect(mockDeleteSettingsCalendar).not.toHaveBeenCalled()
    })

    it('should delete remote calendar when requested', async () => {
      setPrimaryAccountId('account-1')
      mockDiscoverSettingsCalendar.mockResolvedValue({
        url: 'https://example.com/dav.php/calendars/user/calino-settings/',
      })
      mockDeleteSettingsCalendar.mockResolvedValue(undefined)
      const { result } = renderHook(() => useSettingsSync())
      await act(async () => {
        await result.current.disable(true)
      })
      expect(result.current.enabled).toBe(false)
      expect(mockDeleteSettingsCalendar).toHaveBeenCalled()
    })
  })

  describe('enable', () => {
    it('should create settings calendar and enable sync', async () => {
      mockDiscoverSettingsCalendar.mockResolvedValue(null)
      mockCreateSettingsCalendar.mockResolvedValue(
        'https://example.com/dav.php/calendars/user/calino-settings/'
      )
      mockFetchSettingsEvent.mockResolvedValue(null)
      mockPutSettingsEvent.mockResolvedValue('"etag-1"')

      const { result } = renderHook(() => useSettingsSync())
      await act(async () => {
        await result.current.enable('account-1')
      })

      expect(mockCreateSettingsCalendar).toHaveBeenCalled()
      expect(result.current.enabled).toBe(true)
      expect(getPrimaryAccountId()).toBe('account-1')
    })

    it('should reuse existing settings calendar', async () => {
      mockDiscoverSettingsCalendar.mockResolvedValue({
        url: 'https://example.com/dav.php/calendars/user/calino-settings/',
      })
      mockFetchSettingsEvent.mockResolvedValue(null)
      mockPutSettingsEvent.mockResolvedValue('"etag-1"')

      const { result } = renderHook(() => useSettingsSync())
      await act(async () => {
        await result.current.enable('account-1')
      })

      expect(mockCreateSettingsCalendar).not.toHaveBeenCalled()
      expect(result.current.enabled).toBe(true)
    })

    it('should throw and clear keys on failure', async () => {
      vi.mocked(accountStorage.getAccountById).mockReturnValue(undefined)
      const { result } = renderHook(() => useSettingsSync())
      await act(async () => {
        try {
          await result.current.enable('nonexistent')
        } catch {
          /* expected */
        }
      })
      expect(result.current.enabled).toBe(false)
      expect(getPrimaryAccountId()).toBeNull()
    })
  })

  describe('push', () => {
    it('should serialize and push settings', async () => {
      setPrimaryAccountId('account-1')
      mockDiscoverSettingsCalendar.mockResolvedValue({
        url: 'https://example.com/dav.php/calendars/user/calino-settings/',
      })
      mockFetchSettingsEvent.mockResolvedValue(null)
      mockPutSettingsEvent.mockResolvedValue('"new-etag"')

      const { result } = renderHook(() => useSettingsSync())
      await act(async () => {
        await result.current.push()
      })

      expect(mockPutSettingsEvent).toHaveBeenCalled()
      expect(getEtag()).toBe('"new-etag"')
      // Asserted on the message only: this now routes through the shared
      // showToast in lib/toast, which always passes an options object.
      expect(mockToast.mock.calls[0][0]).toBe('Settings saved to server.')
      expect(mockToast.error).not.toHaveBeenCalled()
    })

    // Regression for issue #52's silent-failure symptom: a push failure
    // previously only set internal `error` state, visible solely in the
    // settings panel's inline text — invisible if the user isn't looking
    // right at it. Push failures must now also surface as a toast.
    it('should surface an error toast when the settings calendar cannot be resolved', async () => {
      setPrimaryAccountId('account-1')
      mockDiscoverSettingsCalendar.mockResolvedValue(null)

      const { result } = renderHook(() => useSettingsSync())
      await act(async () => {
        await result.current.push()
      })

      expect(mockPutSettingsEvent).not.toHaveBeenCalled()
      expect(result.current.error).toBe('Settings calendar not found')
      expect(mockToast.error).toHaveBeenCalledTimes(1)
      expect(mockToast.error.mock.calls[0][0]).toContain('Settings sync failed')
    })

    it('should surface an error toast when putSettingsEvent throws', async () => {
      setPrimaryAccountId('account-1')
      mockDiscoverSettingsCalendar.mockResolvedValue({
        url: 'https://example.com/dav.php/calendars/user/calino-settings/',
      })
      mockFetchSettingsEvent.mockResolvedValue(null)
      mockPutSettingsEvent.mockRejectedValue(new Error('500 Internal Server Error'))

      const { result } = renderHook(() => useSettingsSync())
      await act(async () => {
        await result.current.push()
      })

      expect(result.current.error).toBe('500 Internal Server Error')
      expect(mockToast.error).toHaveBeenCalledTimes(1)
    })

    it('should not toast an error when a 412 conflict is silently recovered via retry', async () => {
      setPrimaryAccountId('account-1')
      mockDiscoverSettingsCalendar.mockResolvedValue({
        url: 'https://example.com/dav.php/calendars/user/calino-settings/',
      })
      mockFetchSettingsEvent.mockResolvedValue(null)
      mockPutSettingsEvent
        .mockRejectedValueOnce(new Error('412 Precondition Failed'))
        .mockResolvedValueOnce('"recovered-etag"')

      const { result } = renderHook(() => useSettingsSync())
      await act(async () => {
        await result.current.push()
      })

      expect(mockPutSettingsEvent).toHaveBeenCalledTimes(2)
      expect(result.current.error).toBeNull()
      expect(mockToast.error).not.toHaveBeenCalled()
    })
  })

  describe('pull', () => {
    it('should fetch and merge remote settings', async () => {
      setPrimaryAccountId('account-1')
      mockDiscoverSettingsCalendar.mockResolvedValue({
        url: 'https://example.com/dav.php/calendars/user/calino-settings/',
      })

      const remotePayload = {
        version: 1,
        syncedAt: '2099-01-01T00:00:00Z',
        settings: { timezone: 'Pacific/Auckland' },
      }
      mockFetchSettingsEvent.mockResolvedValue({
        data:
          'BEGIN:VCALENDAR\r\n...ATTACH;ENCODING=BASE64;FMTTYPE=app/json:' +
          btoa(JSON.stringify(remotePayload)) +
          '\r\n...',
        etag: '"remote-etag"',
        href: 'https://example.com/calino-settings.ics',
        dtstamp: '20990101T000000Z',
      })
      mockExtractSettingsFromVEVENT.mockReturnValue(JSON.stringify(remotePayload))

      const { result } = renderHook(() => useSettingsSync())
      await act(async () => {
        await result.current.pull()
      })

      const settings = useSettingsStore.getState()
      expect(settings.timezone).toBe('Pacific/Auckland')
      expect(getLastSyncedAt()).toBeTruthy()
    })

    it('should return early when no remote event exists', async () => {
      setPrimaryAccountId('account-1')
      mockDiscoverSettingsCalendar.mockResolvedValue({
        url: 'https://example.com/dav.php/calendars/user/calino-settings/',
      })
      mockFetchSettingsEvent.mockResolvedValue(null)

      const { result } = renderHook(() => useSettingsSync())
      const originalTimezone = useSettingsStore.getState().timezone
      await act(async () => {
        await result.current.pull()
      })

      // Settings should not be modified when there's no remote event
      expect(useSettingsStore.getState().timezone).toBe(originalTimezone)
    })
  })

  describe('discoverSettings', () => {
    it('should silently no-op when no settings calendar exists yet', async () => {
      mockDiscoverSettingsCalendar.mockResolvedValue(null)

      const { result } = renderHook(() => useSettingsSync())
      await act(async () => {
        await result.current.discoverSettings('account-1')
      })

      expect(getPrimaryAccountId()).toBeNull()
      expect(mockToast).not.toHaveBeenCalled()
      expect(mockToast.error).not.toHaveBeenCalled()
    })

    // Regression for issue #52: previously this catch block only logged to
    // the console — a real failure during auto-discovery (e.g. on adding a
    // second device to an already-syncing account) gave the user zero
    // feedback that anything had gone wrong.
    it('should surface an error toast when discovery throws', async () => {
      mockDiscoverSettingsCalendar.mockRejectedValue(
        new Error('Failed to parse WebDAV XML response')
      )

      const { result } = renderHook(() => useSettingsSync())
      await act(async () => {
        await result.current.discoverSettings('account-1')
      })

      expect(getPrimaryAccountId()).toBeNull()
      expect(mockToast.error).toHaveBeenCalledTimes(1)
      expect(mockToast.error.mock.calls[0][0]).toContain('Settings sync failed')
    })
  })
})
