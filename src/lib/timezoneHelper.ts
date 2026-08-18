import { pad2, daysBetween } from '@/lib/datetime'
import type { TimeFormat } from '@/types'

export interface SecondaryHourLabel {
  time: string
  dayDelta: string | null
  dayDeltaDays: number
  formatted: string
  toString: () => string
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function getFormatter(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${timeZone}:${JSON.stringify(options)}`
  let formatter = formatterCache.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { ...options, timeZone })
    formatterCache.set(key, formatter)
  }
  return formatter
}

/**
 * Format a date in a specific timezone using Intl.DateTimeFormat.
 * Respects 24-hour vs 12-hour format:
 * - 24h: '14:00' or '14:30' (HH:mm)
 * - 12h: '2 PM' (if minute is 0) or '2:30 PM' (if minute is non-zero)
 */
export function formatTimeInZone(
  date: Date,
  timeZone: string,
  use24Hour: boolean | TimeFormat
): string {
  const is24 = typeof use24Hour === 'boolean' ? use24Hour : use24Hour === '24h'

  if (is24) {
    const formatter = getFormatter(timeZone, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      hourCycle: 'h23',
    })
    return formatter.format(date)
  }

  const parts = getFormatter(timeZone, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date)

  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00'

  if (minute === '00' || minute === '0') {
    const formatter = getFormatter(timeZone, {
      hour: 'numeric',
      hour12: true,
    })
    return formatter.format(date).replace(/\u202f/g, ' ')
  }

  const formatter = getFormatter(timeZone, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  return formatter.format(date).replace(/\u202f/g, ' ')
}

/**
 * Get short timezone abbreviation (e.g. 'CEST', 'EST', 'UTC', 'GMT+5:30').
 */
export function getTimezoneAbbr(date: Date, tz: string): string {
  try {
    const formatter = getFormatter(tz, { timeZoneName: 'short' })
    const parts = formatter.formatToParts(date)
    const tzPart = parts.find((p) => p.type === 'timeZoneName')
    return tzPart?.value ?? tz
  } catch {
    return tz
  }
}

/**
 * Compute secondary hour label and day delta (+1d / -1d) for a given local hour and base date.
 */
export function getSecondaryHourLabel(
  hour: number,
  baseDate: Date,
  targetTz: string,
  is24Hour: boolean | TimeFormat
): SecondaryHourLabel {
  const localDate = new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    hour,
    0,
    0,
    0
  )

  const is24 = typeof is24Hour === 'boolean' ? is24Hour : is24Hour === '24h'
  const timeStr = formatTimeInZone(localDate, targetTz, is24)

  const localDateStr = `${baseDate.getFullYear()}-${pad2(baseDate.getMonth() + 1)}-${pad2(baseDate.getDate())}`

  const dateFormatter = getFormatter(targetTz, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = dateFormatter.formatToParts(localDate)
  const targetYear = parts.find((p) => p.type === 'year')?.value ?? ''
  const targetMonth = parts.find((p) => p.type === 'month')?.value ?? ''
  const targetDay = parts.find((p) => p.type === 'day')?.value ?? ''
  const targetDateStr = `${targetYear}-${targetMonth}-${targetDay}`

  const deltaDays = daysBetween(localDateStr, targetDateStr)
  let dayDelta: string | null = null
  if (deltaDays > 0) {
    dayDelta = `+${deltaDays}d`
  } else if (deltaDays < 0) {
    dayDelta = `${deltaDays}d`
  }

  const formatted = dayDelta ? `${timeStr} ${dayDelta}` : timeStr

  return {
    time: timeStr,
    dayDelta,
    dayDeltaDays: deltaDays,
    formatted,
    toString() {
      return formatted
    },
  }
}

export const TIMEZONE_PRESETS: { value: string; label: string }[] = [
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Paris (CET/CEST)' },
  { value: 'Europe/Berlin', label: 'Berlin (CET/CEST)' },
  { value: 'America/New_York', label: 'New York (ET)' },
  { value: 'America/Chicago', label: 'Chicago (CT)' },
  { value: 'America/Denver', label: 'Denver (MT)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (PT)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { value: 'Asia/Shanghai', label: 'Shanghai (CST)' },
  { value: 'Asia/Singapore', label: 'Singapore (SGT)' },
  { value: 'Asia/Dubai', label: 'Dubai (GST)' },
  { value: 'Asia/Kolkata', label: 'India (IST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)' },
]

export const FALLBACK_TIMEZONES = [
  'UTC',
  'Africa/Cairo',
  'Africa/Casablanca',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'Africa/Nairobi',
  'America/Anchorage',
  'America/Argentina/Buenos_Aires',
  'America/Bogota',
  'America/Caracas',
  'America/Chicago',
  'America/Denver',
  'America/Halifax',
  'America/Los_Angeles',
  'America/Mexico_City',
  'America/New_York',
  'America/Phoenix',
  'America/Santiago',
  'America/Sao_Paulo',
  'America/St_Johns',
  'America/Toronto',
  'America/Vancouver',
  'Asia/Bangkok',
  'Asia/Colombo',
  'Asia/Dhaka',
  'Asia/Dubai',
  'Asia/Hong_Kong',
  'Asia/Jakarta',
  'Asia/Jerusalem',
  'Asia/Karachi',
  'Asia/Kathmandu',
  'Asia/Kolkata',
  'Asia/Kuwait',
  'Asia/Manila',
  'Asia/Riyadh',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Taipei',
  'Asia/Tehran',
  'Asia/Tokyo',
  'Asia/Yangon',
  'Atlantic/Azores',
  'Atlantic/Cape_Verde',
  'Atlantic/Reykjavik',
  'Australia/Adelaide',
  'Australia/Brisbane',
  'Australia/Darwin',
  'Australia/Eucla',
  'Australia/Hobart',
  'Australia/Melbourne',
  'Australia/Perth',
  'Australia/Sydney',
  'Europe/Amsterdam',
  'Europe/Athens',
  'Europe/Belgrade',
  'Europe/Berlin',
  'Europe/Brussels',
  'Europe/Bucharest',
  'Europe/Budapest',
  'Europe/Copenhagen',
  'Europe/Dublin',
  'Europe/Helsinki',
  'Europe/Istanbul',
  'Europe/Kyiv',
  'Europe/Lisbon',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Moscow',
  'Europe/Oslo',
  'Europe/Paris',
  'Europe/Prague',
  'Europe/Rome',
  'Europe/Stockholm',
  'Europe/Vienna',
  'Europe/Warsaw',
  'Europe/Zurich',
  'Pacific/Auckland',
  'Pacific/Chatham',
  'Pacific/Fiji',
  'Pacific/Guam',
  'Pacific/Honolulu',
  'Pacific/Pago_Pago',
  'Pacific/Port_Moresby',
  'Pacific/Tongatapu',
]

export function getSupportedTimezones(): string[] {
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
      const zones = Intl.supportedValuesOf('timeZone')
      if (zones && zones.length > 0) {
        if (!zones.includes('UTC')) {
          return ['UTC', ...zones]
        }
        return zones
      }
    }
  } catch {
    // Fallback
  }
  return FALLBACK_TIMEZONES
}
