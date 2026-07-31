import { describe, it, expect } from 'vitest'
import { pendingGuardedEventIds } from '../pendingChanges'
import type { PendingChange } from '../../types'

function change(overrides: Partial<PendingChange>): PendingChange {
  return {
    id: 'pc-1',
    type: 'update',
    eventId: 'event-1',
    calendarId: 'cal-1',
    timestamp: '2026-07-31T09:00:00.000Z',
    retryCount: 0,
    ...overrides,
  }
}

describe('pendingGuardedEventIds', () => {
  it('guards the event id of ordinary changes', () => {
    const ids = pendingGuardedEventIds([
      change({ eventId: 'a', type: 'update' }),
      change({ eventId: 'b', type: 'delete' }),
      change({ eventId: 'c', type: 'create' }),
    ])
    expect(ids).toEqual(new Set(['a', 'b', 'c']))
  })

  it('guards every member of a queued move, not just the master', () => {
    const ids = pendingGuardedEventIds([
      change({
        eventId: 'series',
        type: 'move',
        data: JSON.stringify({
          events: [{ id: 'series' }, { id: 'series-override-1' }],
          sourceCalendarId: 'cal-personal',
          sourceHref: 'https://dav.example/personal/series.ics',
        }),
      }),
    ])
    expect(ids).toEqual(new Set(['series', 'series-override-1']))
  })

  it('guards every member named by a delete-href cleanup', () => {
    // Until the stale source resource is gone, a sync could otherwise re-import
    // it and put the event back in its old calendar.
    const ids = pendingGuardedEventIds([
      change({
        eventId: 'series',
        type: 'delete-href',
        calendarId: 'cal-personal',
        data: JSON.stringify({
          href: 'https://dav.example/personal/series.ics',
          memberIds: ['series', 'series-override-1'],
        }),
      }),
    ])
    expect(ids).toEqual(new Set(['series', 'series-override-1']))
  })

  it('falls back to the master id when the payload is malformed', () => {
    const ids = pendingGuardedEventIds([
      change({ eventId: 'series', type: 'move', data: 'not json' }),
    ])
    expect(ids).toEqual(new Set(['series']))
  })

  it('tolerates a payload missing its members', () => {
    const ids = pendingGuardedEventIds([
      change({ eventId: 'series', type: 'delete-href', data: JSON.stringify({ href: 'x' }) }),
      change({ eventId: 'other', type: 'move', data: JSON.stringify({}) }),
    ])
    expect(ids).toEqual(new Set(['series', 'other']))
  })

  it('returns an empty set for no changes', () => {
    expect(pendingGuardedEventIds([])).toEqual(new Set())
  })
})
