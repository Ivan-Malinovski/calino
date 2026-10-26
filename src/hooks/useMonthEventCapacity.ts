import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * How much a month-view day cell can physically hold.
 *
 * The alternative — a fixed "show N then roll up" count — is wrong at both
 * ends: on a short window three cards overflow the cell, and on a tall one a
 * day with five events still says "+2 more" next to a stretch of empty cell.
 *
 * A count of *rows* is wrong too, one step further in: the rows aren't the
 * same height. A full event card is a title and a time on separate lines; a
 * compact pill, a past-week event, a multi-day fragment and a task are all
 * roughly half that. Dividing the cell by the tallest kind made a cell full of
 * pills roll up with half its height still empty. So the hook reports the
 * cell's usable *pixels* and `fitMonthCell` spends them item by item.
 *
 * The arithmetic runs off the grid's *allocated* height rather than its
 * rendered rows on purpose. A rendered row grows with its content, so feeding
 * that back into the count would let capacity chase itself: more room → more
 * cards → taller row → more room. The scroll container's client height is
 * fixed by the viewport, so dividing it between the week rows the same way
 * flexbox does gives a number that can only change when the window does.
 */

/** `.compressedWeek { flex: 0.5 }` in CalendarGrid.module.css. */
const COMPRESSED_WEEK_FLEX = 0.5

/**
 * Everything in a day cell that isn't an event row: `.day` padding (5px twice),
 * its bottom border, and the `.dayHeader` — a 28px `.dayNumber` plus its 6px
 * margin.
 */
const CELL_CHROME = 45

/**
 * The kinds of row a day cell can hold. They differ in height by more than
 * two to one, and a cell divided by the tallest of them rolls up while it
 * still has room, so each is costed separately. `data-row-kind` on the
 * rendered wrapper is what lets the measurement below find one of each.
 */
export type MonthRowKind = 'event' | 'compactEvent' | 'task' | 'taskWithTime' | 'dot'

/**
 * Starting heights, measured off rendered elements rather than added up from
 * the CSS — the CSS sum came out well under the real box. They are only a
 * seed: `measureItemHeights` replaces each one with the real thing as soon as
 * a row of that kind is on screen, so a theme, a font size or a browser zoom
 * that changes a card's box changes the arithmetic with it.
 */
export const ITEM_HEIGHT: Record<MonthRowKind, number> = {
  /** A month-view `EventCard`: title and time on their own lines. */
  event: 42,
  /** `.compact` — one title line. Past weeks, fragments, rolled-up recurrences. */
  compactEvent: 20,
  /** A task pill with no due time: one title line. */
  task: 22,
  /** A task pill that shows its due time under the title. */
  taskWithTime: 40,
  /** Compact mobile draws dots and bars, not cards. */
  dot: 10,
}

export type MonthItemHeights = Record<MonthRowKind, number>

/**
 * Reads the height of one rendered row of each kind. A kind the month happens
 * not to contain keeps whatever it had — the seed above, or the last real
 * measurement — rather than falling back and jittering the layout.
 */
function measureItemHeights(grid: HTMLElement, previous: MonthItemHeights): MonthItemHeights {
  const next = { ...previous }
  ;(Object.keys(ITEM_HEIGHT) as MonthRowKind[]).forEach((kind) => {
    const sample = grid.querySelector<HTMLElement>(`[data-row-kind="${kind}"]`)
    if (sample && sample.offsetHeight > 0) next[kind] = sample.offsetHeight
  })
  return next
}

/** The `.events` / `.tasks` gap between two items in the same container. */
const ROW_GAP = 3

/** `.events + .tasks` margin plus `.tasks` padding, on top of the usual gap. */
const TASKS_GAP = 6

/** The `.moreEvents` button (16px measured) and the gap above it. */
const MORE_ROW_HEIGHT = 19

/** `.compressedWeek > .day { min-height }` — the shortest a past week gets. */
export const PAST_WEEK_MIN_HEIGHT = 50

