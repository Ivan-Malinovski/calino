import type { CalendarEvent } from '@/types'

/**
 * Manual task order, stored as `X-APPLE-SORT-ORDER` on the VTODO — the
 * property Apple Reminders, Nextcloud Tasks and tasks.org already use. Lower
 * comes first. Values can be large (Apple derives them from seconds since
 * 2001), so they are kept as plain integers and never squeezed into a range.
 */

/** Gap left between consecutive values Calino writes. */
export const SORT_ORDER_STEP = 1000

/**
 * Read an `X-APPLE-SORT-ORDER` value. Anything that isn't a whole number a JS
 * number can hold exactly is treated as absent, so a malformed value from
 * another client can't scramble the order.
 */
export function parseSortOrder(raw: unknown): number | undefined {
  if (typeof raw === 'number') return Number.isSafeInteger(raw) ? raw : undefined
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (!/^[+-]?\d+$/.test(trimmed)) return undefined
  const value = Number(trimmed)
  return Number.isSafeInteger(value) ? value : undefined
}

/**
 * Tie-break for tasks a view already considers equal (same day, same time,
 * same group, or siblings): lower sort order first, tasks without one after
 * every task that has one. Returns 0 when neither has a value, so a stable
 * sort leaves tasks without the property exactly where they were.
 */
export function compareTaskSortOrder(
  a: Pick<CalendarEvent, 'sortOrder'>,
  b: Pick<CalendarEvent, 'sortOrder'>
): number {
  const aSet = a.sortOrder !== undefined
  const bSet = b.sortOrder !== undefined
  if (aSet && bSet) return (a.sortOrder as number) - (b.sortOrder as number)
  if (aSet) return -1
  if (bSet) return 1
  return 0
}

/**
 * The value a new subtask gets so it lands after its ordered siblings, or
 * undefined when none of them has one (the subtask then stays unordered too).
 */
export function nextSubtaskSortOrder(siblings: readonly CalendarEvent[]): number | undefined {
  let max: number | undefined
  for (const sibling of siblings) {
    if (sibling.sortOrder !== undefined && (max === undefined || sibling.sortOrder > max)) {
      max = sibling.sortOrder
    }
  }
  return max === undefined ? undefined : max + SORT_ORDER_STEP
}
