import { describe, it, expect, afterEach, vi } from 'vitest'
import { parseDateOnly, getAge, daysUntilNext } from '../contactDates'

afterEach(() => {
  vi.unstubAllEnvs()
})

/**
 * The regression these pin: vCard BDAY is a bare calendar date, and parsing
 * it as `new Date('YYYY-MM-DD')` yields UTC midnight — so in any timezone
 * west of UTC the local calendar day shifts back by one (2000-01-01 becomes
 * Dec 31). All helpers must construct dates from explicit local parts.
 */
describe('contactDates (timezone-safe date-only arithmetic)', () => {
  describe('parseDateOnly', () => {
    it('parses YYYY-MM-DD as a LOCAL date', () => {
      vi.stubEnv('TZ', 'America/New_York')
      const date = parseDateOnly('2000-01-01')
      expect(date?.getFullYear()).toBe(2000)
      expect(date?.getMonth()).toBe(0) // January, NOT December
      expect(date?.getDate()).toBe(1)
    })

    it('parses the compact YYYYMMDD form too', () => {
      vi.stubEnv('TZ', 'America/New_York')
      expect(parseDateOnly('20000701')?.getDate()).toBe(1)
    })

    it('returns null for garbage', () => {
      expect(parseDateOnly('not-a-date')).toBeNull()
    })
  })

  describe('getAge', () => {
    it('gives 25 on the day BEFORE the birthday west of UTC', () => {
      // 2000-07-01, "today" 2026-06-30 local: the birthday has NOT happened
      // yet. The UTC-midnight misparse reads the birthday as Jun 30 and
      // prematurely turns 26.
      vi.stubEnv('TZ', 'America/New_York')
      const today = new Date(2026, 5, 30) // June 30, local
      expect(getAge('2000-07-01', today)).toBe(25)
    })

    it('gives 26 on the birthday itself', () => {
      vi.stubEnv('TZ', 'America/New_York')
      const today = new Date(2026, 6, 1) // July 1, local
      expect(getAge('2000-07-01', today)).toBe(26)
    })

    it('is consistent in UTC', () => {
      vi.stubEnv('TZ', 'UTC')
      expect(getAge('2000-07-01', new Date(2026, 5, 30))).toBe(25)
      expect(getAge('2000-07-01', new Date(2026, 6, 1))).toBe(26)
    })
  })

  describe('daysUntilNext', () => {
    it('counts the day before the anniversary as 1, not 0', () => {
      vi.stubEnv('TZ', 'America/New_York')
      const today = new Date(2026, 5, 30) // June 30, local
      // UTC-misparse reads the birthday as Jun 30 → thisYear == today → 0 days.
      expect(daysUntilNext('2000-07-01', today)).toBe(1)
    })

    it('is 0 on the day itself', () => {
      vi.stubEnv('TZ', 'America/New_York')
      const today = new Date(2026, 6, 1) // July 1, local
      expect(daysUntilNext('2000-07-01', today)).toBe(0)
    })

    it('rolls over to next year after the date has passed', () => {
      vi.stubEnv('TZ', 'America/New_York')
      const today = new Date(2026, 6, 2) // July 2, local
      expect(daysUntilNext('2000-07-01', today)).toBe(364) // 2027-07-01
    })
  })
})
