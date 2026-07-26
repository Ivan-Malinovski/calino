import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useUpdateCheck } from '../useUpdateCheck'

const MOCK_RELEASE_RESPONSE = {
  tag_name: 'v99.0.0',
  html_url: 'https://github.com/ivan-malinovski/Calino/releases/tag/v99.0.0',
}

// In-memory storage for mocking safeLocalStorage
const memoryStore = new Map<string, string>()

vi.mock('@/lib/storage', () => ({
  safeLocalStorage: {
    getItem: vi.fn((key: string) => memoryStore.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      memoryStore.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      memoryStore.delete(key)
    }),
    clear: vi.fn(() => {
      memoryStore.clear()
    }),
    get length() {
      return memoryStore.size
    },
    key: vi.fn((index: number) => [...memoryStore.keys()][index] ?? null),
  },
}))

beforeEach(() => {
  memoryStore.clear()
  vi.spyOn(globalThis, 'fetch')
})

afterEach(() => {
  vi.restoreAllMocks()
})

function mockFetchSuccess(response: object = MOCK_RELEASE_RESPONSE): void {
  vi.mocked(globalThis.fetch).mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => response,
  } as Response)
}

function mockFetch404(): void {
  vi.mocked(globalThis.fetch).mockResolvedValueOnce({
    ok: false,
    status: 404,
  } as Response)
}

function mockFetchError(status: number): void {
  vi.mocked(globalThis.fetch).mockResolvedValueOnce({
    ok: false,
    status,
  } as Response)
}

function mockFetchNetworkError(): void {
  vi.mocked(globalThis.fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))
}

describe('useUpdateCheck', () => {
  it('returns no update when current version is latest', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ tag_name: 'v0.8.6', html_url: 'https://example.com' }),
    } as Response)

    const { result } = renderHook(() => useUpdateCheck())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.hasUpdate).toBe(false)
    expect(result.current.latestVersion).toBeNull()
  })

  it('detects when a newer version is available', async () => {
    mockFetchSuccess()

    const { result } = renderHook(() => useUpdateCheck())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.hasUpdate).toBe(true)
    expect(result.current.latestVersion).toBe('v99.0.0')
    expect(result.current.releaseUrl).toBe(MOCK_RELEASE_RESPONSE.html_url)
  })

  it('skips fetch if checked within last 24 hours', async () => {
    const now = new Date().toISOString()
    memoryStore.set('calino-last-update-check', now)

    const { result } = renderHook(() => useUpdateCheck())

    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
    expect(result.current.hasUpdate).toBe(false)
  })

  it('fetches again if last check was more than 24 hours ago', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    memoryStore.set('calino-last-update-check', old)

    mockFetchSuccess()

    renderHook(() => useUpdateCheck())

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled()
    })
  })

  it('dismisses the update and persists to localStorage', async () => {
    mockFetchSuccess()

    const { result } = renderHook(() => useUpdateCheck())

    await waitFor(() => {
      expect(result.current.hasUpdate).toBe(true)
    })

    act(() => {
      result.current.dismiss()
    })

    expect(result.current.hasUpdate).toBe(false)
    expect(memoryStore.get('calino-dismissed-version')).toBe('v99.0.0')
  })

  it('does not show dismissed version on re-check', async () => {
    memoryStore.set('calino-dismissed-version', 'v99.0.0')

    mockFetchSuccess()

    const { result } = renderHook(() => useUpdateCheck())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.hasUpdate).toBe(false)
  })

  it('shows update again when a newer version appears after dismissal', async () => {
    memoryStore.set('calino-dismissed-version', 'v0.9.0')
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ tag_name: 'v99.0.0', html_url: 'https://example.com/v99.0.0' }),
    } as Response)

    const { result } = renderHook(() => useUpdateCheck())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.hasUpdate).toBe(true)
    expect(result.current.latestVersion).toBe('v99.0.0')
  })

  it('handles 404 (no releases) gracefully', async () => {
    mockFetch404()

    const { result } = renderHook(() => useUpdateCheck())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.hasUpdate).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('handles API errors gracefully', async () => {
    mockFetchError(500)

    const { result } = renderHook(() => useUpdateCheck())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.hasUpdate).toBe(false)
    expect(result.current.error).toBe('Failed to check for updates: GitHub API error: 500')
  })

  it('handles network errors gracefully', async () => {
    mockFetchNetworkError()

    const { result } = renderHook(() => useUpdateCheck())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.hasUpdate).toBe(false)
    expect(result.current.error).toBe('Failed to check for updates: Failed to fetch')
  })

  it('does not update state after unmount', async () => {
    let resolvePromise: (v: Response) => void
    const slowPromise = new Promise<Response>((resolve) => {
      resolvePromise = resolve
    })
    vi.mocked(globalThis.fetch).mockReturnValueOnce(slowPromise)

    const { unmount } = renderHook(() => useUpdateCheck())

    unmount()

    resolvePromise!({
      ok: true,
      status: 200,
      json: async () => MOCK_RELEASE_RESPONSE,
    } as Response)

    // No crash should occur
  })
})
