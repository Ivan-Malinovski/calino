import { SORT_ORDER_STEP } from '@/lib/taskSortOrder'

/** One member of a reorder group: an id and its current sort order. */
export interface ReorderItem {
  id: string
  sortOrder?: number
}

/** A sort order Calino has to write for a reorder to take effect. */
export interface SortOrderWrite {
  id: string
  sortOrder: number
}

/**
 * The value for a task dropped above one that has `next`. Values stay at 1 or
 * above: some clients read 0 as "unset" or only accept non-negative integers.
 * A `next` already at 0 or below came from another client and can't be helped.
 */
function topValue(next: number): number {
  if (next < 1) return next - SORT_ORDER_STEP
  return next > SORT_ORDER_STEP ? next - SORT_ORDER_STEP : Math.floor(next / 2)
}

/**
 * The writes that place `movedId` at `index` within `group`.
 *
 * `group` is what the person sees, in the order they see it, *without* the
 * moved task; `index` is where it lands in that list (0 = first). Because the
 * views sort ordered tasks first, the members with a value always form a
 * prefix of `group` in ascending order.
 *
 * The moved task normally takes the midpoint of its new neighbours, so a move
 * writes one task. Only when that is impossible does it touch others:
 * - no integer gap left: the group is renumbered with a step of 1000;
 * - the task above has no value: the group is first given values, in its
 *   current order, down to the drop point;
 * - dropped at the top of a group whose first value is 1: nothing fits above
 *   it, so the group is renumbered from the step.
 * Tasks below the drop point that have no value stay unset; they already sort
 * after every ordered task. Only values that actually change are returned.
 */
export function planReorder(
  group: readonly ReorderItem[],
  movedId: string,
  index: number
): SortOrderWrite[] {
  const others = group.filter((item) => item.id !== movedId)
  const at = Math.max(0, Math.min(index, others.length))
  const order: ReorderItem[] = [
    ...others.slice(0, at),
    { id: movedId, sortOrder: undefined },
    ...others.slice(at),
  ]
  const current = new Map(group.map((item) => [item.id, item.sortOrder]))
  const prev = order[at - 1]?.sortOrder
  const next = order[at + 1]?.sortOrder

  const assigned = new Map<string, number>()
  const renumber = (start: number): void => {
    const ordered = order.filter((item) => item.id === movedId || item.sortOrder !== undefined)
    ordered.forEach((item, position) => assigned.set(item.id, start + position * SORT_ORDER_STEP))
  }
  if (at > 0 && prev === undefined) {
    // Seed everything above the drop point, then the moved task after it.
    let last: number | undefined
    for (const item of order.slice(0, at + 1)) {
      if (item.id !== movedId && item.sortOrder !== undefined) {
        last = item.sortOrder
        continue
      }
      last = last === undefined ? SORT_ORDER_STEP : last + SORT_ORDER_STEP
      assigned.set(item.id, last)
    }
  } else if (prev === undefined && next !== undefined && next === 1) {
    // Nothing fits above 1 without going to 0 or below: renumber from the step.
    renumber(SORT_ORDER_STEP)
  } else if (prev === undefined) {
    assigned.set(movedId, next === undefined ? SORT_ORDER_STEP : topValue(next))
  } else if (next === undefined) {
    assigned.set(movedId, prev + SORT_ORDER_STEP)
  } else if (next - prev >= 2) {
    assigned.set(movedId, Math.floor((prev + next) / 2))
  } else {
    // No gap: renumber the ordered part of the group, the moved task included,
    // keeping the first value so tasks elsewhere are disturbed as little as
    // possible.
    // `prev` is set, so the first member is too (ordered members are a prefix).
    const first = order[0].sortOrder as number
    const count = order.filter((item) => item.id === movedId || item.sortOrder !== undefined).length
    renumber(Number.isSafeInteger(first + count * SORT_ORDER_STEP) ? first : SORT_ORDER_STEP)
  }

  const writes: SortOrderWrite[] = []
  for (const [id, sortOrder] of assigned) {
    if (current.get(id) !== sortOrder) writes.push({ id, sortOrder })
  }
  return writes
}

/**
 * The index `planReorder` needs to move `movedId` one place up (-1) or down
 * (+1) within `group`, or null when it is already at that end.
 */
export function stepIndex(
  group: readonly ReorderItem[],
  movedId: string,
  direction: -1 | 1
): number | null {
  const from = group.findIndex((item) => item.id === movedId)
  if (from < 0) return null
  const to = from + direction
  if (to < 0 || to >= group.length) return null
  // Indices are in the list without the moved task: moving down past the
  // neighbour that is now at `from` means inserting after it.
  return direction === -1 ? to : from + 1
}
