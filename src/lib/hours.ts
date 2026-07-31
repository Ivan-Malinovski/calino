import { addHours, startOfDay } from 'date-fns'

/**
 * Always produces exactly 24 hour Date objects regardless of DST.
 * eachHourOfInterval can produce 23 or 25 entries on DST transition days,
 * so we use a fixed count instead.
 */
function getHoursForDay(date: Date = new Date()): Date[] {
  const dayStart = startOfDay(date)
  return Array.from({ length: 24 }, (_, i) => addHours(dayStart, i))
}

/** Backwards-compatible constant (uses current date at module load time). */
export const HOURS = getHoursForDay()
