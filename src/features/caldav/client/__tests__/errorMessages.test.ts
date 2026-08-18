import { describe, it, expect } from 'vitest'
import {
  classifySyncError,
  connectionErrorMessage,
  shortSyncErrorMessage,
  syncErrorReason,
} from '../errorMessages'

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
    // Deliberate flip: 403 is no longer lumped into 'auth' — the credentials
    // were accepted, the server refused the operation (usually no write access).
    ['403 Forbidden', 'forbidden'],
    ['Server returned status 403', 'forbidden'],
    ['Unauthorized', 'auth'],
    ['Server returned status 507', 'quota'],
    ['Insufficient storage', 'quota'],
    ['Server returned status 429', 'rate-limited'],
    ['Too Many Requests', 'rate-limited'],
    ['Rate limit exceeded', 'rate-limited'],
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

  it('keeps 403 distinct from 401 when a 403 arrives via fetch', () => {
    expect(classifySyncError('Failed to fetch: 403 Forbidden')).toBe('forbidden')
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

  it('names full storage on a 507', () => {
    expect(connectionErrorMessage('Server returned status 507')).toMatch(/full|free up space/i)
  })

  it('names rate limiting on a 429', () => {
    expect(connectionErrorMessage('Server returned status 429')).toMatch(/rate-limiting/i)
  })
})

describe('syncErrorReason', () => {
  it('omits the subject so callers can write their own sentence', () => {
    const reason = syncErrorReason('network', 'Failed to fetch')

    expect(reason).not.toMatch(/^sync failed/i)
    expect(reason).toMatch(/^couldn't reach/i)
    // The Sidebar composes exactly this.
    expect(`Renamed locally, but the server didn't get it: ${reason}`).not.toContain('Sync failed')
  })

  it('stays in step with shortSyncErrorMessage', () => {
    for (const code of [
      'cors',
      'network',
      'timeout',
      'auth',
      'forbidden',
      'quota',
      'rate-limited',
      'server',
    ] as const) {
      expect(shortSyncErrorMessage(code, 'raw')).toBe(
        `Sync failed: ${syncErrorReason(code, 'raw')}`
      )
    }
  })

  it('falls back to the raw message when it has nothing better', () => {
    expect(syncErrorReason('unknown', 'Disk quota exceeded')).toBe('Disk quota exceeded')
  })

  it('explains a 403 as a write-access refusal', () => {
    expect(syncErrorReason('forbidden', 'raw')).toMatch(/write access/i)
  })
})

describe('connectionErrorMessage with a known code', () => {
  it('trusts an explicit code over the message text', () => {
    // The message mentions "fetch", which would classify as network; the code
    // says otherwise and must win.
    expect(connectionErrorMessage('failed to fetch principal', 'auth')).toMatch(/credential/i)
  })
})
