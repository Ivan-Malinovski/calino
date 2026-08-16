import { describe, it, expect } from 'vitest'
import { parseISO } from 'date-fns'
import { toEventInstant, toZoneWallClock } from '../datetime'

describe('toEventInstant (Phase 2 C2)', () => {
  it('resolves a naive wall clock in the event zone', () => {
    // 02:30 America/New_York (EST) = 07:30Z. Zone-independent assertion.
    const d = toEventInstant('2024-02-10T02:30:00', 'America/New_York')
    expect(d.toISOString()).toBe('2024-02-10T07:30:00.000Z')
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
    expect(toZoneWallClock('2024-02-10T07:30:00.000Z', 'America/New_York')).toBe('2024-02-10T02:30:00')
  })
  it('handles a date after spring-forward (EDT)', () => {
    // 2024-07-01T16:00:00Z = 12:00 EDT.
    expect(toZoneWallClock('2024-07-01T16:00:00.000Z', 'America/New_York')).toBe('2024-07-01T12:00:00')
  })
  it('passes a naive string through unchanged', () => {
    expect(toZoneWallClock('2024-03-10T02:30:00', 'America/New_York')).toBe('2024-03-10T02:30:00')
  })
  it('does not throw on an unresolvable zone; strips the zone marker', () => {
    expect(() => toZoneWallClock('2024-03-10T07:30:00.000Z', 'Not/AZone')).not.toThrow()
  })
})