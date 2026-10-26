import { describe, it, expect } from 'vitest'
import { format, parseISO } from 'date-fns'
import {
  deviceTimezone,
  parseWallClock,
  toEventInstant,
  toZoneWallClock,
  zonedDayKey,
  zonedMidnight,
  zonedMinutes,
} from '../datetime'

describe('toEventInstant (Phase 2 C2)', () => {
  it('resolves a naive wall clock in the event zone', () => {
    // 02:30 America/New_York (EST) = 07:30Z. Zone-independent assertion.
    const d = toEventInstant('2024-02-10T02:30:00', 'America/New_York')
    expect(d.toISOString()).toBe('2024-02-10T07:30:00.000Z')
  })
  it('normalizes a Windows TZID before resolving a naive wall clock', () => {
    const d = toEventInstant('2025-10-28T19:30:00', 'W. Europe Standard Time')
    expect(d.toISOString()).toBe('2025-10-28T18:30:00.000Z')
  })
  it('treats a Z string as an instant regardless of timezone', () => {
    const d = toEventInstant('2024-03-10T07:30:00.000Z', 'America/New_York')
    expect(d.toISOString()).toBe('2024-03-10T07:30:00.000Z')
  })
  it('falls back to a device-local parse without a timezone', () => {
    const d = toEventInstant('2024-03-10T02:30:00')
    expect(d.getTime()).toBe(parseISO('2024-03-10T02:30:00').getTime())
  })
  it('does not throw on an unresolvable zone; falls back to device-local', () => {
    expect(() => toEventInstant('2024-03-10T02:30:00', 'Not/AZone')).not.toThrow()
    const d = toEventInstant('2024-03-10T02:30:00', 'Not/AZone')
    expect(d.getTime()).toBe(parseISO('2024-03-10T02:30:00').getTime())
  })
})

describe('toZoneWallClock (Phase 2 C3)', () => {
  it('converts a Z instant to the zone naive wall clock', () => {
    // 07:30Z = 02:30 EST (before US spring-forward Mar 10 2024 07:00 local).
    expect(toZoneWallClock('2024-02-10T07:30:00.000Z', 'America/New_York')).toBe(
      '2024-02-10T02:30:00'
    )
  })
  it('handles a date after spring-forward (EDT)', () => {
    // 2024-07-01T16:00:00Z = 12:00 EDT.
    expect(toZoneWallClock('2024-07-01T16:00:00.000Z', 'America/New_York')).toBe(
      '2024-07-01T12:00:00'
    )
  })
  it('passes a naive string through unchanged', () => {
    expect(toZoneWallClock('2024-03-10T02:30:00', 'America/New_York')).toBe('2024-03-10T02:30:00')
  })
  it('does not throw on an unresolvable zone; strips the zone marker', () => {
    expect(() => toZoneWallClock('2024-03-10T07:30:00.000Z', 'Not/AZone')).not.toThrow()
  })
})

describe('zoned wall clock', () => {
  it('matches local day and minutes when the zone is the runtime zone', () => {
    const instant = new Date('2026-07-08T09:00:00.000Z')
    const zone = deviceTimezone()
    expect(zonedDayKey(instant, zone)).toBe(format(instant, 'yyyy-MM-dd'))
    expect(zonedMinutes(instant, zone)).toBe(instant.getHours() * 60 + instant.getMinutes())
  })

  it('reads a London summer wall clock from a UTC instant', () => {
    const instant = new Date('2026-07-08T09:00:00.000Z')
    expect(zonedDayKey(instant, 'Europe/London')).toBe('2026-07-08')
    expect(zonedMinutes(instant, 'Europe/London')).toBe(10 * 60)
  })

  it('parses a London summer wall clock back to the UTC instant', () => {
    expect(parseWallClock('2026-07-08T10:00:00', 'Europe/London').toISOString()).toBe(
      '2026-07-08T09:00:00.000Z'
    )
  })
})

describe('zonedMidnight', () => {
  it('round-trips a day whose zone skips 00:00', () => {
    for (const [zone, day] of [
      ['America/Santiago', '2026-09-06'],
      ['America/Havana', '2026-03-08'],
      ['Asia/Beirut', '2026-03-29'],
    ] as const) {
      expect(zonedDayKey(zonedMidnight(day, zone), zone)).toBe(day)
    }
  })

  it('still round-trips a zone that does not skip 00:00', () => {
    expect(zonedDayKey(zonedMidnight('2026-03-29', 'Europe/London'), 'Europe/London')).toBe(
      '2026-03-29'
    )
    expect(zonedMidnight('2026-07-08', 'Europe/London').toISOString()).toBe(
      '2026-07-07T23:00:00.000Z'
    )
  })
})
