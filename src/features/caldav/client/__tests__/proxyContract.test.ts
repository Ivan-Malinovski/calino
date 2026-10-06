import { describe, expect, it } from 'vitest'
import serverSource from '../../../../../proxy/server.mjs?raw'
import corsProxyDoc from '../../../../../docs/CORS_PROXY.md?raw'

// The hosted proxy, the bundled Node proxy and the Worker example in the docs
// are separate copies of one contract. These are the headers Calino's CalDAV
// and JMAP clients rely on; if a copy drops one, JMAP breaks in ways that look
// like a server problem.
const EXPOSED = ['ETag', 'Location', 'X-Target-URL', 'WWW-Authenticate', 'Retry-After']

function constantValue(source: string, name: string): string {
  const match = source.match(new RegExp(`const ${name} =\\s*'([^']+)'`))
  expect(match, `${name} is defined`).not.toBeNull()
  return match![1]
}

function workerExample(): string {
  const doc = corsProxyDoc
  const start = doc.indexOf('**`worker.js`**')
  const end = doc.indexOf('**Usage:**')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return doc.slice(start, end)
}

describe.each([
  ['proxy/server.mjs', () => serverSource],
  ['the Worker example in docs/CORS_PROXY.md', workerExample],
])('proxy contract: %s', (_name, load) => {
  it('allows the request headers the clients send', () => {
    const allowed = constantValue(load(), 'ALLOW_HEADERS')
    for (const header of ['Authorization', 'Content-Type', 'X-Follow-Redirects']) {
      expect(allowed).toContain(header)
    }
  })

  it('allows POST for the JMAP API', () => {
    expect(constantValue(load(), 'ALLOW_METHODS').split(/,\s*/)).toContain('POST')
  })

  it('exposes the response headers the clients read', () => {
    const exposed = constantValue(load(), 'EXPOSE_HEADERS').split(/,\s*/)
    for (const header of EXPOSED) expect(exposed).toContain(header)
  })
})
