import { format, parseISO } from 'date-fns'
import {
  da as daLocale,
  de as deLocale,
  es as esLocale,
  fr as frLocale,
  it as itLocale,
  nl as nlLocale,
} from 'date-fns/locale'
import type { Locale } from 'date-fns'
import type { DateFormat } from '@/types'
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz'
import { normalizeTzid } from '@/lib/timezoneRegistry'
import { homeTimezone, homeTimezoneOverride } from '@/lib/homeTimezone'
import { currentLanguage } from '@/lib/i18n'
import type { TimeFormat } from '@/types'

// ─── Locale-aware display formatting ─────────────────────────────────────────
//
// IMPORTANT: only *display* formatting belongs here. Patterns like
// `'yyyy-MM-dd'` are used ~93 times across the app as locale-neutral storage
// and routing keys (map keys, ICS fields, URL params) — running those through
// a locale would corrupt stored data. Keep using bare `format()` for those,
// or better, `toLocalDateString` below.

/** date-fns locales for the languages we ship. `en-US` is date-fns's default. */
const DATE_FNS_LOCALES: Record<string, Locale | undefined> = {
  en: undefined,
  da: daLocale,
  de: deLocale,
  es: esLocale,
  fr: frLocale,
  it: itLocale,
  nl: nlLocale,
}

/** The date-fns locale matching the active UI language. */
export function getDateFnsLocale(): Locale | undefined {
  return DATE_FNS_LOCALES[currentLanguage()]
}

/**
 * Format a date for *display*, in the active UI language.
 *
 * Use this — never bare `format()` — whenever the output contains a month or
 * weekday name, or an ordering a reader would notice.
 */
export function formatDisplayDate(date: Date | string, pattern: string): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, pattern, { locale: getDateFnsLocale() })
}

/** `'December 2024'` — month and year, e.g. the calendar header. */
export function formatMonthYear(date: Date | string): string {
  return formatDisplayDate(date, 'MMMM yyyy')
}

/** `'Dec 2024'` — abbreviated month and year. */
export function formatMonthYearShort(date: Date | string): string {
  return formatDisplayDate(date, 'MMM yyyy')
}

/** `'Tuesday'` — full weekday name. */
export function formatWeekdayLong(date: Date | string): string {
  return formatDisplayDate(date, 'EEEE')
}

/** `'Tue'` — abbreviated weekday name. */
export function formatWeekdayShort(date: Date | string): string {
  return formatDisplayDate(date, 'EEE')
}

/** `'Dec 31'` — day and abbreviated month. */
export function formatDayMonth(date: Date | string): string {
  return formatDisplayDate(date, 'MMM d')
}

/**
 * `'Tuesday, 31 December 2024'` — a full, unambiguous date.
 *
 * Note this uses one pattern for every locale rather than the mix of US
 * (`EEEE, MMMM d, yyyy`) and EU (`EEEE, d MMMM yyyy`) orderings the codebase
 * had grown; date-fns's locale data handles the rest.
 */
export function formatFullDate(date: Date | string): string {
  return formatDisplayDate(date, 'PPPP')
}

/** `'31 Dec 2024'` — a compact but unambiguous date. */
export function formatMediumDate(date: Date | string): string {
  return formatDisplayDate(date, 'PP')
}

