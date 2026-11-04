import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy } from '../contentSecurityPolicy'

describe('contentSecurityPolicy', () => {
  it('keeps public builds restricted to secure cross-origin connections', () => {
    const policy = contentSecurityPolicy(false)

    expect(policy).toContain("connect-src 'self' https:")
    expect(policy).not.toMatch(/connect-src[^;]*http:/)
  })

  it('allows plain HTTP connections in self-hosted builds', () => {
    const policy = contentSecurityPolicy(true)

    expect(policy).toContain("connect-src 'self' https: http:")
    expect(policy).toContain("default-src 'self'")
    expect(policy).toContain("script-src 'self'")
  })

  it('names extra connect sources (the dev HMR socket) only when given', () => {
    expect(contentSecurityPolicy(true, ['ws://localhost:8080'])).toContain(
      "connect-src 'self' https: http: ws://localhost:8080"
    )
    expect(contentSecurityPolicy(false, ['ws://localhost:8080'])).toContain(
      "connect-src 'self' https: ws://localhost:8080"
    )
    expect(contentSecurityPolicy(true)).not.toContain('ws:')
    expect(contentSecurityPolicy(false)).not.toContain('ws:')
  })
})
