import ICAL from 'ical.js'
import { formatInTimeZone } from 'date-fns-tz'
import { resolveZone } from '@/lib/timezoneRegistry'
import type { JsonObject, JsonValue } from '../types'

export function object(value: JsonValue | undefined): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function string(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function entries(value: JsonValue | undefined): [string, JsonValue][] {
  return Object.entries(object(value)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}

export function keys(value: JsonValue | undefined): string[] {
  return entries(value)
    .filter(([, enabled]) => enabled === true)
    .map(([key]) => key)
}

export function text(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
}

/** RFC 6868 parameter escaping, followed by RFC 5545 quoting. */
export function parameter(value: string): string {
  const escaped = value
    .replace(/\^/g, '^^')
    .replace(/\r\n|\r|\n/g, '^n')
    .replace(/"/g, "^'")
  return /[,:;\s]/.test(escaped) ? `"${escaped}"` : escaped
}

export function uri(value: string): string {
  return value.replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}

/** Count UTF-8 octets, including the continuation space; never split a code point. */
export function fold(line: string): string {
  let result = ''
  let length = 0
  for (const char of line) {
    const cp = char.codePointAt(0) ?? 0
    const size = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4
    if (length + size > 75) {
      result += '\r\n '
      length = 1
    }
    result += char
    length += size
  }
  return result
}

export function zone(tzid: string | undefined): ICAL.Timezone {
  if (!tzid) return ICAL.Timezone.localTimezone
  if (tzid === 'UTC' || tzid === 'Etc/UTC') return ICAL.Timezone.utcTimezone
  const resolved = resolveZone(tzid)
  if (!resolved) throw new Error(`Unsupported JSCalendar timeZone: ${tzid}`)
  return resolved
}

export function time(value: string, tzid?: string, dateOnly = false): ICAL.Time {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z)?)?$/.exec(value)
  if (!match) throw new Error(`Invalid JSCalendar date-time: ${value}`)
  return new ICAL.Time(
    {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: dateOnly ? 0 : Number(match[4] ?? 0),
      minute: dateOnly ? 0 : Number(match[5] ?? 0),
      second: dateOnly ? 0 : Number(match[6] ?? 0),
      isDate: dateOnly,
    },
    dateOnly ? ICAL.Timezone.localTimezone : zone(match[7] ? 'UTC' : tzid)
  )
}

export function dateProperty(name: string, value: string, tzid?: string, dateOnly = false): string {
  const date = time(value, tzid, dateOnly)
  const params = dateOnly
    ? ';VALUE=DATE'
    : tzid && tzid !== 'UTC' && tzid !== 'Etc/UTC' && !value.endsWith('Z')
      ? `;TZID=${parameter(tzid)}`
      : ''
  return `${name}${params}:${date.toICALString()}`
}

export function utc(value: string): string {
  return time(value, 'UTC').toICALString()
}

/** RFC 8984: choose the first instant in a fold, and the pre-gap offset in a gap. */
export function localInstant(local: ICAL.Time, tzid: string): Date {
  const naive = new Date(0)
  naive.setUTCFullYear(local.year, local.month - 1, local.day)
  naive.setUTCHours(local.hour, local.minute, local.second, 0)
  const wall = naive.getTime()
  if (tzid === 'UTC' || tzid === 'Etc/UTC') return new Date(wall)
  zone(tzid)
  const localString = local.toString().replace(/Z$/, '')
  const format = "yyyy-MM-dd'T'HH:mm:ss"
  const offsetAt = (instant: number) => {
    const wallString = formatInTimeZone(new Date(instant), tzid, format)
    return Date.parse(`${wallString}Z`) - instant
  }
  const before = offsetAt(wall - 2 * 86400_000)
  const offsets = new Set([before, offsetAt(wall), offsetAt(wall + 2 * 86400_000)])
  const candidates = [...offsets]
    .map((offset) => wall - offset)
    .filter((instant) => formatInTimeZone(new Date(instant), tzid, format) === localString)
  return new Date(candidates.length ? Math.min(...candidates) : wall - before)
}

export function duration(value: string): { days: number; seconds: number } {
  const match =
    /^\+?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value)
  if (!match || !match.slice(1).some((part) => part !== undefined)) {
    throw new Error(`Invalid JSCalendar duration: ${value}`)
  }
  return {
    days: Number(match[1] ?? 0) * 7 + Number(match[2] ?? 0),
    seconds: Number(match[3] ?? 0) * 3600 + Number(match[4] ?? 0) * 60 + Number(match[5] ?? 0),
  }
}

export function endTime(
  start: string,
  length: string,
  tzid?: string,
  endTzid = tzid,
  allDay = false
): string {
  const d = duration(length)
  const local = time(start, tzid, allDay)
  // Nominal days first, then elapsed seconds, as specified in RFC 8984 §1.4.6.
  local.adjust(d.days, 0, 0, 0)
  if (allDay) {
    local.adjust(Math.ceil(d.seconds / 86400), 0, 0, 0)
    // A DATE-valued DTEND is exclusive and must be later than DTSTART.
    if (d.days === 0 && d.seconds === 0) local.adjust(1, 0, 0, 0)
    return local.toString()
  }
  if (!tzid) {
    local.adjust(0, 0, 0, Math.trunc(d.seconds))
    return local.toString()
  }
  const instant = new Date(localInstant(local, tzid).getTime() + d.seconds * 1000)
  if (!endTzid || endTzid === 'UTC' || endTzid === 'Etc/UTC')
    return instant.toISOString().replace(/\.\d{3}Z$/, 'Z')
  zone(endTzid)
  return formatInTimeZone(instant, endTzid, "yyyy-MM-dd'T'HH:mm:ss")
}

/** Validate the complete PatchObject before touching the cloned occurrence. */
export function applyPatch(master: JsonObject, patch: JsonObject): JsonObject {
  const paths = entries(patch).map(([path, value]) => {
    if (/~(?![01])/.test(path)) throw new Error(`Invalid JSCalendar patch path: ${path}`)
    return {
      path,
      parts: path.split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~')),
      value,
    }
  })
  for (const { path, parts } of paths) {
    for (const other of paths) {
      if (other.path !== path && other.path.startsWith(`${path}/`)) {
        throw new Error(`Conflicting JSCalendar patch paths: ${path}, ${other.path}`)
      }
    }
    let parent = master
    for (const part of parts.slice(0, -1)) {
      const child = Object.hasOwn(parent, part) ? parent[part] : undefined
      if (!child || typeof child !== 'object' || Array.isArray(child)) {
        throw new Error(`Invalid JSCalendar patch parent: ${path}`)
      }
      parent = child
    }
  }
  const result = JSON.parse(JSON.stringify(master)) as JsonObject
  for (const { parts, value } of paths) {
    let parent = result
    for (const part of parts.slice(0, -1)) parent = object(parent[part])
    const key = parts[parts.length - 1]
    if (value === null) delete parent[key]
    else
      Object.defineProperty(parent, key, {
        value: JSON.parse(JSON.stringify(value)) as JsonValue,
        enumerable: true,
        writable: true,
        configurable: true,
      })
  }
  return result
}
