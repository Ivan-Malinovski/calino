import { format, parseISO } from 'date-fns'
import { useSettingsStore } from '@/store/settingsStore'
import {
  clockPattern,
  deviceTimezone,
  formatInZone,
  isInstantString,
  pad2,
  parseWallClock,
  toEventInstant,
  toZoneWallClock,
  zonedDayKey,
  zonedMidnight,
  zonedMinutes,
} from '@/lib/datetime'
import { normalizeTzid } from '@/lib/timezoneRegistry'
import type { TimeFormat } from '@/types'

const zoneValidity = new Map<string, boolean>()

/** Synced settings are untrusted: an unknown zone would make every formatter throw. */
function usableZone(zone: string | null | undefined): string | null {
  if (!zone) return null
  let valid = zoneValidity.get(zone)
  if (valid === undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: normalizeTzid(zone) })
      valid = true
    } catch {
      valid = false
    }
    zoneValidity.set(zone, valid)
  }
  return valid ? zone : null
}

/** The chosen zone, or null when the setting follows the browser (or holds an unknown zone). */
export function homeTimezoneOverride(): string | null {
  return usableZone(useSettingsStore.getState().homeTimezone)
}

/**
 * The zone Calino treats as the user's clock. An empty setting follows the
 * browser. The stored `timezone` field is not this — it is an unread sync
 * leftover.
 */
export function homeTimezone(): string {
  return homeTimezoneOverride() || deviceTimezone()
}

/**
 * Subscribe a component to the home zone. Helpers read the store directly, so
 * a settings change only moves the grid if something on the screen subscribed.
 */
export function useHomeTimezone(): string {
  const override = useSettingsStore((state) => state.homeTimezone)
  return usableZone(override) || deviceTimezone()
}

/** The chosen zone, or null while the setting follows the browser. Re-renders on change. */
export function useHomeTimezoneOverride(): string | null {
  return usableZone(useSettingsStore((state) => state.homeTimezone))
}

export function homeDayKey(instant: Date): string {
  return zonedDayKey(instant, homeTimezone())
}

/**
 * Whether a calendar-cell `Date` (local midnight of its day key) is today in
 * the home zone. Do not pass a real event instant here — `format` reads the
 * Date's local fields, which for a cell is the day key.
 */
export function isHomeToday(day: Date): boolean {
  return format(day, 'yyyy-MM-dd') === homeDayKey(new Date())
}

export function homeMinutes(instant: Date): number {
  return zonedMinutes(instant, homeTimezone())
}

export function formatHome(instant: Date, pattern: string): string {
  return formatInZone(instant, homeTimezone(), pattern)
}

/** Instant of a naive `yyyy-MM-ddTHH:mm[:ss]` wall clock in the home zone. */
export function parseHomeWall(naive: string): Date {
  return parseWallClock(naive, homeTimezone())
}

/** Day a stored due belongs to. A TZID task (naive or `Z`) is filed in its own zone. Floating is the date in the string. */
export function storedDayKey(iso: string, timezone?: string, isAllDay?: boolean): string {
  if (isAllDay || !iso.includes('T')) return iso.split('T')[0]
  if (timezone) {
    const instant = isInstantString(iso) ? parseISO(iso) : toEventInstant(iso, timezone)
    return zonedDayKey(instant, timezone)
  }
  if (!isInstantString(iso)) return iso.split('T')[0]
  return homeDayKey(parseISO(iso))
}

/** Due string after a drag. Keeps TZID wall-clock, `Z`, or floating shape so the next sync does not relabel it. */
export function movedDueValue(
  originalDue: string,
  timezone: string | undefined,
  dayStr: string,
  homeTime: string
): string {
  const wall = `${dayStr}T${homeTime}`
  const instant = parseHomeWall(wall).toISOString()
  if (timezone) return toZoneWallClock(instant, timezone)
  if (isInstantString(originalDue)) return instant
  return wall
}

/** Midnight at the start of a `yyyy-MM-dd` day in the home zone. */
export function homeMidnight(dayKey: string): Date {
  return zonedMidnight(dayKey, homeTimezone())
}

/** Instant of `minutes` since midnight on a home-zone day. */
export function instantFromHomeMinutes(dayKey: string, minutes: number): Date {
  const total = ((Math.trunc(minutes) % 1440) + 1440) % 1440
  const hours = Math.floor(total / 60)
  const mins = total % 60
  return parseHomeWall(`${dayKey}T${pad2(hours)}:${pad2(mins)}:00`)
}

/** Clock label of an instant in the home zone. Matches `formatTime` when home is the browser. */
export function formatHomeClock(
  instant: Date,
  timeFormat: TimeFormat,
  variant: 'full' | 'hour' = 'full'
): string {
  return formatHome(instant, clockPattern(timeFormat, variant))
}
