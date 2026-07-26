import { describe, it, expect, vi, beforeEach } from 'vitest'

const isNativePlatform = vi.fn(() => false)
const nativeRequest = vi.fn()

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => isNativePlatform(),
  },
  registerPlugin: () => ({ request: nativeRequest }),
}))

const { webFetch } = await import('../webFetch')

const davResponse = (overrides: Record<string, unknown> = {}) => ({
  status: 207,
  statusText: 'Multi-Status',
  url: 'https://dav.example.com/dav.php/',
  headers: { 'content-type': 'application/xml' },
  body: '<multistatus/>',
  ...overrides,
})

describe('webFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isNativePlatform.mockReturnValue(false)
    delete (globalThis as { CapacitorWebFetch?: unknown }).CapacitorWebFetch
  })

  describe('on web', () => {
    it('uses the global fetch', async () => {
      const globalFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))

      await webFetch('https://dav.example.com/', { method: 'PROPFIND' })

      expect(globalFetch).toHaveBeenCalled()
      expect(nativeRequest).not.toHaveBeenCalled()
      globalFetch.mockRestore()
    })

    it("prefers Capacitor's unpatched fetch when it exists", async () => {
      // Guards the regression this module was written for: with CapacitorHttp
      // enabled the global fetch is a shim that cannot send WebDAV verbs.
      const unpatched = vi.fn().mockResolvedValue(new Response('ok'))
      ;(globalThis as { CapacitorWebFetch?: unknown }).CapacitorWebFetch = unpatched
      const globalFetch = vi.spyOn(globalThis, 'fetch')

      await webFetch('https://dav.example.com/', { method: 'PROPFIND' })

      expect(unpatched).toHaveBeenCalled()
      expect(globalFetch).not.toHaveBeenCalled()
      globalFetch.mockRestore()
    })
  })

  describe('on native', () => {
    beforeEach(() => {
      isNativePlatform.mockReturnValue(true)
    })

    it('sends method, headers and body to the DavHttp plugin', async () => {
      nativeRequest.mockResolvedValue(davResponse())

      await webFetch('https://dav.example.com/dav.php/', {
        method: 'PROPFIND',
        headers: { Authorization: 'Basic abc', Depth: '0' },
        body: '<propfind/>',
      })

      expect(nativeRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://dav.example.com/dav.php/',
          method: 'PROPFIND',
          body: '<propfind/>',
          headers: expect.objectContaining({ authorization: 'Basic abc', depth: '0' }),
        })
      )
    })

    it('adapts the plugin result into a Response', async () => {
      nativeRequest.mockResolvedValue(davResponse())

      const response = await webFetch('https://dav.example.com/dav.php/', { method: 'PROPFIND' })

      expect(response.status).toBe(207)
      expect(response.headers.get('content-type')).toBe('application/xml')
      expect(await response.text()).toBe('<multistatus/>')
    })

    it('exposes the post-redirect URL, which .well-known discovery depends on', async () => {
      nativeRequest.mockResolvedValue(
        davResponse({ url: 'https://dav.example.com/dav.php/principals/ivan/' })
      )

      const response = await webFetch('https://dav.example.com/.well-known/caldav')

      expect(response.url).toBe('https://dav.example.com/dav.php/principals/ivan/')
    })

    it('omits the body on statuses that must not carry one', async () => {
      nativeRequest.mockResolvedValue(
        davResponse({ status: 204, statusText: 'No Content', body: '' })
      )

      const response = await webFetch('https://dav.example.com/event.ics', { method: 'DELETE' })

      expect(response.status).toBe(204)
    })

    it('sends no body for GET', async () => {
      nativeRequest.mockResolvedValue(davResponse({ status: 200 }))

      await webFetch('https://dav.example.com/event.ics')

      expect(nativeRequest.mock.calls[0][0]).not.toHaveProperty('body')
    })

    it("rejects with AbortError when the caller's signal fires", async () => {
      const controller = new AbortController()
      nativeRequest.mockReturnValue(new Promise(() => {}))

      const pending = webFetch('https://dav.example.com/', {
        method: 'PROPFIND',
        signal: controller.signal,
      })
      controller.abort()

      await expect(pending).rejects.toThrow(/aborted/i)
    })

    it('propagates network failures as a rejection', async () => {
      nativeRequest.mockRejectedValue(new Error('Unable to resolve host'))

      await expect(webFetch('https://nope.example.com/', { method: 'PROPFIND' })).rejects.toThrow(
        'Unable to resolve host'
      )
    })
  })
})