/**
 * How much taller than its old share a week still to come may grow before the
 * past weeks are given the surplus instead. Without a limit a quiet month is
 * a row of slivers over one enormous current week.
 */
const FULL_ROW_GROWTH = 1.25

/** Spare pixels under a past week's content, so a fractional border can't clip it. */
const PAST_WEEK_SLACK = 2

/** How long the grid has to hold a new size before the count follows it. */
const RESIZE_SETTLE_MS = 150

/** The usable content height of a day cell, and what a row costs to fill it. */
export interface MonthCellCapacity {
  contentHeight: number
  /** What each kind of row currently costs, in pixels. */
  itemHeights: MonthItemHeights
}

export interface MonthEventCapacity {
  full: MonthCellCapacity
  /** What a past week gets when it isn't sized to its content. */
  compressed: MonthCellCapacity
  /**
   * One entry per past week, in order, when the past weeks are sized to their
   * content (see `pastWeekDemand`); empty otherwise. `height` is the row's
   * pixel height and `capacity` what its cells can spend.
   */
  pastWeeks: Array<{ height: number; capacity: MonthCellCapacity }>
}

/** The rows one day cell wants to draw: events above tasks. */
export interface MonthDayDemand {
  events: MonthRowKind[]
  tasks: MonthRowKind[]
}

/** How many events and tasks a cell of `contentHeight` pixels shows. */
export interface MonthCellFit {
  eventLimit: number
  taskLimit: number
}

function stack(heights: number[], count: number): number {
  let total = 0
  for (let i = 0; i < count; i++) total += heights[i] + (i > 0 ? ROW_GAP : 0)
  return total
}

/** What drawing every event and task costs, with no roll-up line. */
function cellContentHeight(eventHeights: number[], taskHeights: number[]): number {
  return (
    stack(eventHeights, eventHeights.length) +
    (taskHeights.length > 0 ? TASKS_GAP + stack(taskHeights, taskHeights.length) : 0)
  )
}

/**
 * The height of a past week's row that draws all of its days in full: the
 * busiest day's rows plus the cell chrome, never under `PAST_WEEK_MIN_HEIGHT`
 * (the `min-height` `.compressedWeek > .day` imposes).
 */
export function pastWeekRowHeight(
  week: readonly MonthDayDemand[],
  heights: MonthItemHeights
): number {
  const busiest = week.reduce(
    (most, day) =>
      Math.max(
        most,
        cellContentHeight(
          day.events.map((kind) => heights[kind]),
          day.tasks.map((kind) => heights[kind])
        )
      ),
    0
  )
  return Math.max(PAST_WEEK_MIN_HEIGHT, CELL_CHROME + busiest + PAST_WEEK_SLACK)
}

/**
 * Raises the shortest of `heights` towards `cap` until `spare` pixels are
 * used, so the rows end up level rather than one swelling. Stops early once
 * every row has reached `cap`.
 */
export function levelHeights(heights: number[], cap: number, spare: number): number[] {
  const used = (level: number): number =>
    heights.reduce((sum, height) => sum + Math.min(cap, Math.max(height, level)) - height, 0)
  if (spare <= 0 || heights.length === 0) return heights
  if (used(cap) <= spare) return heights.map((height) => Math.max(height, cap))
  let low = Math.min(...heights)
  let high = cap
  for (let i = 0; i < 30; i++) {
    const mid = (low + high) / 2
    if (used(mid) > spare) high = mid
    else low = mid
  }
  return heights.map((height) => Math.max(height, low))
}

/**
 * Spends a cell's pixels on the events and then the tasks it holds.
 *
 * Events are drawn above tasks in the same cell, so events claim the room
 * first and tasks take what is left — with one task's worth held back when the
 * day has any, so they never vanish entirely behind the events' rollup. When
 * everything fits, nothing is held back for a "+N more" line that won't render.
 *
 * At least one of each is always shown, however short the cell: a day that
 * says only "+3 more" tells the reader nothing.
 */
