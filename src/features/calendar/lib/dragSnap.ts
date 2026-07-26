import type { Active, Over } from '@dnd-kit/core'

export const MINUTE_SNAP_INTERVAL = 15

const MINUTES_PER_DAY = 24 * 60
const LAST_SNAP_MINUTE = MINUTES_PER_DAY - MINUTE_SNAP_INTERVAL

/** A timed droppable cell in the week/day grid, e.g. `2026-07-09-09:00`. */
export interface TimeSlot {
  dateKey: string
  /** The cell's own start, i.e. the top of the hour it covers. */
  minuteOfDay: number
}

/** Where a drag would land: used to preview the drop and to perform it. */
export interface DropPreview {
  dateKey: string
  minuteOfDay: number
  durationMinutes: number
}

/**
 * Splits an hour-cell droppable id into its day and hour. Returns null for the
 * all-day header droppables (`allday::yyyy-MM-dd`), which aren't time slots.
 */
export function parseTimeSlotId(droppableId: string): TimeSlot | null {
  if (droppableId.startsWith('allday::')) return null
  const lastDash = droppableId.lastIndexOf('-')
  if (lastDash < 0) return null
  const dateKey = droppableId.substring(0, lastDash)
  const [hours, minutes] = droppableId
    .substring(lastDash + 1)
    .split(':')
    .map(Number)
  if (!dateKey || !Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  return { dateKey, minuteOfDay: hours * 60 + minutes }
}

/**
 * Minute-of-day an event should start at after being dragged `deltaY` pixels
 * down the time grid, snapped to the nearest quarter hour. The snap is
 * absolute, so an event that started at an off-grid time (e.g. 9:07, imported
 * from CalDAV) lands on a clean quarter once it's moved.
 */
export function snapMinuteOfDay(startMinutes: number, deltaY: number, hourHeight: number): number {
  const rawMinutes = startMinutes + (deltaY / hourHeight) * 60
  const snapped = Math.round(rawMinutes / MINUTE_SNAP_INTERVAL) * MINUTE_SNAP_INTERVAL
  return Math.max(0, Math.min(LAST_SNAP_MINUTE, snapped))
}

/**
 * Where the dragged card will land, given the cell under the pointer and how
 * far the card has travelled vertically. The cell supplies only the day; the
 * time comes from the drag delta so drops resolve to a quarter hour rather
 * than the whole hour the cell covers.
 *
 * All-day events carry no `startMinutes` (there's no time of day to offset
 * from), so they fall back to the top of the hour cell they're dropped on.
 *
 * Returns null when there's no timed cell under the pointer.
 */
export function computeDropPreview(
  active: Active | null,
  over: Over | null,
  deltaY: number,
  hourHeight: number,
  durationMinutes: number
): DropPreview | null {
  if (!over) return null
  const slot = parseTimeSlotId(String(over.id))
  if (!slot) return null

  const startMinutes = active?.data.current?.startMinutes
  const minuteOfDay =
    typeof startMinutes === 'number'
      ? snapMinuteOfDay(startMinutes, deltaY, hourHeight)
      : slot.minuteOfDay

  return { dateKey: slot.dateKey, minuteOfDay, durationMinutes }
}

/** True when both previews point at the same slot — used to skip re-renders. */
export function isSameDropPreview(a: DropPreview | null, b: DropPreview | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.dateKey === b.dateKey &&
    a.minuteOfDay === b.minuteOfDay &&
    a.durationMinutes === b.durationMinutes
  )
}
