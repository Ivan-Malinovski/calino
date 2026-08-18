import { describe, it, expect } from 'vitest'
import {
  classifyPendingChangeError,
  backoffDelayMs,
  pendingChangeDropMessage,
} from '../pendingChangePolicy'

/**
 * Build an error the way CalDAVClient.assertResponseOk does: status/body are
 * attached as plain properties on the Error instance.
 */
const statusError = (
  status: number,
  message = `HTTP ${status} failed`,
  body?: string
): Error & { status: number; body?: string } => {
  const err = Object.assign(new Error(message), { status }) as Error & {
    status: number
    body?: string
  }
  if (body !== undefined) err.body = body
  return err
}

describe('classifyPendingChangeError — network failures (no status)', () => {
  it('offline throw → retry (uncounted)', () => {
    expect(
      classifyPendingChangeError(
        new Error('No network connection. Please check your internet connection.'),
        'create'
      )
    ).toEqual({ kind: 'retry' })
  })

  it('TypeError: Failed to fetch → retry (uncounted)', () => {
    expect(classifyPendingChangeError(new TypeError('Failed to fetch'), 'update')).toEqual({
      kind: 'retry',
    })
  })

  it('NetworkError and offline wording (case-insensitive) → retry (uncounted)', () => {
    expect(
      classifyPendingChangeError(new Error('NetworkError: request aborted'), 'delete')
    ).toEqual({ kind: 'retry' })
    expect(classifyPendingChangeError(new Error('you are OFFLINE'), 'move')).toEqual({
      kind: 'retry',
    })
  })

  it('plain Error without a status → retry-counted (preserves today behaviour)', () => {
    expect(classifyPendingChangeError(new Error('Still failing'), 'create')).toEqual({
      kind: 'retry-counted',
    })
  })

  it('non-Error values and non-numeric statuses are treated as status-less', () => {
    expect(classifyPendingChangeError('boom', 'create')).toEqual({ kind: 'retry-counted' })
    expect(
      classifyPendingChangeError(Object.assign(new Error('boom'), { status: '412' }), 'create')
    ).toEqual({ kind: 'retry-counted' })
  })
})

describe('classifyPendingChangeError — 412 stale etag', () => {
  it('412 update → stale-etag', () => {
    expect(classifyPendingChangeError(statusError(412), 'update')).toEqual({
      kind: 'stale-etag',
    })
  })

  it('412 delete → stale-etag', () => {
    expect(classifyPendingChangeError(statusError(412), 'delete')).toEqual({
      kind: 'stale-etag',
    })
  })

  it('412 create → drop with a duplicate message', () => {
    const d = classifyPendingChangeError(
      statusError(412, 'HTTP 412', 'If-Match mismatch'),
      'create'
    )
    expect(d.kind).toBe('drop')
    expect(d.message).toBe(
      `Couldn't create "this event" — already exists on the server — check for a duplicate.`
    )
  })

  it('412 move and delete-href → retry-counted', () => {
    expect(classifyPendingChangeError(statusError(412), 'move')).toEqual({
      kind: 'retry-counted',
    })
    expect(classifyPendingChangeError(statusError(412), 'delete-href')).toEqual({
      kind: 'retry-counted',
    })
  })
})

describe('classifyPendingChangeError — 403 / 401', () => {
  it('403 with a no-uid-conflict body → drop (duplicate UID)', () => {
    const d = classifyPendingChangeError(
      statusError(403, 'HTTP 403', '<C:no-uid-conflict xmlns:C="urn:ietf:params:xml:ns:caldav"/>'),
      'create'
    )
    expect(d.kind).toBe('drop')
    expect(d.message).toContain('duplicate')
  })

  it('403 with a valid-calendar body → drop (invalid data)', () => {
    const d = classifyPendingChangeError(
      statusError(403, 'HTTP 403', 'valid-calendar violation'),
      'update'
    )
    expect(d.kind).toBe('drop')
    expect(d.message).toContain('invalid')
  })

  it('403 without a matching body → drop with permission wording', () => {
    const d = classifyPendingChangeError(statusError(403), 'update')
    expect(d.kind).toBe('drop')
    expect(d.message).toContain('write access')
  })

  it('401 → retry-counted', () => {
    expect(classifyPendingChangeError(statusError(401), 'create')).toEqual({
      kind: 'retry-counted',
    })
  })
})

