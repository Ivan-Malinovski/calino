import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { ThemeProvider } from '../ThemeProvider'
import type { ReactNode } from 'react'

// Mock settingsStore
let currentThemeMode = 'light'

vi.mock('@/store/settingsStore', () => {
  const mockFn = vi.fn((selector: (s: Record<string, unknown>) => unknown) => {
    const state = {
      themeMode: currentThemeMode,
      lightTheme: 'built-in',
      darkTheme: 'built-in',
    }
    return selector(state)
  })
  return {
    useSettingsStore: Object.assign(mockFn, {
      getState: () => ({
        themeMode: currentThemeMode,
        lightTheme: 'built-in',
        darkTheme: 'built-in',
      }),
    }),
  }
})

vi.mock('@/lib/themes', () => ({
  loadThemes: vi.fn().mockResolvedValue([]),
  getThemeCSS: vi.fn().mockReturnValue(''),
}))

vi.mock('../ThemeContext', () => ({
  ThemeContext: {
    Provider: ({ children }: { children: ReactNode }) => children,
  },
}))

// Mock matchMedia
const mockAddEventListener = vi.fn()
const mockRemoveEventListener = vi.fn()
let mediaChangeHandler: ((event: MediaQueryListEvent) => void) | undefined

beforeEach(() => {
  mediaChangeHandler = undefined
  mockAddEventListener.mockImplementation(
    (_event: string, handler: (event: MediaQueryListEvent) => void) => {
      mediaChangeHandler = handler
    }
  )
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: mockAddEventListener,
      removeEventListener: mockRemoveEventListener,
      dispatchEvent: vi.fn(),
    })),
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Bug #107: ThemeProvider unnecessary media listener registration', () => {
  beforeEach(() => {
    currentThemeMode = 'light'
    vi.clearAllMocks()
  })

  it('registers media query listener only when themeMode is auto', () => {
    currentThemeMode = 'auto'
    renderHook(() => ThemeProvider({ children: null }))
    expect(mockAddEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('does not register media query listener when themeMode is light', () => {
    currentThemeMode = 'light'
    renderHook(() => ThemeProvider({ children: null }))
    expect(mockAddEventListener).not.toHaveBeenCalled()
  })

  it('does not register media query listener when themeMode is dark', () => {
    currentThemeMode = 'dark'
    renderHook(() => ThemeProvider({ children: null }))
    expect(mockAddEventListener).not.toHaveBeenCalled()
  })

  it('cleans up listener on unmount when auto', () => {
    currentThemeMode = 'auto'
    const { unmount } = renderHook(() => ThemeProvider({ children: null }))
    unmount()
    expect(mockRemoveEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('updates the effective mode when the system preference changes', () => {
    currentThemeMode = 'auto'
    renderHook(() => ThemeProvider({ children: null }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')

    act(() => {
      mediaChangeHandler?.({ matches: true } as MediaQueryListEvent)
    })

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  })
})
