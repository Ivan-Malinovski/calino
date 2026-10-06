import { describe, expect, it } from 'vitest'
import type { JSCalendarObject } from '../../types'
import { applyJmapPatch, diffJscalendar } from '../icsToJscalendar'

describe('diffJscalendar', () => {
  it('returns no patch for equivalent objects, regardless of property order', () => {
    expect(
      diffJscalendar(
        { title: 'A', locations: { l0: { name: 'B', '@type': 'Location' } } },
        { locations: { l0: { '@type': 'Location', name: 'B' } }, title: 'A' }
      )
    ).toEqual({})
  })
  it('recurses through nested maps and escapes slash and tilde keys', () => {
    const before = {
      participants: { 'p/~': { name: 'A', roles: { attendee: true } } },
      recurrenceOverrides: {
        '2026-10-10T10:00:00': { 'locations/a~b/name': 'Old' },
      },
    }
    const after = {
      participants: { 'p/~': { name: 'B', roles: { attendee: true } } },
      recurrenceOverrides: {
        '2026-10-10T10:00:00': { 'locations/a~b/name': 'New' },
      },
    }
    const patch = diffJscalendar(before, after)
    expect(patch).toEqual({
      'participants/p~1~0/name': 'B',
      'recurrenceOverrides/2026-10-10T10:00:00/locations~1a~0b~1name': 'New',
    })
    expect(applyJmapPatch(before, patch)).toEqual(after)
    expect(before.participants['p/~'].name).toBe('A')
  })
  it('replaces arrays and recurrenceRule atomically', () => {
    const before = {
      recurrenceRule: { frequency: 'weekly', count: 4 },
      values: [1, 2],
    }
    const after = {
      recurrenceRule: { frequency: 'weekly', count: 5 },
      values: [1, 3],
    }
    expect(diffJscalendar(before, after)).toEqual(after)
    expect(applyJmapPatch(before, diffJscalendar(before, after))).toEqual(after)
  })
  it('adds and removes whole map entries without invalid child paths', () => {
    const before = { alerts: { a0: { action: 'display' } }, title: 'Old' }
    const after = { alerts: { a1: { action: 'email' } } }
    expect(diffJscalendar(before, after)).toEqual({
      'alerts/a0': null,
      'alerts/a1': { action: 'email' },
      title: null,
    })
    expect(applyJmapPatch(before, diffJscalendar(before, after))).toEqual(after)
  })
  it('protects server metadata and patches calendarIds only when changed', () => {
    expect(
      diffJscalendar(
        {
          id: '1',
          created: 'a',
          updated: 'a',
          isOrigin: true,
          isDraft: true,
          calendarIds: { b: true },
        },
        {
          id: '2',
          created: 'b',
          updated: 'b',
          isOrigin: false,
          isDraft: false,
          calendarIds: { c: true },
        }
      )
    ).toEqual({ 'calendarIds/b': null, 'calendarIds/c': true })
    expect(
      diffJscalendar({ id: '1', calendarIds: { b: true } }, { calendarIds: { b: true } })
    ).toEqual({})
  })
  it('replaces an enclosing object to introduce literal null', () => {
    const before = { locations: { l0: { name: 'A', timeZone: 'UTC' } } }
    const after = { locations: { l0: { name: 'A', timeZone: null } } }
    expect(diffJscalendar(before, after)).toEqual({
      'locations/l0': after.locations.l0,
    })
    expect(applyJmapPatch(before, diffJscalendar(before, after))).toEqual(after)
  })
  it('treats a root null as deletion, as required by JMAP', () => {
    expect(
      applyJmapPatch({ timeZone: 'UTC' }, diffJscalendar({ timeZone: 'UTC' }, { timeZone: null }))
    ).toEqual({})
  })
  it('rejects missing parents, malformed escapes, arrays and overlapping paths', () => {
    expect(() => applyJmapPatch({}, { 'a/b': 1 })).toThrow()
    expect(() => applyJmapPatch({}, { 'a~2': 1 })).toThrow()
    expect(() => applyJmapPatch({ a: [1] }, { 'a/0': 2 })).toThrow()
    expect(() => applyJmapPatch({ a: {} }, { a: {}, 'a/b': 1 })).toThrow()
  })
  it('handles special property names without touching prototypes', () => {
    const before = JSON.parse('{"keywords":{"__proto__":true}}') as JSCalendarObject
    const after = JSON.parse(
      '{"keywords":{"__proto__":true,"constructor":true}}'
    ) as JSCalendarObject
    expect(applyJmapPatch(before, diffJscalendar(before, after))).toEqual(after)
    expect({}.constructor).toBe(Object)
  })
  it('round-trips deterministic combinations of nested additions, removals and changes', () => {
    const objects: JSCalendarObject[] = [
      {},
      { title: 'A' },
      { title: 'B', duration: 'PT1H' },
      { locations: { a: { '@type': 'Location', name: 'Café' } } },
      {
        alerts: {
          a0: {
            '@type': 'Alert',
            trigger: { '@type': 'OffsetTrigger', offset: '-PT5M' },
          },
        },
      },
      {
        recurrenceOverrides: {
          '2026-10-10T10:00:00': {},
          '2026-10-17T10:00:00': { excluded: true },
        },
      },
      { recurrenceRule: { frequency: 'weekly', byDay: [{ day: 'mo' }] } },
    ]
    for (const before of objects)
      for (const after of objects)
        expect(applyJmapPatch(before, diffJscalendar(before, after))).toEqual(after)
  })
})
