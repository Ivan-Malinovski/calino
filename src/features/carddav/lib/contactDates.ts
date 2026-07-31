/**
 * Date-only helpers for contact birthdays / anniversaries.
 *
 * The vCard BDAY value is a calendar DATE (RFC 6350 §6.2.5) with no time or
 * zone. Parsing it with `new Date('YYYY-MM-DD')` is a trap: JavaScript reads
 * that string as UTC midnight, so `.getMonth()` / `.getDate()` in a
 * timezone west of UTC shift the date back a day (2000-01-01 becomes
 * December 31). All arithmetic here must therefore construct the Date from
 * explicit local parts.
 */

/** Parse `YYYY-MM-DD` or `YYYYMMDD` into a LOCAL calendar-date Date. */
export function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(value.trim())
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

/** Whole years elapsed since the birthday, as of `today` (default: now). */
export function getAge(birthday: string, today: Date = new Date()): number {
  const birthDate = parseDateOnly(birthday)
  if (!birthDate) return NaN
  let age = today.getFullYear() - birthDate.getFullYear()
  const monthDiff = today.getMonth() - birthDate.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--
  }
  return age
}

/** Days until the next occurrence of the month/day, as of `today`. */
export function daysUntilNext(date: string, today: Date = new Date()): number {
  const birthDate = parseDateOnly(date)
  if (!birthDate) return NaN
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const thisYear = new Date(today.getFullYear(), birthDate.getMonth(), birthDate.getDate())
  if (thisYear < startOfToday) {
    thisYear.setFullYear(today.getFullYear() + 1)
  }
  return Math.ceil((thisYear.getTime() - startOfToday.getTime()) / (1000 * 60 * 60 * 24))
}
