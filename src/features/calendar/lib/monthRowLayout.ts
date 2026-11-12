/**
 * Adaptive month-row layout.
 *
 * The month grid always fits every week in the height it is given. Each week
 * row is either *collapsed* (a compact summary) or *expanded* (every event
 * listed), and its height is derived, never fixed:
 *
 * 1. every row starts at the same collapsed height `base = min(26, H / n)`;
 * 2. the spare height is handed out one row at a time, in priority order, each
 *    row growing from `base` to what it needs to show all of its events before
 *    the next row gets anything;
 * 3. when every row is fully open and room is left, it is split evenly.
 *
 * Collapsed rows are capped at `MAX_COLLAPSED` and never step through
 * intermediate heights while other rows are waiting to open. That is what keeps
 * the count of visible events monotonic as the window grows: an earlier design
 * that grew collapsed rows gradually showed fewer events at 373px than at 367px.
 * Do not reintroduce intermediate collapsed steps.
 *
 * Pure functions, no React and no DOM, so the maths is unit-testable.
 */

/** Collapsed row height ceiling (px). */
export const MAX_COLLAPSED = 26
/** Expanded row: the date line and padding above the first chip. */
export const CHROME = 30
/** 20px chip + 2px gap. */
export const CHIP_PITCH = 22
/** An expanded row is never shorter than this. */
export const EXPAND_FLOOR = 52
/** A row expands at the latest once it reaches this height. */
export const EXPAND_CAP = 74
/** Collapsed rows at or above this height draw date + pips, first chip underneath. */
export const TIER_MINI = 40
/** Collapsed rows at or above this height draw one line: date, chip, pips. */
export const TIER_LINE = 24

export type MonthRowTier = 'mini' | 'line' | 'dots'

export interface MonthRowState {
  /** True when the row lists its events in full rather than as a summary. */
  expanded: boolean
  /** Collapsed rendering; only meaningful when `expanded` is false. */
  tier: MonthRowTier
  /** Chip slots in an expanded row (always at least one). */
  cap: number
}

export interface MonthRowLayout {
  heights: number[]
  rows: MonthRowState[]
}

/**
 * Height needed to show every item of a week's busiest day. `dayItemCounts`
 * holds, for each day of the week, how many rows it draws.
 */
export function weekNeed(dayItemCounts: readonly number[]): number {
  return CHROME + Math.max(0, ...dayItemCounts) * CHIP_PITCH
}

/** Focus, then the weeks after it (nearest first), then the earlier ones (nearest first). */
export function expansionOrder(focus: number, weekCount: number): number[] {
  const order = [focus]
  for (let r = focus + 1; r < weekCount; r++) order.push(r)
  for (let r = focus - 1; r >= 0; r--) order.push(r)
  return order
}

/**
 * @param height   px available to the week rows (grid body, weekday header excluded)
 * @param needs    per-week `weekNeed` values
 * @param focus    index of the focused week
 */
export function layoutMonthRows(
  height: number,
  needs: readonly number[],
  focus: number
): MonthRowLayout {
  const count = needs.length
  if (count === 0) return { heights: [], rows: [] }

  const clampedFocus = Math.min(Math.max(focus, 0), count - 1)
  const base = Math.min(MAX_COLLAPSED, height / count)
  const heights = needs.map(() => base)
  let spare = height - count * base // 0 when height < count * MAX_COLLAPSED

  for (const r of expansionOrder(clampedFocus, count)) {
    if (spare <= 0) break
    const add = Math.min(spare, Math.max(0, needs[r] - base))
    heights[r] += add
    spare -= add
  }
  if (spare > 0.5) for (let r = 0; r < count; r++) heights[r] += spare / count

  const rows = heights.map((h, r) => ({
    expanded: h >= Math.max(EXPAND_FLOOR, Math.min(needs[r], EXPAND_CAP)),
    tier: (h >= TIER_MINI ? 'mini' : h >= TIER_LINE ? 'line' : 'dots') as MonthRowTier,
    cap: Math.max(1, Math.floor((h - CHROME) / CHIP_PITCH)),
  }))
  return { heights, rows }
}

/**
 * How many of a day's items an expanded row draws. When they overflow, the last
 * slot is reserved for the "+N more" line.
 */
export function visibleChips(itemCount: number, cap: number): { show: number; more: number } {
  const show = itemCount > cap ? cap - 1 : itemCount
  return { show, more: itemCount - show }
}

/**
 * Which week to focus on load. The week containing today, unless nothing is
 * left from today to the end of that week; then the next week that has any
 * item. `itemCounts` is one entry per day of the grid.
 */
export function initialFocusWeek(
  itemCounts: readonly number[],
  todayIndex: number
): { focus: number; selected: number } {
  const weekCount = Math.floor(itemCounts.length / 7)
  let focus = Math.floor(todayIndex / 7)
  let selected = todayIndex
  const hasItems = (from: number, to: number): boolean =>
    itemCounts.slice(from, to).some((n) => n > 0)

  while (focus < weekCount - 1 && !hasItems(Math.max(focus * 7, todayIndex), focus * 7 + 7)) {
    focus++
    selected = focus * 7
  }
  if (selected !== todayIndex) {
    const first = itemCounts.findIndex((n, i) => i >= focus * 7 && n > 0)
    selected = Math.max(focus * 7, first)
  }
  return { focus, selected }
}
