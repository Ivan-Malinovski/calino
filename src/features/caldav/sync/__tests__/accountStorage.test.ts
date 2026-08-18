import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PendingChange } from '../../types'
import {
  addPendingChange,
  getAllAccounts,
  getAllCalendars,
  getPendingChanges,
} from '../accountStorage'

describe('accountStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Bug 36: JSON.parse failure warnings', () => {
    function mockLocalStorage(getItemReturn: string | null) {
      const mock = {
        getItem: vi.fn().mockReturnValue(getItemReturn),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        key: vi.fn(),
        length: 0,
      }
      Object.defineProperty(window, 'localStorage', { value: mock, writable: true })
      Object.defineProperty(globalThis, 'localStorage', { value: mock, writable: true })
      return mock
    }

    describe('getAllAccounts', () => {
      it('logs a warning when stored accounts are corrupted JSON', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        mockLocalStorage('{invalid json}')

        const result = getAllAccounts()

        expect(result).toEqual([])
        expect(warnSpy).toHaveBeenCalledTimes(1)
        expect(warnSpy.mock.calls[0][0]).toContain('[CalDAV]')
        expect(warnSpy.mock.calls[0][0]).toContain('accounts')
        expect(warnSpy.mock.calls[0][0]).toContain('corrupted')

        warnSpy.mockRestore()
      })

      it('returns empty array when localStorage is empty', () => {
        mockLocalStorage(null)

        const result = getAllAccounts()

        expect(result).toEqual([])
      })
    })

    describe('getAllCalendars', () => {
      it('logs a warning when stored calendars are corrupted JSON', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        mockLocalStorage('broken{json')

        const result = getAllCalendars()

        expect(result).toEqual([])
        expect(warnSpy).toHaveBeenCalledTimes(1)
        expect(warnSpy.mock.calls[0][0]).toContain('[CalDAV]')
        expect(warnSpy.mock.calls[0][0]).toContain('calendars')
        expect(warnSpy.mock.calls[0][0]).toContain('corrupted')

        warnSpy.mockRestore()
      })

      it('returns empty array when localStorage is empty', () => {
        mockLocalStorage(null)

        const result = getAllCalendars()

        expect(result).toEqual([])
      })
    })

    describe('getPendingChanges', () => {
      it('logs a warning when stored pending changes are corrupted JSON', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        mockLocalStorage('["unclosed')

        const result = getPendingChanges()

        expect(result).toEqual([])
        expect(warnSpy).toHaveBeenCalledTimes(1)
        expect(warnSpy.mock.calls[0][0]).toContain('[CalDAV]')
        expect(warnSpy.mock.calls[0][0]).toContain('pending changes')
        expect(warnSpy.mock.calls[0][0]).toContain('corrupted')

        warnSpy.mockRestore()
      })

      it('returns empty array when localStorage is empty', () => {
        mockLocalStorage(null)

        const result = getPendingChanges()

        expect(result).toEqual([])
      })
    })
  })

  describe('addPendingChange coalescing', () => {
    // Functional in-memory localStorage mock: getItem returns whatever
    // setItem stored, so the module round-trips real JSON like jsdom would.
    function createLocalStorageMock() {
      const store = new Map<string, string>()
      const mock = {
        getItem: vi.fn((key: string) =>
          store.has(key) ? (store.get(key) as string) : null
        ),
        setItem: vi.fn((key: string, value: string) => {
          store.set(key, value)
        }),
        removeItem: vi.fn((key: string) => {
          store.delete(key)
        }),
        clear: vi.fn(() => {
          store.clear()
        }),
        key: vi.fn(),
        length: 0,
      }
      Object.defineProperty(window, 'localStorage', { value: mock, writable: true })
      Object.defineProperty(globalThis, 'localStorage', { value: mock, writable: true })
      return mock
    }

    type ChangeInput = Omit<PendingChange, 'id' | 'timestamp' | 'retryCount'>

    function change(over: Partial<ChangeInput> = {}): ChangeInput {
      return {
        type: 'update',
        eventId: 'event-1',
        calendarId: 'calendar-1',
        data: 'payload',
        ...over,
      }
    }

    it('coalesces two updates for the same event+calendar into one entry', () => {
      createLocalStorageMock()

      addPendingChange(change({ type: 'update', data: 'v1' }))
      const firstId = getPendingChanges()[0].id
      addPendingChange(change({ type: 'update', data: 'v2' }))

      const changes = getPendingChanges()
      expect(changes).toHaveLength(1)
      expect(changes[0].type).toBe('update')
      expect(changes[0].data).toBe('v2')
      expect(changes[0].retryCount).toBe(0)
      expect(changes[0].id).toBe(firstId)
    })

    it('supersedes an update with a delete for the same event+calendar', () => {
      createLocalStorageMock()

      addPendingChange(change({ type: 'update', data: 'v1' }))
      addPendingChange(change({ type: 'delete' }))

      const changes = getPendingChanges()
      expect(changes).toHaveLength(1)
      expect(changes[0].type).toBe('delete')
      expect(changes[0].retryCount).toBe(0)
    })

    it('supersedes a delete with an update (resurrection)', () => {
      createLocalStorageMock()

      addPendingChange(change({ type: 'delete' }))
      addPendingChange(change({ type: 'update', data: 'revived' }))

      const changes = getPendingChanges()
      expect(changes).toHaveLength(1)
      expect(changes[0].type).toBe('update')
      expect(changes[0].data).toBe('revived')
      expect(changes[0].retryCount).toBe(0)
    })

    it('coalesces a create followed by an update into a single update', () => {
      createLocalStorageMock()

      addPendingChange(change({ type: 'create', data: 'created' }))
      addPendingChange(change({ type: 'update', data: 'updated' }))

      const changes = getPendingChanges()
      expect(changes).toHaveLength(1)
      expect(changes[0].type).toBe('update')
      expect(changes[0].data).toBe('updated')
    })

    it('keeps separate entries for updates to different events', () => {
      createLocalStorageMock()

      addPendingChange(change({ eventId: 'event-a' }))
      addPendingChange(change({ eventId: 'event-b' }))

      const changes = getPendingChanges()
      expect(changes).toHaveLength(2)
      expect(changes.map((c) => c.eventId)).toEqual(['event-a', 'event-b'])
    })

    it('keeps separate entries for updates to the same event in different calendars', () => {
      createLocalStorageMock()

      addPendingChange(change({ calendarId: 'calendar-a' }))
      addPendingChange(change({ calendarId: 'calendar-b' }))

      const changes = getPendingChanges()
      expect(changes).toHaveLength(2)
      expect(changes.map((c) => c.calendarId)).toEqual(['calendar-a', 'calendar-b'])
    })

    it('does not coalesce an update with a move (move carries target calendarId)', () => {
      createLocalStorageMock()

      addPendingChange(change({ type: 'update', calendarId: 'calendar-src' }))
      addPendingChange(change({ type: 'move', calendarId: 'calendar-target' }))

      const changes = getPendingChanges()
      expect(changes).toHaveLength(2)
      expect(changes[0].type).toBe('update')
      expect(changes[1].type).toBe('move')
    })

    it('never coalesces a move away when a follow-up update arrives', () => {
      createLocalStorageMock()

      addPendingChange(change({ type: 'move', calendarId: 'calendar-target' }))
      addPendingChange(change({ type: 'update', calendarId: 'calendar-src' }))

      const changes = getPendingChanges()
      expect(changes).toHaveLength(2)
      expect(changes[0].type).toBe('move')
      expect(changes[1].type).toBe('update')
    })

    it('does not coalesce an update with a delete-href', () => {
      createLocalStorageMock()

      addPendingChange(change({ type: 'update' }))
      addPendingChange(change({ type: 'delete-href' }))

      const changes = getPendingChanges()
      expect(changes).toHaveLength(2)
      expect(changes[0].type).toBe('update')
      expect(changes[1].type).toBe('delete-href')
    })

    it('resets retryCount when coalescing over a previously failed entry', () => {
      const mock = createLocalStorageMock()
      mock.setItem(
        'calino_pending_changes',
        JSON.stringify([
          {
            id: 'stale-id',
            type: 'update',
            eventId: 'event-1',
            calendarId: 'calendar-1',
            data: 'stale',
            timestamp: '2024-01-01T00:00:00.000Z',
            retryCount: 9,
          },
        ])
      )

      addPendingChange(change({ type: 'update', data: 'fresh' }))

      const changes = getPendingChanges()
      expect(changes).toHaveLength(1)
      expect(changes[0].id).toBe('stale-id')
      expect(changes[0].data).toBe('fresh')
      expect(changes[0].retryCount).toBe(0)
    })

    it('refreshes the timestamp when coalescing', () => {
      createLocalStorageMock()

      addPendingChange(change({ type: 'update', data: 'v1' }))
      const firstTimestamp = getPendingChanges()[0].timestamp
      addPendingChange(change({ type: 'update', data: 'v2' }))

      const changes = getPendingChanges()
      expect(changes).toHaveLength(1)
      expect(changes[0].timestamp >= firstTimestamp).toBe(true)
    })
  })
})