export function fitMonthCell(
  contentHeight: number,
  eventHeights: number[],
  taskHeights: number[]
): MonthCellFit {
  const hasTasks = taskHeights.length > 0
  const everything = cellContentHeight(eventHeights, taskHeights)
  if (everything <= contentHeight) {
    return { eventLimit: eventHeights.length, taskLimit: taskHeights.length }
  }

  // Something will roll up, so the "+N more" line has to be paid for.
  const budget = contentHeight - MORE_ROW_HEIGHT
  // Room set aside so the first task survives however many events there are.
  const taskReserve = hasTasks ? TASKS_GAP + taskHeights[0] : 0

  let eventLimit = 0
  while (
    eventLimit < eventHeights.length &&
    stack(eventHeights, eventLimit + 1) + taskReserve <= budget
  )
    eventLimit++
  eventLimit = Math.min(eventHeights.length, Math.max(1, eventLimit))

  const left =
    budget - stack(eventHeights, eventLimit) - (eventLimit > 0 && hasTasks ? TASKS_GAP : 0)
  let taskLimit = 0
  while (taskLimit < taskHeights.length && stack(taskHeights, taskLimit + 1) <= left) taskLimit++
  taskLimit = Math.min(taskHeights.length, Math.max(hasTasks ? 1 : 0, taskLimit))

  return { eventLimit, taskLimit }
}

/**
 * Measures the month grid and reports how much room a day cell has for its
 * events. Returns null while unmeasured or when `enabled` is false, which
 * callers read as "use the fixed setting instead".
 *
 * @param gridRef the `.grid` scroll container, whose height the viewport fixes
 * @param headerSelector matches the weekday header row inside it
 * @param rowHeightFloor the week row's `min-height`, 0 if it has none
 */
