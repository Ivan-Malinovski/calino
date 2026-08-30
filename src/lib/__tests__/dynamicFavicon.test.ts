import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Capacitor } from '@capacitor/core'
import {
  createDynamicFaviconDataUrl,
  createDynamicFaviconSvg,
  millisecondsUntilNextLocalDay,
  setDynamicFavicon,
  startDynamicFavicon,
} from '../dynamicFavicon'

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
}))

const DATA_URL_PREFIX = 'data:image/svg+xml,'

function decodeFaviconHref(href: string): string {
  expect(href.startsWith(DATA_URL_PREFIX)).toBe(true)
  return decodeURIComponent(href.slice(DATA_URL_PREFIX.length))
}

describe('createDynamicFaviconSvg', () => {
  it('puts the local day in a centred numeral', () => {
    const single = createDynamicFaviconSvg(7)
    expect(single).toContain('>7</text>')
    expect(single).toContain('x="128"')
    expect(single).not.toContain('scale(')
    expect(single).not.toContain('font-variant-numeric')

    const double = createDynamicFaviconSvg(28)
    expect(double).toContain('>28</text>')
    expect(double).toContain('x="128"')
    expect(double).not.toContain('scale(')
    expect(double).toContain('font-variant-numeric="tabular-nums"')
  })

  it('rejects a day that cannot appear on a calendar', () => {
    expect(() => createDynamicFaviconSvg(32)).toThrow(RangeError)
  })
})

describe('setDynamicFavicon', () => {
  afterEach(() => {
    document.head.innerHTML = ''
  })

  it('updates the existing fallback link with an SVG data URL', () => {
    document.head.innerHTML = '<link rel="icon" href="/calino-icon.svg">'
    const link = setDynamicFavicon(7, document)

    expect(document.querySelectorAll('link[rel~="icon"]')).toHaveLength(1)
    expect(link.type).toBe('image/svg+xml')
    expect(link.getAttribute('href')).toBe(createDynamicFaviconDataUrl(7))
    expect(decodeFaviconHref(link.getAttribute('href') ?? '')).toContain('>7</text>')
  })
})

describe('millisecondsUntilNextLocalDay', () => {
  it('targets the next local midnight', () => {
    const now = new Date(2026, 7, 30, 23, 59, 30)
    expect(millisecondsUntilNextLocalDay(now)).toBe(30_000)
  })

  it('crosses a month boundary', () => {
    const now = new Date(2026, 7, 31, 23, 59, 0)
    expect(millisecondsUntilNextLocalDay(now)).toBe(60_000)
  })
})

describe('startDynamicFavicon', () => {
  beforeEach(() => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false)
    document.head.innerHTML = '<link rel="icon" href="/calino-icon.svg">'
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    document.head.innerHTML = ''
  })

  it('applies the current local day and rolls over after midnight', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 7, 23, 59, 30))

    const stop = startDynamicFavicon()
    const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
    expect(decodeFaviconHref(link?.getAttribute('href') ?? '')).toContain('>7</text>')

    vi.advanceTimersByTime(31_000)
    expect(decodeFaviconHref(link?.getAttribute('href') ?? '')).toContain('>8</text>')
    stop()
  })

  it('refreshes when a hidden tab becomes visible again', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 7, 12, 0, 0))
    let visibility: DocumentVisibilityState = 'visible'
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    })

    const stop = startDynamicFavicon()
    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    vi.setSystemTime(new Date(2026, 7, 8, 12, 0, 0))
    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))

    const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
    expect(decodeFaviconHref(link?.getAttribute('href') ?? '')).toContain('>8</text>')
    stop()
  })

  it('does not touch the document on a native platform', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true)
    const stop = startDynamicFavicon()
    const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
    expect(link?.getAttribute('href')).toBe('/calino-icon.svg')
    stop()
  })
})
