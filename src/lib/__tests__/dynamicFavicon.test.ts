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
  it.each([1, 7, 9, 10, 28, 31])('renders day %i', (day) => {
    const svg = createDynamicFaviconSvg(day)
    expect(svg).toContain(`>${day}</text>`)
    expect(svg).toContain('#b07d4f')
    expect(svg).toContain('#faf8f3')
    expect(svg).toContain('rotate(45 198 198)')
    expect(svg).toContain('cx="198"')
    expect(svg).toContain('x="128"')
  })

  it.each([0, 1.5, 32, -1, Number.NaN])('rejects invalid day %s', (day) => {
    expect(() => createDynamicFaviconSvg(day)).toThrow(RangeError)
  })

  it('keeps a single-digit numeral unscaled and centred', () => {
    const svg = createDynamicFaviconSvg(7)
    expect(svg).toContain('font-size="142"')
    expect(svg).not.toContain('scale(0.9 1)')
    expect(svg).not.toContain('font-variant-numeric')
  })

  it('uses the compressed double-digit treatment without shifting the centre', () => {
    const svg = createDynamicFaviconSvg(28)
    expect(svg).toContain('x="128"')
    expect(svg).toContain('font-size="136"')
    expect(svg).toContain('scale(0.9 1)')
    expect(svg).toContain('font-variant-numeric="tabular-nums"')
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

  it('creates a link when the fallback is missing', () => {
    const link = setDynamicFavicon(10, document)
    expect(document.head.contains(link)).toBe(true)
    expect(link.rel).toBe('icon')
    expect(decodeFaviconHref(link.getAttribute('href') ?? '')).toContain('>10</text>')
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
    const next = new Date(now.getTime() + 60_000)
    expect(next.getMonth()).toBe(8)
    expect(next.getDate()).toBe(1)
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

  it('refreshes on pageshow after a frozen tab', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 7, 12, 0, 0))
    const stop = startDynamicFavicon()
    vi.setSystemTime(new Date(2026, 7, 9, 8, 0, 0))
    window.dispatchEvent(new Event('pageshow'))

    const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
    expect(decodeFaviconHref(link?.getAttribute('href') ?? '')).toContain('>9</text>')
    stop()
  })

  it('cleanup stops timers and listeners', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 7, 23, 59, 30))
    const stop = startDynamicFavicon()
    stop()
    vi.advanceTimersByTime(31_000)
    window.dispatchEvent(new Event('pageshow'))

    const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
    expect(decodeFaviconHref(link?.getAttribute('href') ?? '')).toContain('>7</text>')
  })

  it('does not touch the document on a native platform', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true)
    const stop = startDynamicFavicon()
    const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
    expect(link?.getAttribute('href')).toBe('/calino-icon.svg')
    stop()
  })
})
