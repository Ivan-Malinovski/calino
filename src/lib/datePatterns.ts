/**
 * Word-order overrides for display date patterns.
 *
 * date-fns localizes month and weekday *names* but keeps the pattern's word
 * order, so the English pattern `'MMMM yyyy'` renders as "十一月 2026" in
 * Chinese, where a reader expects "2026年11月". Each entry below maps one
 * exact display pattern to a replacement for one language.
 *
 * Only *display* patterns belong here. A pattern with no entry — and every
 * language without an entry — formats exactly as before, so storage patterns
 * (`'yyyy-MM-dd'`, `'HH:mm'`, ICS fields, map keys) are never reordered.
 */
import { currentLanguage } from '@/lib/i18n'
import type { Language } from '@/types'

const ZH_PATTERNS: Readonly<Record<string, string>> = {
  // Month and year: year first.
  'MMMM yyyy': 'yyyy年M月',
  'MMM yyyy': 'yyyy年M月',

  // A month on its own is numeric in Chinese calendar UI ("11月", not "十一月").
  MMMM: 'M月',
  MMM: 'M月',

  // Month and day: no space, one 日 suffix.
  'MMMM d': 'M月d日',
  'MMM d': 'M月d日',
  'd MMM': 'M月d日',
  'MMMM d, yyyy': 'yyyy年M月d日',
  'MMM d, yyyy': 'yyyy年M月d日',
  'd MMM yyyy': 'yyyy年M月d日',

  // Date and weekday: the date reads first, the weekday trails it.
  'EEE MMM d': 'M月d日 EEE',
  'EEE d MMM': 'M月d日 EEE',
  'EEE, MMM d': 'M月d日 EEE',
  'EEE, d MMM': 'M月d日 EEE',
  'EEE, MMMM d': 'M月d日 EEEE',
  'EEEE, MMMM d': 'M月d日 EEEE',
  'EEEE d MMMM': 'M月d日 EEEE',
  'EEEE, MMMM d, yyyy': 'yyyy年M月d日 EEEE',
  'EEEE, d MMMM yyyy': 'yyyy年M月d日 EEEE',
  'EEE, d MMM yyyy': 'yyyy年M月d日 EEE',

  // Date and time: same day order, and a 12-hour clock puts 上午/下午 first.
  'MMM d, yyyy HH:mm': 'yyyy年M月d日 HH:mm',
  'MMM d, yyyy h:mm a': 'yyyy年M月d日 ah:mm',
  'd MMM yyyy, HH:mm': 'yyyy年M月d日 HH:mm',
  'd MMM yyyy, h:mm a': 'yyyy年M月d日 ah:mm',
  'EEE, d MMM yyyy, HH:mm': 'yyyy年M月d日 EEE HH:mm',
  'EEE, MMM d · h:mm a': 'M月d日 EEE · ah:mm',

  // Time only.
  'h:mm a': 'ah:mm',
  'h a': 'ah',
}

const PATTERN_OVERRIDES: Partial<Record<Language, Readonly<Record<string, string>>>> = {
  zh: ZH_PATTERNS,
}

/**
 * The pattern to actually format with, in the active UI language.
 *
 * Returns `pattern` unchanged unless that language has an ordering of its own
 * for it.
 */
export function localizeDisplayPattern(pattern: string): string {
  return PATTERN_OVERRIDES[currentLanguage()]?.[pattern] ?? pattern
}

/**
 * True when the active language writes the year before the month.
 *
 * Some headings are two separate elements (a large month, a small year) so
 * they can be styled apart; in those languages the pair has to be flipped.
 */
export function yearComesFirst(): boolean {
  return currentLanguage() === 'zh'
}

/**
 * The pattern for the end of a range that spans one month: "Nov 2 – 8" reads
 * fine in English, but Chinese names the month once at the start, so the day
 * needs its own unit there: "11月2日 – 8日".
 */
export function dayRangeEndPattern(): string {
  return yearComesFirst() ? 'd日' : 'd'
}