export function useMonthEventCapacity({
  enabled,
  gridRef,
  headerSelector,
  weekCount,
  compressedWeekCount,
  rowHeightFloor,
  pastWeekDemand,
}: {
  enabled: boolean
  gridRef: React.RefObject<HTMLElement | null>
  headerSelector: string
  weekCount: number
  compressedWeekCount: number
  /** Height a week row can't go under, or 0 when nothing imposes one. */
  rowHeightFloor: number
  /**
   * What each past week's days want to draw, one entry per compressed week.
   * Given, each past week shrinks to what its busiest day needs — never above
   * the compressed share — and the weeks still to come take what that frees.
   * It is data, not rendered row heights, for the same reason as above: a row
   * sized by what is in it can't be fed back into how much it may hold.
   */
  pastWeekDemand?: ReadonlyArray<ReadonlyArray<MonthDayDemand>>
}): MonthEventCapacity | null {
  const [capacity, setCapacity] = useState<MonthEventCapacity | null>(null)

  const measure = useCallback((): void => {
    const grid = gridRef.current
    if (!enabled || !grid || weekCount <= 0) return
    const header = grid.querySelector<HTMLElement>(headerSelector)
    const available = grid.clientHeight - (header?.offsetHeight ?? 0)
    if (available <= 0) return

    // Same split flexbox makes: every week row is `flex: 1` except compressed
    // past weeks at `flex: 0.5`.
    const compressed = Math.min(compressedWeekCount, weekCount)
    const weight = weekCount - compressed + compressed * COMPRESSED_WEEK_FLEX
    // The share is a floor short of the truth in a window that can't fit the
    // month: `rowHeightFloor` is a `min-height` the row can't go under, and
    // the grid scrolls rather than squeezing past it. Taking the share alone
    // there had cells rolling events up with real room beneath them. Unlike
    // the rendered row height, the floor is a setting rather than a product of
    // the content, so leaning on it can't feed back into itself.
    const fullHeight = Math.max(available / weight, rowHeightFloor)
    const compressedHeight = Math.max((available / weight) * COMPRESSED_WEEK_FLEX, rowHeightFloor)

    const content = (cellHeight: number): number =>
      Math.max(ITEM_HEIGHT.compactEvent, Math.floor(cellHeight - CELL_CHROME))

    setCapacity((prev) => {
      const itemHeights = measureItemHeights(grid, prev?.full.itemHeights ?? ITEM_HEIGHT)

      // Past weeks sized to their content. Needs a week still to come to
      // absorb the space: with none, the rows would stop short of the bottom.
      let fullRowHeight = fullHeight
      let pastWeeks: MonthEventCapacity['pastWeeks'] = []
      if (pastWeekDemand && pastWeekDemand.length === compressed && compressed < weekCount) {
        const futureWeeks = weekCount - compressed
        const sum = (rows: number[]): number => rows.reduce((total, height) => total + height, 0)
        let heights = pastWeekDemand.map((week) =>
          Math.max(
            PAST_WEEK_MIN_HEIGHT,
            Math.min(compressedHeight, pastWeekRowHeight(week, itemHeights))
          )
        )
        fullRowHeight = Math.max((available - sum(heights)) / futureWeeks, rowHeightFloor)
        // Past what a week to come should grow to, the surplus goes back to
        // the past weeks, shortest first.
        const mostFull = Math.max(fullHeight * FULL_ROW_GROWTH, rowHeightFloor)
        if (fullRowHeight > mostFull) {
          heights = levelHeights(
            heights,
            compressedHeight,
            (fullRowHeight - mostFull) * futureWeeks
          )
          fullRowHeight = Math.max((available - sum(heights)) / futureWeeks, rowHeightFloor)
        }
        pastWeeks = heights.map((height) => ({
          height,
          capacity: { contentHeight: content(height), itemHeights },
        }))
      }

      const next: MonthEventCapacity = {
        full: { contentHeight: content(fullRowHeight), itemHeights },
        compressed: { contentHeight: content(compressedHeight), itemHeights },
        pastWeeks,
      }
      const unchanged =
        prev &&
        prev.full.contentHeight === next.full.contentHeight &&
        prev.compressed.contentHeight === next.compressed.contentHeight &&
        prev.pastWeeks.length === next.pastWeeks.length &&
        prev.pastWeeks.every((week, i) => week.height === next.pastWeeks[i].height) &&
        (Object.keys(itemHeights) as MonthRowKind[]).every(
          (kind) => prev.full.itemHeights[kind] === itemHeights[kind]
        )
      return unchanged ? prev : next
    })
  }, [
    enabled,
    gridRef,
    headerSelector,
    weekCount,
    compressedWeekCount,
    rowHeightFloor,
    pastWeekDemand,
  ])

  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // The first measurement has to land before the browser paints. Taking it
  // from the ResizeObserver's initial callback instead let the grid paint once
  // at the fallback count and then reflow, which moves every card in the month
  // a frame after it appears — enough to make a click that was already in
  // flight land on a card that has since moved or been replaced.
  useLayoutEffect(measure, [measure])

  useEffect(() => {
    const grid = gridRef.current
    if (!enabled || !grid || typeof ResizeObserver === 'undefined') return
    // Skip the callback `observe` fires immediately — the layout effect above
    // already took that one.
    //
    // Later ones settle before being acted on. Dragging a window edge fires
    // the observer far more often than the row count can change, and more
    // importantly a transient shift (a banner appearing, a scrollbar coming
    // and going) would otherwise re-lay-out every card in the month for a
    // frame — which yanks cards out from under a click already in flight.
    let seenInitialCallback = false
    const observer = new ResizeObserver(() => {
      if (!seenInitialCallback) {
        seenInitialCallback = true
        return
      }
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(measure, RESIZE_SETTLE_MS)
    })
    observer.observe(grid)
    return () => {
      observer.disconnect()
      clearTimeout(timerRef.current)
    }
  }, [enabled, gridRef, measure])

  return enabled ? capacity : null
}
