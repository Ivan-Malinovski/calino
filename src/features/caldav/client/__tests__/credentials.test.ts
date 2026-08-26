import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getAllCredentials } from '../credentials'

describe('credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Bug 36: JSON.parse failure warnings', () => {
    it('logs a warning when stored credentials are corrupted JSON', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const localStorageMock = {
        getItem: vi.fn().mockReturnValue('not-valid-json{{'),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        key: vi.fn(),
        length: 0,
      }
      Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true })
      Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })

      const result = await getAllCredentials()

      expect(result).toEqual([])
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy.mock.calls[0][0]).toContain('[CalDAV]')
      expect(warnSpy.mock.calls[0][0]).toContain('credentials')
      expect(warnSpy.mock.calls[0][0]).toContain('Failed to parse')

      warnSpy.mockRestore()
    })

    it('returns empty array when localStorage is empty', async () => {
      const localStorageMock = {
        getItem: vi.fn().mockReturnValue(null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        key: vi.fn(),
        length: 0,
      }
      Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true })
      Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })

      const result = await getAllCredentials()

      expect(result).toEqual([])
    })

    it('returns parsed credentials when JSON is valid', async () => {
      const validData = JSON.stringify([
        { id: '1', serverUrl: 'https://example.com', username: 'user', password: 'pass' },
      ])
      const localStorageMock = {
        getItem: vi.fn().mockReturnValue(validData),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        key: vi.fn(),
        length: 0,
      }
      Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true })
      Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })

      const result = await getAllCredentials()

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('1')
      expect(result[0].authMode).toBe('basic')
    })

    it('preserves browser-session authentication mode', async () => {
      const validData = JSON.stringify([
        {
          id: 'session',
          serverUrl: 'https://calendar.example.com/dav/',
          username: '',
          password: '',
          authMode: 'browser-session',
        },
      ])
      const localStorageMock = {
        getItem: vi.fn().mockReturnValue(validData),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        key: vi.fn(),
        length: 0,
      }
      Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true })
      Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })

      const result = await getAllCredentials()

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        id: 'session',
        authMode: 'browser-session',
        username: '',
        password: '',
      })
    })
  })
})