/** Zero-pad a number to 2 digits (e.g. 9 → '09'). */
export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Format a Date as `'yyyy-MM-dd'` (local time). */
export function toLocalDateString(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** Format a UTC Date as an ICS `YYYYMMDDTHHMMSSZ` string. */
export function toICalUTC(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`
  )
}

/**
 * Format a time value using the user's `timeFormat` preference.
 *
 * `variant` controls the 12-hour pattern:
 * - `'full'`  → `'h:mm a'` (e.g. `'9:00 AM'`) — for event times, agenda rows
 * - `'hour'`  → `'h a'`   (e.g. `'9 AM'`)    — for hour-gutter labels
 *
 * `date` may be a Date or an ISO string (it will be parsed if string).
 */
export function formatTime(
  date: Date | string,
  timeFormat: TimeFormat,
  variant: 'full' | 'hour' = 'full'
): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  const pattern = timeFormat === '24h' ? 'HH:mm' : variant === 'hour' ? 'h a' : 'h:mm a'
  return format(d, pattern, { locale: getDateFnsLocale() })
}

/**
 * Long date-time format: `'MMM d, yyyy h:mm a'` (12h) or `'MMM d, yyyy HH:mm'` (24h).
 * Used primarily for broken-event display in Settings.
 */
export function formatDateLong(date: Date | string, timeFormat: TimeFormat = '24h'): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  const timePattern = timeFormat === '24h' ? 'HH:mm' : 'h:mm a'
  return formatDisplayDate(d, `MMM d, yyyy ${timePattern}`)
}

/**
 * Phase 2 (C2) - resolve an event time string to the instant it denotes.
 *
 * TZID events store naive wall clocks in the event zone (event.timezone), so
 * they must be read through date-fns-tz in that zone; a trailing Z is a
 * genuine instant. A floating string is a wall clock in the home zone when
 * that setting is set, and a device-local parse when it is empty. Falls back
 * to a device-local parse when the zone cannot be resolved.
 */
/**
 * The browser's IANA zone, with a UTC fallback when Intl cannot resolve one.
 * Display and newly created events use the home zone (`homeTimezone`), which
 * falls back to this value. A wall clock is meaningless without a zone, and a
 * bare UTC instant makes an RRULE repeat on UTC weekdays (issue #126).
 */
export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function resolvedZone(zone: string): string {
  return normalizeTzid(zone)
}

/** `yyyy-MM-dd` of an instant in `zone`. */
export function zonedDayKey(instant: Date, zone: string): string {
  return formatInTimeZone(instant, resolvedZone(zone), 'yyyy-MM-dd')
}

/** Minutes since midnight of an instant in `zone`. */
export function zonedMinutes(instant: Date, zone: string): number {
  const name = resolvedZone(zone)
  const hours = Number(formatInTimeZone(instant, name, 'H'))
  const minutes = Number(formatInTimeZone(instant, name, 'm'))
  return hours * 60 + minutes
}

/** Format an instant in `zone`. Numeric patterns do not depend on locale. */
export function formatInZone(instant: Date, zone: string, pattern: string): string {
  return formatInTimeZone(instant, resolvedZone(zone), pattern, { locale: getDateFnsLocale() })
}

/**
 * Instant denoted by a naive `yyyy-MM-ddTHH:mm[:ss]` wall clock in `zone`.
 * Falls back to a device-local parse when the zone cannot be resolved.
 */
export function parseWallClock(naive: string, zone: string): Date {
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(naive) ? `${naive}:00` : naive
  try {
    const zoned = fromZonedTime(normalized, resolvedZone(zone))
    if (!Number.isNaN(zoned.getTime())) return zoned
  } catch {
    // Unknown zone — fall through.
  }
  return parseISO(normalized)
}

/** True when the string names a genuine instant rather than a naive wall clock. */
export function isInstantString(iso: string): boolean {
  return /Z$/i.test(iso) || /[+-]\d{2}:?\d{2}$/.test(iso)
}

/** Midnight at the start of `dayKey` in `zone`. Probes forward if 00:00 is skipped. */
export function zonedMidnight(dayKey: string, zone: string): Date {
  const instant = parseWallClock(`${dayKey}T00:00:00`, zone)
  if (zonedDayKey(instant, zone) === dayKey) return instant
  for (let minutes = 1; minutes <= 180; minutes++) {
    const probe = parseWallClock(
      `${dayKey}T${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}:00`,
      zone
    )
    if (zonedDayKey(probe, zone) === dayKey) return probe
  }
  return instant
}

export function toEventInstant(iso: string, timezone?: string): Date {
  if (timezone && !iso.endsWith('Z')) {
    try {
      const zoned = fromZonedTime(iso, normalizeTzid(timezone))
      // date-fns-tz v3 does not throw for an unknown zone - it returns NaN.
      if (!Number.isNaN(zoned.getTime())) return zoned
    } catch {
      // Unknown zone name - fall through to the device-local interpretation.
    }
  }
  // Empty home stays on parseISO, including inside a DST gap.
  const override = !timezone && !isInstantString(iso) ? homeTimezoneOverride() : null
  if (override) return parseWallClock(iso, override)
  return parseISO(iso)
}

/**
 * Phase 2 (C2) - format an event time in the user's preferred format,
 * resolving TZID wall clocks through toEventInstant first.
 */
export function formatEventTime(
  date: string,
  timezone: string | undefined,
  timeFormat: TimeFormat,
  variant: 'full' | 'hour' = 'full'
): string {
  return formatInZone(
    toEventInstant(date, timezone),
    homeTimezone(),
    clockPattern(timeFormat, variant)
  )
}

/** Same patterns as `formatTime`, so a home-zone label matches it when the zones agree. */
export function clockPattern(timeFormat: TimeFormat, variant: 'full' | 'hour' = 'full'): string {
  return timeFormat === '24h' ? 'HH:mm' : variant === 'hour' ? 'h a' : 'h:mm a'
}

/**
 * Phase 2 (C3) — convert a Z/offset instant to a zone's naive wall clock,
 * keeping the "TZID events store naive wall clocks" storage invariant when a
 * drag/save writes a genuine instant onto a TZID-carrying event. Naive input
 * passes through unchanged; unresolvable zones fall back to stripping the
 * zone marker.
 */
export function toZoneWallClock(iso: string, timezone: string): string {
  if (!/Z$/i.test(iso) && !/[+-]\d{2}:?\d{2}$/.test(iso)) return iso
  try {
    const wall = formatInTimeZone(new Date(iso), normalizeTzid(timezone), "yyyy-MM-dd'T'HH:mm:ss")
    if (!wall.includes('Invalid')) return wall
  } catch {
    // Unknown zone - fall through to stripping the zone marker.
  }
  return iso
    .replace(/Z$/i, '')
    .replace(/[+-]\d{2}:?\d{2}$/, '')
    .replace(/\.\d+$/, '')
}

/**
 * Render a `yyyy-MM-dd` string the way the "Date format" setting says, for
 * editable date fields. Pure string work: native `<input type="date">` follows
 * the browser locale and ignores the setting, so those fields type in this
 * format instead. Anything that isn't a plain date comes back unchanged.
 */
export function formatDateInput(iso: string, dateFormat: DateFormat): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return iso
  const [, y, m, d] = match
  if (dateFormat === 'MM/dd/yyyy') return `${m}/${d}/${y}`
  if (dateFormat === 'dd/MM/yyyy') return `${d}/${m}/${y}`
  return `${y}-${m}-${d}`
}

/**
 * Inverse of `formatDateInput`: text typed in the configured order to a
 * `yyyy-MM-dd` string, or `null` when it isn't a real calendar date. `/`, `-`
 * and `.` are interchangeable separators, and day/month may omit the leading
 * zero.
 */
export function parseDateInput(text: string, dateFormat: DateFormat): string | null {
  const match = text.trim().match(/^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})$/)
  if (!match) return null
  const [a, b, c] = [match[1]!, match[2]!, match[3]!]
  let y: string
  let m: string
  let d: string
  if (dateFormat === 'yyyy-MM-dd') {
    ;[y, m, d] = [a, b, c]
  } else if (dateFormat === 'MM/dd/yyyy') {
    ;[m, d, y] = [a, b, c]
  } else {
    ;[d, m, y] = [a, b, c]
  }
  if (y.length !== 4 || m.length > 2 || d.length > 2) return null
  const year = Number(y)
  const month = Number(m)
  const day = Number(d)
  const check = new Date(Date.UTC(year, month - 1, day))
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null
  }
  return `${y}-${pad2(month)}-${pad2(day)}`
}

/** Number of whole days between two `yyyy-MM-dd` date strings (UTC-based, DST-safe). */
export function daysBetween(fromDate: string, toDate: string): number {
  const from = new Date(`${fromDate}T00:00:00Z`).getTime()
  const to = new Date(`${toDate}T00:00:00Z`).getTime()
  return Math.round((to - from) / 86400000)
}

/** Add `days` (may be negative) to a `yyyy-MM-dd` date string (UTC-based, DST-safe). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]!
}

/**
 * Add `minutes` to a "HH:mm" time-of-day string, wrapping past midnight.
 * Time-of-day only — no date rollover. Used to derive an event's end time
 * from its start plus a duration (default or user-preserved).
 */
export function addMinutesToTimeStr(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + minutes
  const endH = Math.floor(total / 60) % 24
  const endM = ((total % 60) + 60) % 60
  return `${pad2(endH)}:${pad2(endM)}`
}

/**
 * Step a "HH:mm" string by `minutes`, wrapping across midnight in *either*
 * direction. Unlike `addMinutesToTimeStr` this is safe for negative deltas —
 * that one floors a negative total into a negative hour ("00:00" minus 15
 * gives "-1:45"), which is fine for its callers (all pass durations forward)
 * but not for stepping a field down past midnight. Returns `time` unchanged
 * if it isn't parseable.
 */
export function stepTimeStr(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number)
  if (!Number.isInteger(h) || !Number.isInteger(m)) return time
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`
}
