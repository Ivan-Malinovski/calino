import { describe, it, expect } from 'vitest'
import { classifySyncError, connectionErrorMessage, shortSyncErrorMessage } from '../errorMessages'

describe('classifySyncError', () => {
  it.each([
    ['CORS policy blocked the request', 'cors'],
    ['cross-origin request rejected', 'cors'],
    ['Response to preflight request does not pass', 'cors'],
    // Previously dead: the old ladder tested a mixed-case needle against an
    // already-lowercased haystack, so no NetworkError ever matched.
    ['NetworkError when attempting to fetch resource', 'network'],
    ['TypeError: Failed to fetch', 'network'],
    ['AbortError: The operation was aborted.', 'timeout'],
    ['Request timed out after 15000ms', 'timeout'],
    ['Server returned status 401', 'auth'],
    ['403 Forbidden', 'auth'],
    ['Unauthorized', 'auth'],
    ['Calendar not found: abc', 'not-found'],
    ['Server returned status 404', 'not-found'],
    ['412 Precondition Failed', 'conflict'],
    ['If-Match check failed', 'conflict'],
    ['Server returned status 500', 'server'],
    ['503 Service Unavailable', 'server'],
    ['something else entirely', 'unknown'],
  ] as const)('classifies %j as %s', (message, expected) => {
    expect(classifySyncError(message)).toBe(expected)
  })

  it('prefers auth over network when a 401 arrives via fetch', () => {
    expect(classifySyncError('Failed to fetch: 401 Unauthorized')).toBe('auth')
  })

  it('does not read a version number as a 5xx status', () => {
    expect(classifySyncError('tsdav 2.0.5 failed')).toBe('unknown')
  })
})

describe('shortSyncErrorMessage', () => {
  it('defaults the subject to Sync', () => {
    expect(shortSyncErrorMessage('auth', 'raw')).toMatch(/^Sync failed:/)
  })

  it('takes a caller-supplied subject', () => {
    expect(shortSyncErrorMessage('cors', 'raw', 'Settings sync')).toMatch(/^Settings sync failed:/)
  })

  it('falls back to the raw message only for unknown', () => {
    expect(shortSyncErrorMessage('unknown', 'kaboom')).toContain('kaboom')
    expect(shortSyncErrorMessage('auth', 'kaboom')).not.toContain('kaboom')
  })
})

describe('connectionErrorMessage', () => {
  it('never leaks the raw exception for a failed probe', () => {
    // What probeConnection actually produces when a browser blocks the request.
    const raw =
      'Connection failed: TypeError: Failed to fetch. This may be a CORS issue - the server must allow cross-origin requests.'
    const text = connectionErrorMessage(raw)

    expect(text).not.toContain('TypeError')
    expect(text).not.toContain('Failed to fetch')
    // Both causes are indistinguishable to a browser, so name both.
    expect(text).toMatch(/offline|reach/i)
  })

  it('names credentials rather than CORS on a 401', () => {
    expect(connectionErrorMessage('Server returned status 401')).toMatch(/credential/i)
  })

  it('passes through a message it cannot improve on', () => {
    expect(connectionErrorMessage('Master password required')).toBe('Master password required')
  })
})
