import type { CalendarEvent } from '@/types'
import { toEventInstant } from '@/lib/datetime'

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
  totalColumns: number
): {
  top: string
  height: string
  left: string
  width: string
} {
  const start = toEventInstant(event.start, event.timezone)
  const end = toEventInstant(event.end, event.timezone)
  const startHour = start.getHours()
  const startMinutes = start.getMinutes()
  const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60)

  const leftPercent = (column / totalColumns) * 100 + GAP / 2
  const widthPercent = 100 / totalColumns - GAP

  return {
    top: `calc(var(--hour-height, 60px) * ${startHour + startMinutes / 60})`,
    height: `calc(var(--hour-height, 60px) * ${durationMinutes / 60})`,
    left: `${leftPercent}%`,
    width: `${widthPercent}%`,
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
  const startHour = start.getHours()
  const startMinutes = start.getMinutes()
  const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60)

  const leftPercent = gap / 2
  const widthPercent = 100 - gap

  return {
    top: `calc(var(--hour-height, 60px) * ${startHour + startMinutes / 60})`,
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
  totalColumns: number
): {
  top: string
  left: string
  width: string
} {
  const due = toEventInstant(task.start, task.timezone)
  const hour = due.getHours()
  const minutes = due.getMinutes()

  const leftPercent = (column / totalColumns) * 100 + GAP / 2
  const widthPercent = 100 / totalColumns - GAP

  return {
    top: `calc(var(--hour-height, 60px) * ${hour + minutes / 60})`,
    left: `${leftPercent}%`,
    width: `${widthPercent}%`,
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
  totalColumns: number
): {
  top: string
  height: string
  left: string
  width: string
} {
  const start = toEventInstant(event.start, event.timezone)
  const travelDurationMinutes = event.travelDuration ?? 0
  const travelStart = new Date(start.getTime() - travelDurationMinutes * 60 * 1000)
  const travelStartHour = travelStart.getHours()
  const travelStartMinutes = travelStart.getMinutes()

  const leftPercent = (column / totalColumns) * 100 + GAP / 2
  const widthPercent = 100 / totalColumns - GAP

  return {
    top: `calc(var(--hour-height, 60px) * ${travelStartHour + travelStartMinutes / 60})`,
    height: `calc(var(--hour-height, 60px) * ${travelDurationMinutes / 60})`,
    left: `${leftPercent}%`,
    width: `${widthPercent}%`,
  }
}
