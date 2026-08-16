import { format, parseISO } from 'date-fns'
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz'
import { normalizeTzid } from '@/lib/timezoneRegistry'
import type { TimeFormat } from '@/types'

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
  return format(d, pattern)
}

/**
 * Long date-time format: `'MMM d, yyyy h:mm a'` (12h) or `'MMM d, yyyy HH:mm'` (24h).
 * Used primarily for broken-event display in Settings.
 */
export function formatDateLong(date: Date | string, timeFormat: TimeFormat = '24h'): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  const timePattern = timeFormat === '24h' ? 'HH:mm' : 'h:mm a'
  return format(d, `MMM d, yyyy ${timePattern}`)
}

/**
 * Phase 2 (C2) - resolve an event time string to the instant it denotes.
 *
 * TZID events store naive wall clocks in the event zone (event.timezone), so
 * they must be read through date-fns-tz in that zone; a trailing Z is a
 * genuine instant; floating strings are device-local. Falls back to a
 * device-local parse when the zone cannot be resolved, which keeps locally-
 * created events (which never carry a timezone) and unknown TZIDs behaving
 * as before.
 */
export function toEventInstant(iso: string, timezone?: string): Date {
  if (timezone && !iso.endsWith('Z')) {
    try {
      const zoned = fromZonedTime(iso, timezone)
      // date-fns-tz v3 does not throw for an unknown zone - it returns NaN.
      if (!Number.isNaN(zoned.getTime())) return zoned
    } catch {
      // Unknown zone name - fall through to the device-local interpretation.
    }
  }
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
  return formatTime(toEventInstant(date, timezone), timeFormat, variant)
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
  return iso.replace(/Z$/i, '').replace(/[+-]\d{2}:?\d{2}$/, '').replace(/\.\d+$/, '')
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