describe('classifyPendingChangeError — server & other statuses', () => {
  it('507 → drop with quota wording', () => {
    const d = classifyPendingChangeError(statusError(507), 'update')
    expect(d.kind).toBe('drop')
    expect(d.message).toContain('storage is full')
  })

  it('429 → retry-counted', () => {
    expect(classifyPendingChangeError(statusError(429), 'create')).toEqual({
      kind: 'retry-counted',
    })
  })

  it('rate-limit wording on another status → retry-counted', () => {
    expect(classifyPendingChangeError(statusError(400, 'Too many requests'), 'create')).toEqual({
      kind: 'retry-counted',
    })
  })

  it('500 and 503 → retry-counted', () => {
    expect(classifyPendingChangeError(statusError(500), 'create')).toEqual({
      kind: 'retry-counted',
    })
    expect(classifyPendingChangeError(statusError(503), 'delete')).toEqual({
      kind: 'retry-counted',
    })
  })

  it('any other status (400) → retry-counted', () => {
    expect(classifyPendingChangeError(statusError(400), 'update')).toEqual({
      kind: 'retry-counted',
    })
  })
})

describe('classifyPendingChangeError — 404/410', () => {
  it('404 update → drop (resource gone)', () => {
    const d = classifyPendingChangeError(statusError(404), 'update')
    expect(d.kind).toBe('drop')
    expect(d.message).toContain('no longer exists')
  })

  it('404 create → drop (resource gone)', () => {
    const d = classifyPendingChangeError(statusError(404), 'create')
    expect(d.kind).toBe('drop')
    expect(d.message).toContain('no longer exists')
  })

  it('410 update → drop (resource gone)', () => {
    const d = classifyPendingChangeError(statusError(410), 'update')
    expect(d.kind).toBe('drop')
    expect(d.message).toContain('no longer exists')
  })

  it('404 delete falls through to retry-counted (client tolerates it first)', () => {
    expect(classifyPendingChangeError(statusError(404), 'delete')).toEqual({
      kind: 'retry-counted',
    })
  })
})

describe('backoffDelayMs', () => {
  it('doubles from 30s and caps at 30 minutes', () => {
    expect(backoffDelayMs(0)).toBe(30_000)
    expect(backoffDelayMs(1)).toBe(60_000)
    expect(backoffDelayMs(2)).toBe(120_000)
    expect(backoffDelayMs(6)).toBe(1_800_000)
    expect(backoffDelayMs(7)).toBe(1_800_000)
    expect(backoffDelayMs(10)).toBe(1_800_000)
  })

  it('guards negative and non-finite input', () => {
    expect(backoffDelayMs(-1)).toBe(30_000)
    expect(backoffDelayMs(Number.NaN)).toBe(30_000)
    expect(backoffDelayMs(Number.POSITIVE_INFINITY)).toBe(30_000)
  })

  it('uses a server Retry-After as a lower bound on the exponential schedule', () => {
    // retryCount 0 → exponential 30s, but the server asked for 120s.
    expect(backoffDelayMs(0, 120)).toBe(120_000)
    // Larger than the exponential for this retry count too.
    expect(backoffDelayMs(1, 120)).toBe(120_000)
    // When the exponential is already longer, it wins.
    expect(backoffDelayMs(3, 30)).toBe(240_000)
  })

  it('falls back to the exponential schedule when Retry-After is absent or invalid', () => {
    expect(backoffDelayMs(1)).toBe(60_000)
    expect(backoffDelayMs(1, undefined)).toBe(60_000)
    expect(backoffDelayMs(1, Number.NaN)).toBe(60_000)
    expect(backoffDelayMs(1, Number.POSITIVE_INFINITY)).toBe(60_000)
    expect(backoffDelayMs(1, -5)).toBe(60_000)
    expect(backoffDelayMs(1, 0)).toBe(60_000)
  })
})

describe('pendingChangeDropMessage', () => {
  it('uses the title and the per-type verb', () => {
    expect(pendingChangeDropMessage('create', 'Team Sync')).toBe(
      `Couldn't create "Team Sync" — your change is saved locally.`
    )
    expect(pendingChangeDropMessage('update', 'Team Sync')).toBe(
      `Couldn't save "Team Sync" — your change is saved locally.`
    )
    expect(pendingChangeDropMessage('delete', 'Team Sync')).toBe(
      `Couldn't delete "Team Sync" — the event stays on the server.`
    )
    expect(pendingChangeDropMessage('move', 'Team Sync')).toBe(
      `Couldn't move "Team Sync" — the event may still be in its old calendar.`
    )
    expect(pendingChangeDropMessage('delete-href', 'Team Sync')).toBe(
      `Couldn't remove the old copy of "Team Sync" — the event may still be in its old calendar.`
    )
  })

  it('falls back to "this event" when no title is given', () => {
    expect(pendingChangeDropMessage('create')).toBe(
      `Couldn't create "this event" — your change is saved locally.`
    )
    expect(pendingChangeDropMessage('create', '')).toBe(
      `Couldn't create "this event" — your change is saved locally.`
    )
  })

  it('appends a provided reason after " — "', () => {
    expect(pendingChangeDropMessage('update', 'Sync', 'the server exploded.')).toBe(
      `Couldn't save "Sync" — the server exploded.`
    )
  })
})
