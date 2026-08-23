import { describe, it, expect, afterEach } from 'vitest'
import {
  formatDisplayDate,
  formatMonthYear,
  formatWeekdayLong,
  formatWeekdayShort,
  toLocalDateString,
  toICalUTC,
  addDays,
  daysBetween,
  formatTime,
} from '@/lib/datetime'
import { setLanguage } from '@/lib/i18n'
import type { Language } from '@/types'

const DATE = new Date(2024, 11, 31, 14, 30) // Tuesday, 31 December 2024

async function withLanguage<T>(lang: Language, fn: () => T): Promise<T> {
  await setLanguage(lang)
  return fn()
}

afterEach(async () => {
  await setLanguage('en')
})

describe('locale-aware display formatting', () => {
  it('translates month names', async () => {
    expect(await withLanguage('en', () => formatMonthYear(DATE))).toBe('December 2024')
    expect(await withLanguage('de', () => formatMonthYear(DATE))).toBe('Dezember 2024')
    expect(await withLanguage('da', () => formatMonthYear(DATE))).toBe('december 2024')
  })

  it('translates weekday names', async () => {
    expect(await withLanguage('en', () => formatWeekdayLong(DATE))).toBe('Tuesday')
    expect(await withLanguage('de', () => formatWeekdayLong(DATE))).toBe('Dienstag')
    expect(await withLanguage('da', () => formatWeekdayLong(DATE))).toBe('tirsdag')
  })

  it('translates abbreviated weekday names', async () => {
    expect(await withLanguage('en', () => formatWeekdayShort(DATE))).toBe('Tue')
    expect(await withLanguage('de', () => formatWeekdayShort(DATE))).not.toBe('Tue')
  })
})

/**
 * The load-bearing guarantee of the whole i18n retrofit: `yyyy-MM-dd` is used
 * ~93 times across the app as a storage and routing key — map keys, ICS
 * fields, URL params. If a locale ever leaks into those, stored data breaks.
 */
describe('locale-neutral storage helpers', () => {
  it.each(['en', 'da', 'de'] as const)('toLocalDateString is identical under %s', async (lang) => {
    expect(await withLanguage(lang, () => toLocalDateString(DATE))).toBe('2024-12-31')
  })

  it.each(['en', 'da', 'de'] as const)('toICalUTC is identical under %s', async (lang) => {
    const utc = new Date(Date.UTC(2024, 11, 31, 14, 30, 0))
    expect(await withLanguage(lang, () => toICalUTC(utc))).toBe('20241231T143000Z')
  })

  it.each(['en', 'da', 'de'] as const)('date arithmetic is identical under %s', async (lang) => {
    expect(await withLanguage(lang, () => addDays('2024-12-31', 1))).toBe('2025-01-01')
    expect(await withLanguage(lang, () => daysBetween('2024-12-01', '2024-12-31'))).toBe(30)
  })

  it.each(['en', 'da', 'de'] as const)(
    'an explicit yyyy-MM-dd pattern stays numeric under %s',
    async (lang) => {
      expect(await withLanguage(lang, () => formatDisplayDate(DATE, 'yyyy-MM-dd'))).toBe(
        '2024-12-31'
      )
    }
  )

  it.each(['en', 'da', 'de'] as const)('24-hour time is identical under %s', async (lang) => {
    expect(await withLanguage(lang, () => formatTime(DATE, '24h'))).toBe('14:30')
  })
})
