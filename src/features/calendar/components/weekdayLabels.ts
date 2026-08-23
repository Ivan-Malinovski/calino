import { formatDisplayDate } from '@/lib/datetime'

/**
 * Weekday and month names in the active UI language.
 *
 * These used to be hardcoded English arrays duplicated across four files. They
 * are derived from date-fns locale data instead, so they follow the language
 * automatically. Week *start* still comes from the user's `firstDayOfWeek`
 * setting, not from the locale — Calino lets that be chosen explicitly.
 */

// 2024-01-07 was a Sunday, so index 0..6 maps to Sunday..Saturday.
const SUNDAY = new Date(2024, 0, 7)

function weekdayDate(index: number): Date {
  return new Date(2024, 0, 7 + index)
}

function monthDate(index: number): Date {
  return new Date(2024, index, 1)
}

/** Abbreviated weekday names, rotated so index 0 is `firstDayOfWeek`. */
export function getWeekdayLabels(firstDayOfWeek: number): string[] {
  const labels: string[] = []
  for (let i = 0; i < 7; i++) {
    labels.push(formatDisplayDate(weekdayDate((i + firstDayOfWeek) % 7), 'EEE'))
  }
  return labels
}

/** Full weekday names, in Sunday-first order (index 0 = Sunday). */
export function getFullWeekdayNames(): string[] {
  return Array.from({ length: 7 }, (_, i) => formatDisplayDate(weekdayDate(i), 'EEEE'))
}

/** Full month names, January first. */
export function getMonthNames(): string[] {
  return Array.from({ length: 12 }, (_, i) => formatDisplayDate(monthDate(i), 'MMMM'))
}

/** Abbreviated month names, January first. */
export function getShortMonthNames(): string[] {
  return Array.from({ length: 12 }, (_, i) => formatDisplayDate(monthDate(i), 'MMM'))
}

/** Single-letter-ish minimal weekday names, rotated to `firstDayOfWeek`. */
export function getNarrowWeekdayLabels(firstDayOfWeek: number): string[] {
  const labels: string[] = []
  for (let i = 0; i < 7; i++) {
    labels.push(formatDisplayDate(weekdayDate((i + firstDayOfWeek) % 7), 'EEEEE'))
  }
  return labels
}

export { SUNDAY as WEEKDAY_EPOCH }
