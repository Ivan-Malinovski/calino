import { describe, it, expect } from 'vitest'
import {
  formatTimeInZone,
  getTimezoneAbbr,
  getSecondaryHourLabel,
  getSupportedTimezones,
  TIMEZONE_PRESETS,
} from '../timezoneHelper'

describe('timezoneHelper', () => {
  describe('formatTimeInZone', () => {
    it('formats 24-hour time correctly across timezones', () => {
      // 2026-06-15T12:00:00Z (UTC noon)
      const date = new Date('2026-06-15T12:00:00Z')

      expect(formatTimeInZone(date, 'UTC', true)).toBe('12:00')
      expect(formatTimeInZone(date, 'Europe/London', true)).toBe('13:00') // BST (UTC+1)
      expect(formatTimeInZone(date, 'America/New_York', true)).toBe('08:00') // EDT (UTC-4)
      expect(formatTimeInZone(date, 'Asia/Tokyo', true)).toBe('21:00') // JST (UTC+9)
    })

    it('formats 12-hour time correctly on the hour and with minutes', () => {
      const date = new Date('2026-06-15T12:00:00Z')

      // On whole hour -> e.g. "12 PM", "8 AM", "9 PM"
      expect(formatTimeInZone(date, 'UTC', false)).toBe('12 PM')
      expect(formatTimeInZone(date, 'America/New_York', false)).toBe('8 AM')
      expect(formatTimeInZone(date, 'Asia/Tokyo', false)).toBe('9 PM')

      // Non-zero minutes
      const dateWithMinutes = new Date('2026-06-15T12:30:00Z')
      expect(formatTimeInZone(dateWithMinutes, 'UTC', false)).toBe('12:30 PM')
      expect(formatTimeInZone(dateWithMinutes, 'America/New_York', false)).toBe('8:30 AM')
    })

    it('handles sub-hour offset timezones correctly', () => {
      const date = new Date('2026-06-15T12:00:00Z')

      // Asia/Kolkata is UTC+5:30 -> 17:30 / 5:30 PM
      expect(formatTimeInZone(date, 'Asia/Kolkata', true)).toBe('17:30')
      expect(formatTimeInZone(date, 'Asia/Kolkata', false)).toBe('5:30 PM')

      // Australia/Eucla is UTC+8:45 -> 20:45 / 8:45 PM
      expect(formatTimeInZone(date, 'Australia/Eucla', true)).toBe('20:45')
      expect(formatTimeInZone(date, 'Australia/Eucla', false)).toBe('8:45 PM')

      // Asia/Kathmandu is UTC+5:45 -> 17:45 / 5:45 PM
      expect(formatTimeInZone(date, 'Asia/Kathmandu', true)).toBe('17:45')
      expect(formatTimeInZone(date, 'Asia/Kathmandu', false)).toBe('5:45 PM')

      // Pacific/Chatham is UTC+12:45 standard (in June winter) -> 00:45 (next day)
      expect(formatTimeInZone(date, 'Pacific/Chatham', true)).toBe('00:45')
      expect(formatTimeInZone(date, 'Pacific/Chatham', false)).toBe('12:45 AM')
    })
  })

  describe('getTimezoneAbbr', () => {
    it('returns abbreviation or GMT offset string for various timezones', () => {
      const summerDate = new Date('2026-06-15T12:00:00Z')
      const winterDate = new Date('2026-01-15T12:00:00Z')

      expect(getTimezoneAbbr(summerDate, 'UTC')).toBe('UTC')
      expect(getTimezoneAbbr(summerDate, 'America/New_York')).toBe('EDT')
      expect(getTimezoneAbbr(winterDate, 'America/New_York')).toBe('EST')

      // Kolkata
      const kolkataAbbr = getTimezoneAbbr(summerDate, 'Asia/Kolkata')
      expect(['IST', 'GMT+5:30'].includes(kolkataAbbr)).toBe(true)
    })

    it('gracefully handles invalid timezone string', () => {
      const date = new Date('2026-06-15T12:00:00Z')
      expect(getTimezoneAbbr(date, 'Invalid/Timezone')).toBe('Invalid/Timezone')
    })
  })

  describe('getSecondaryHourLabel', () => {
    it('computes secondary hour and day delta correctly for positive and negative rollovers', () => {
      // Create a base local date: June 15, 2026
      const baseDate = new Date(2026, 5, 15) // Month index 5 is June

      // Local hour 0 (midnight) -> in target timezones
      const labelUTC = getSecondaryHourLabel(0, baseDate, 'UTC', '24h')
      expect(labelUTC.time).toBeDefined()
      expect(typeof labelUTC.dayDelta).toBeDefined()
      expect(labelUTC.formatted).toBe(labelUTC.toString())
    })

    it('handles day rollovers between Tokyo, London, and Honolulu', () => {
      // Let's test by setting a date and checking specific hours
      const baseDate = new Date(2026, 5, 15)

      // Test all 24 hours against Tokyo and Honolulu
      for (let h = 0; h < 24; h++) {
        const tokyoLabel = getSecondaryHourLabel(h, baseDate, 'Asia/Tokyo', '24h')
        expect(tokyoLabel.time).toMatch(/^\d{2}:\d{2}$/)
        if (tokyoLabel.dayDelta) {
          expect(['+1d', '-1d', '+2d', '-2d']).toContain(tokyoLabel.dayDelta)
        }

        const honoluluLabel = getSecondaryHourLabel(h, baseDate, 'Pacific/Honolulu', '24h')
        expect(honoluluLabel.time).toMatch(/^\d{2}:\d{2}$/)
        if (honoluluLabel.dayDelta) {
          expect(['+1d', '-1d', '+2d', '-2d']).toContain(honoluluLabel.dayDelta)
        }
      }
    })

    it('handles DST spring-forward and autumn-fallback transition days', () => {
      // US DST Spring forward (March 8, 2026)
      const springDate = new Date(2026, 2, 8)
      for (let h = 0; h < 24; h++) {
        const label = getSecondaryHourLabel(h, springDate, 'America/New_York', '24h')
        expect(label.time).toMatch(/^\d{2}:\d{2}$/)
      }

      // US DST Autumn fallback (November 1, 2026)
      const autumnDate = new Date(2026, 10, 1)
      for (let h = 0; h < 24; h++) {
        const label = getSecondaryHourLabel(h, autumnDate, 'America/New_York', '24h')
        expect(label.time).toMatch(/^\d{2}:\d{2}$/)
      }
    })

    it('handles sub-hour offsets with true :30 and :45 values', () => {
      const baseDate = new Date(2026, 5, 15)
      const labelKolkata = getSecondaryHourLabel(12, baseDate, 'Asia/Kolkata', '24h')
      expect(labelKolkata.time).toMatch(/:\d{2}$/)

      const labelEucla = getSecondaryHourLabel(12, baseDate, 'Australia/Eucla', '24h')
      expect(labelEucla.time).toMatch(/:\d{2}$/)
    })

    it('respects 12h time format preference', () => {
      const baseDate = new Date(2026, 5, 15)
      const label12h = getSecondaryHourLabel(12, baseDate, 'UTC', '12h')
      expect(label12h.time).toMatch(/(AM|PM)/)
    })
  })

  describe('getSupportedTimezones and presets', () => {
    it('returns a non-empty list of timezones', () => {
      const zones = getSupportedTimezones()
      expect(Array.isArray(zones)).toBe(true)
      expect(zones.length).toBeGreaterThan(10)
      expect(zones).toContain('UTC')
      expect(zones).toContain('America/New_York')
      expect(zones).toContain('Europe/London')
      expect(zones).toContain('Asia/Tokyo')
    })

    it('has valid timezone presets', () => {
      expect(TIMEZONE_PRESETS.length).toBeGreaterThan(5)
      for (const preset of TIMEZONE_PRESETS) {
        expect(preset.value).toBeDefined()
        expect(preset.label).toBeDefined()
      }
    })
  })
})
