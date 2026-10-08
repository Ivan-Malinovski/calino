import { format } from 'date-fns'
import { useSettingsStore } from '@/store/settingsStore'
import {
  clockPattern,
  deviceTimezone,
  formatInZone,
  pad2,
  parseWallClock,
  zonedDayKey,
  zonedMidnight,
  zonedMinutes,
} from '@/lib/datetime'
import type { TimeFormat } from '@/types'

/**
 * The zone Calino treats as the user's clock. An empty setting follows the
 * browser. The stored `timezone` field is not this — it is an unread sync
 * leftover.
 */
export function homeTimezone(): string {
  return useSettingsStore.getState().homeTimezone || deviceTimezone()
}

/**
 * Subscribe a component to the home zone. Helpers read the store directly, so
 * a settings change only moves the grid if something on the screen subscribed.
 */
export function useHomeTimezone(): string {
  const override = useSettingsStore((state) => state.homeTimezone)
  return override || deviceTimezone()
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
