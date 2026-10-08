import type { CalendarEvent } from '@/types'
import { toEventInstant } from '@/lib/datetime'
import { homeMinutes } from '@/lib/homeTimezone'

/** Shared gap between adjacent event columns. */
const GAP = 4

/**
 * Base CSS properties for a time-based event positioned within the day grid.
 * `column` and `totalColumns` come from `positionEvents()`.
 *
 * Returns a `CSSProperties` object suitable for spreading onto a positioned
 * `<div>` wrapper (the `.eventPositioned` class provides `position: absolute`).
 */
export function positionedEventStyle(
  event: CalendarEvent,
  column: number,
  totalColumns: number,
  columnSpan = 1,
  inset = 0
): {
  top: string
  height: string
  left: string
  width: string
} {
  const start = toEventInstant(event.start, event.timezone)
  const end = toEventInstant(event.end, event.timezone)
  const startMinutesOfDay = homeMinutes(start)
  const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60)

  const horizontal = horizontalStyle(column, totalColumns, columnSpan, inset)

  return {
    top: `calc(var(--hour-height, 60px) * ${startMinutesOfDay / 60})`,
    height: `calc(var(--hour-height, 60px) * ${durationMinutes / 60})`,
    ...horizontal,
  }
}

/**
 * CSS properties for a transparent / all-day event that spans the full column
 * width (no column split). Used for `transparency === 'transparent'` events.
 *
 * `gap` controls the horizontal padding (defaults to `2` in WeekDayColumn;
 * `4` in DayView). Pass the appropriate value from the calling context.
 */
export function transparentEventStyle(
  event: CalendarEvent,
  gap = 2
): {
  top: string
  height: string
  left: string
  width: string
} {
  const start = toEventInstant(event.start, event.timezone)
  const end = toEventInstant(event.end, event.timezone)
  const startMinutesOfDay = homeMinutes(start)
  const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60)

  const leftPercent = gap / 2
  const widthPercent = 100 - gap

  return {
    top: `calc(var(--hour-height, 60px) * ${startMinutesOfDay / 60})`,
    height: `calc(var(--hour-height, 60px) * ${durationMinutes / 60})`,
    left: `${leftPercent}%`,
    width: `${widthPercent}%`,
  }
}

/**
 * Minutes of vertical space a timed-task pill visually occupies. Tasks are a
 * point in time (`start === end`), so `positionEvents` — which uses a strict
 * overlap test — would never see them collide and would stack them all in
 * column 0. Giving each pill this nominal duration for *layout only* lets
 * tasks share the column algorithm with events, so overlapping tasks (and a
 * task overlapping an event) land side by side.
 */
export const TASK_PILL_LAYOUT_MINUTES = 30

/**
 * CSS properties for a timed task rendered as a compact pill on the timeline.
 *
 * Anchored by `top` at the due time and sized horizontally by the same
 * column/totalColumns split events use. Deliberately carries no `height`: the
 * compact card sizes to its own content, avoiding the 0-height clip a
 * duration-based block would produce for a zero-length task.
 */
export function taskPillStyle(
  task: CalendarEvent,
  column: number,
  totalColumns: number,
  columnSpan = 1,
  inset = 0
): {
  top: string
  left: string
  width: string
} {
  const due = toEventInstant(task.start, task.timezone)
  const minutesOfDay = homeMinutes(due)

  const horizontal = horizontalStyle(column, totalColumns, columnSpan, inset)

  return {
    top: `calc(var(--hour-height, 60px) * ${minutesOfDay / 60})`,
    ...horizontal,
  }
}

/**
 * CSS properties for a travel-duration bar that precedes an event.
 * The bar is placed at `event.start - travelDuration` and shares the same
 * column width as the event itself.
 */
export function travelBarStyle(
  event: CalendarEvent,
  column: number,
  totalColumns: number,
  columnSpan = 1,
  inset = 0
): {
  top: string
  height: string
  left: string
  width: string
} {
  const start = toEventInstant(event.start, event.timezone)
  const travelDurationMinutes = event.travelDuration ?? 0
  const travelStart = new Date(start.getTime() - travelDurationMinutes * 60 * 1000)
  const travelStartMinutesOfDay = homeMinutes(travelStart)

  const horizontal = horizontalStyle(column, totalColumns, columnSpan, inset)

  return {
    top: `calc(var(--hour-height, 60px) * ${travelStartMinutesOfDay / 60})`,
    height: `calc(var(--hour-height, 60px) * ${travelDurationMinutes / 60})`,
    ...horizontal,
  }
}

function horizontalStyle(
  column: number,
  totalColumns: number,
  columnSpan: number,
  inset: number
): { left: string; width: string } {
  const left = (column / totalColumns) * 100 + GAP / 2
  const width = (columnSpan / totalColumns) * 100 - GAP
  if (!inset) return { left: `${left}%`, width: `${width}%` }
  const offset = `min(${inset}px, ${width / 3}%)`
  return { left: `calc(${left}% + ${offset})`, width: `calc(${width}% - ${offset})` }
}
