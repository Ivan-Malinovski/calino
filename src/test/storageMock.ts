import { vi } from 'vitest'

/**
 * Creates an in-memory `localStorage` mock backed by a `Map`.
 *
 * Wires up the four `vi.mocked(localStorage.*)` calls so that
 * `localStorage.getItem / setItem / removeItem / clear` round-trip
 * through a per-test Map. The returned `reset()` should be called
 * in `afterEach` (or before each test) to clear the Map between tests.
 *
 * Usage:
 * ```ts
 * const storage = createLocalStorageMock()
 * beforeEach(() => storage.install())
 * afterEach(() => { vi.restoreAllMocks(); storage.reset() })
 * ```
 */
export function createLocalStorageMock(): {
  install: () => void
  reset: () => void
} {
  const store = new Map<string, string>()

  const install = (): void => {
    vi.mocked(localStorage.getItem).mockImplementation((key: string) => store.get(key) ?? null)
    vi.mocked(localStorage.setItem).mockImplementation((key: string, value: string) => {
      store.set(key, value)
    })
    vi.mocked(localStorage.removeItem).mockImplementation((key: string) => {
      store.delete(key)
    })
    vi.mocked(localStorage.clear).mockImplementation(() => {
      store.clear()
    })
  }

  const reset = (): void => {
    store.clear()
  }

  return { install, reset }
}
