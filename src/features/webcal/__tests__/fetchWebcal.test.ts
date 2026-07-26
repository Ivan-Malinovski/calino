import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { normalizeWebcalUrl, fetchWebcalIcs } from '../fetchWebcal'

describe('normalizeWebcalUrl', () => {
  it('rewrites webcal:// to https://', () => {
    expect(normalizeWebcalUrl('webcal://example.com/cal.ics')).toBe('https://example.com/cal.ics')
  })

  it('rewrites webcals:// to https://', () => {
    expect(normalizeWebcalUrl('webcals://example.com/cal.ics')).toBe('https://example.com/cal.ics')
  })

  it('leaves https:// URLs untouched', () => {
    expect(normalizeWebcalUrl('https://example.com/cal.ics')).toBe('https://example.com/cal.ics')
  })

  it('trims whitespace', () => {
    expect(normalizeWebcalUrl('  https://example.com/cal.ics  ')).toBe(
      'https://example.com/cal.ics'
    )
  })
})

describe('fetchWebcalIcs', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('rejects an invalid URL', async () => {
    await expect(fetchWebcalIcs('not a url')).rejects.toThrow(/valid calendar URL/)
  })

  it('rejects a non-http(s) scheme', async () => {
    await expect(fetchWebcalIcs('ftp://example.com/cal.ics')).rejects.toThrow(/http\(s\)/)
  })

  it('throws a friendly error on non-2xx response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response('', { status: 404 }))
    await expect(fetchWebcalIcs('https://example.com/cal.ics')).rejects.toThrow(/status 404/)
  })

  it('throws on a response that is not a valid VCALENDAR', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('<html>not ics</html>', { status: 200 })
    )
    await expect(fetchWebcalIcs('https://example.com/cal.ics')).rejects.toThrow(/valid iCalendar/)
  })

  it('returns the raw ics text on success', async () => {
    const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n'
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(ics, { status: 200 }))

    const result = await fetchWebcalIcs('webcal://example.com/cal.ics')

    expect(result).toBe(ics)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://example.com/cal.ics',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('routes through the proxy when proxyUrl is given', async () => {
    const ics = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(ics, { status: 200 }))

    await fetchWebcalIcs('https://example.com/cal.ics', 'https://proxy.example.com')

    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string
    expect(calledUrl).toContain('proxy.example.com')
    expect(calledUrl).toContain(encodeURIComponent('https://example.com'))
  })
})
