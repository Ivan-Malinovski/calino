import { describe, expect, it, vi } from 'vitest'
import { createDirectDavFetch, validateCustomHeaders } from '../customHeaders'

describe('custom DAV headers', () => {
  it('rejects unsafe and duplicate names, injection, and proxy combinations', () => {
    expect(() => validateCustomHeaders({ Authorization: 'secret' })).toThrow()
    expect(() =>
      validateCustomHeaders({ 'CF-Access-Client-Id': 'a', 'cf-access-client-id': 'b' })
    ).toThrow()
    expect(() => validateCustomHeaders({ 'X-Key': 'a\r\nb' })).toThrow()
    expect(() => validateCustomHeaders({ 'X-Key': 'a' }, 'https://proxy.example')).toThrow()
  })

  it('sends configured headers with any DAV method only to the configured origin', async () => {
    const transport = vi.fn(
      async () => new Response(null, { status: 204 })
    ) as unknown as typeof fetch
    const davFetch = createDirectDavFetch(
      'https://dav.example/path',
      { 'P-Access-Token': 'secret' },
      transport
    )
    await davFetch('https://dav.example/calendar/', { method: 'PROPFIND', headers: { Depth: '1' } })
    const init = vi.mocked(transport).mock.calls[0][1]!
    expect(new Headers(init.headers).get('P-Access-Token')).toBe('secret')
    expect(new Headers(init.headers).get('Depth')).toBe('1')
    expect(init.redirect).toBe('error')
    await expect(davFetch('https://other.example/calendar/', { method: 'GET' })).rejects.toThrow(
      'changed origin'
    )
    expect(transport).toHaveBeenCalledTimes(1)
  })
})
