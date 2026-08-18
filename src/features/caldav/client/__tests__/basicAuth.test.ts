import { describe, it, expect } from 'vitest'
import { basicAuthHeader } from '../basicAuth'

describe('basicAuthHeader (UTF-8 Basic auth, RFC 7617)', () => {
  it('matches plain btoa for ASCII credentials', () => {
    expect(basicAuthHeader('u', 'p')).toBe(`Basic ${btoa('u:p')}`)
  })

  it('encodes Latin-1 characters as UTF-8 bytes, not codepoints', () => {
    // btoa('u:pässword') would base64 the Latin-1 codepoint (0xE9); the
    // server expects the UTF-8 sequence (0xC3 0xA9). Verified value:
    expect(basicAuthHeader('u', 'pässword')).toBe('Basic dTpww6Rzc3dvcmQ=')
  })

  it('supports CJK credentials that would make btoa throw', () => {
    expect(() => btoa('ivan:密码123')).toThrow()
    expect(basicAuthHeader('ivan', '密码123')).toBe('Basic aXZhbjrlr4bnoIExMjM=')
  })

  it('supports emoji credentials', () => {
    expect(basicAuthHeader('a', 'b🎉')).toBe('Basic YTpi8J+OiQ==')
  })

  it('handles a colon inside the password', () => {
    // The colon separates user from pass exactly once; everything after the
    // first colon is the password. Expected value computed the same way the
    // implementation does (TextEncoder + btoa), cross-checked by hand:
    // 'user:pass:word' → UTF-8 bytes → base64.
    const bytes = new TextEncoder().encode('user:pass:word')
    let binary = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    expect(basicAuthHeader('user', 'pass:word')).toBe(`Basic ${btoa(binary)}`)
  })

  it('handles long passwords without exhausting call arguments', () => {
    const long = 'x'.repeat(50_000)
    expect(() => basicAuthHeader('u', long)).not.toThrow()
  })
})
