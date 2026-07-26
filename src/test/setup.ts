import '@testing-library/jest-dom'
import { vi } from 'vitest'
import pkg from '../../package.json'

// Provide the compile-time constant for tests (synced from package.json)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).__APP_VERSION__ = pkg.version
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).__CALINO_SELF_HOSTED__ = false

const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  key: vi.fn(),
  length: 0,
}

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
})

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
})

// jsdom doesn't implement ResizeObserver. cmdk uses it for layout effects.
if (typeof globalThis.ResizeObserver === 'undefined') {
  const ResizeObserverMock = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver
  ;(globalThis as { ResizeObserver: typeof ResizeObserver }).ResizeObserver = ResizeObserverMock
  ;(window as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    ResizeObserverMock
}

// jsdom doesn't implement scrollIntoView. cmdk calls it on the selected item.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {}
}
