import { describe, it, expect } from 'vitest'
import ICAL from 'ical.js'
import {
  normalizeTzid,
  ensureZoneRegistered,
  ensureZoneRegisteredAsync,
  resolveZone,
} from '../timezoneRegistry'

describe('timezoneRegistry', () => {
  describe('normalizeTzid', () => {
    it('maps Windows zone IDs to IANA', () => {
      expect(normalizeTzid('W. Europe Standard Time')).toBe('Europe/Berlin')
      expect(normalizeTzid('Eastern Standard Time')).toBe('America/New_York')
      expect(normalizeTzid('GMT Standard Time')).toBe('Europe/London')
      expect(normalizeTzid('India Standard Time')).toBe('Asia/Calcutta')
    })
    it('is case-insensitive for Windows IDs', () => {
      expect(normalizeTzid('w. europe standard time')).toBe('Europe/Berlin')
    })
    it('maps bare UTC/GMT/Z to UTC', () => {
      expect(normalizeTzid('UTC')).toBe('UTC')
      expect(normalizeTzid('GMT')).toBe('UTC')
      expect(normalizeTzid('Z')).toBe('UTC')
    })
    it('leaves IANA IDs untouched', () => {
      expect(normalizeTzid('Europe/Copenhagen')).toBe('Europe/Copenhagen')
      expect(normalizeTzid('America/New_York')).toBe('America/New_York')
    })
  })

  describe('ensureZoneRegistered / resolveZone', () => {
    it('registers an IANA zone whose Timezone carries a VTIMEZONE component', async () => {
      expect(await ensureZoneRegisteredAsync('Europe/Copenhagen')).toBe(true)
      // Synchronous callers retain their existing behavior once the zone has
      // been loaded by an async preload.
      expect(ensureZoneRegistered('Europe/Copenhagen')).toBe(true)
      const zone = resolveZone('Europe/Copenhagen')
      expect(zone).toBeDefined()
      expect(zone!.tzid).toBe('Europe/Copenhagen')
      expect(zone!.component?.name).toBe('vtimezone')
    })
    it('the registered zone knows DST: wall 10:00 is 09:00Z in March and 08:00Z in June', async () => {
      await ensureZoneRegisteredAsync('Europe/Copenhagen')
      const zone = resolveZone('Europe/Copenhagen')
      expect(zone).toBeDefined()
      const march = ICAL.Time.fromData({
        year: 2026,
        month: 3,
        day: 25,
        hour: 10,
        minute: 0,
        second: 0,
        zone: zone as never,
      })
      const june = ICAL.Time.fromData({
        year: 2026,
        month: 6,
        day: 1,
        hour: 10,
        minute: 0,
        second: 0,
        zone: zone as never,
      })
      expect(new Date(march.toJSDate().toISOString()).getUTCHours()).toBe(9)
      expect(new Date(june.toJSDate().toISOString()).getUTCHours()).toBe(8)
    })
    it('resolves Windows IDs to a registered zone', async () => {
      await ensureZoneRegisteredAsync('W. Europe Standard Time')
      const zone = resolveZone('W. Europe Standard Time')
      expect(zone).toBeDefined()
      expect(zone!.tzid).toBe('Europe/Berlin')
    })
    it('returns the UTC zone for UTC', () => {
      expect(ensureZoneRegistered('UTC')).toBe(true)
      expect(resolveZone('UTC')).toBeDefined()
    })
    it('returns false/undefined for unknown zones without throwing', () => {
      expect(ensureZoneRegistered('Not/AZone')).toBe(false)
      expect(resolveZone('Not/AZone')).toBeUndefined()
    })
  })
})
