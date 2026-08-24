import type { CalendarEvent } from '@/types'

export interface TaskTreeItem {
  task: CalendarEvent
  depth: number
}

export interface TaskTreeIndex {
  readonly childrenByParent: ReadonlyMap<string, readonly CalendarEvent[]>
  readonly eventById: ReadonlyMap<string, CalendarEvent>
  getDirectSubtasks(parentId: string): readonly CalendarEvent[]
  getDescendants(parentId: string): TaskTreeItem[]
  getDescendantIds(parentId: string): string[]
  getDescendantCount(parentId: string): number
  getParentsWithManyDescendants(threshold: number): ReadonlySet<string>
}

/** A subtree this large is dense enough to start collapsed in list surfaces. */
export const SUBTASK_AUTO_COLLAPSE_THRESHOLD = 4

const indexCache = new WeakMap<CalendarEvent[], TaskTreeIndex>()

function buildTaskTreeIndex(events: CalendarEvent[]): TaskTreeIndex {
  const childrenByParent = new Map<string, CalendarEvent[]>()
  const eventById = new Map<string, CalendarEvent>()
  const taskIds = new Set<string>()
  let hasDuplicateTaskIds = false
  for (const event of events) {
    eventById.set(event.id, event)
    if (event.type !== 'task') continue
    if (taskIds.has(event.id)) hasDuplicateTaskIds = true
    taskIds.add(event.id)
    if (!event.parentTaskId) continue
    const children = childrenByParent.get(event.parentTaskId) ?? []
    children.push(event)
    childrenByParent.set(event.parentTaskId, children)
  }

  // Detect cycles iteratively so long imported chains cannot overflow the
  // JavaScript call stack. Malformed graphs use the guarded traversal below.
  let hasCycle = false
  const visitState = new Map<string, 0 | 1 | 2>()
  for (const rootId of taskIds) {
    if (visitState.get(rootId)) continue
    visitState.set(rootId, 1)
    const stack: Array<{ id: string; nextChild: number }> = [{ id: rootId, nextChild: 0 }]
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      const children = childrenByParent.get(frame.id) ?? []
      if (frame.nextChild >= children.length) {
        visitState.set(frame.id, 2)
        stack.pop()
        continue
      }
      const childId = children[frame.nextChild++].id
      const childState = visitState.get(childId) ?? 0
      if (childState === 1) {
        hasCycle = true
        break
      }
      if (childState === 0) {
        visitState.set(childId, 1)
        stack.push({ id: childId, nextChild: 0 })
      }
    }
    if (hasCycle) break
  }

  const descendantsCache = new Map<string, TaskTreeItem[]>()
  const countCache = new Map<string, number>()
  const validForest = !hasDuplicateTaskIds && !hasCycle

  if (validForest) {
    // Post-order counts make auto-collapse derivation linear in the task set.
    for (const rootId of taskIds) {
      if (countCache.has(rootId)) continue
      const stack: Array<{ id: string; expanded: boolean }> = [
        { id: rootId, expanded: false },
      ]
      while (stack.length > 0) {
        const frame = stack.pop()!
        if (countCache.has(frame.id)) continue
        if (!frame.expanded) {
          stack.push({ id: frame.id, expanded: true })
          for (const child of childrenByParent.get(frame.id) ?? []) {
            if (!countCache.has(child.id)) stack.push({ id: child.id, expanded: false })
          }
          continue
        }
        let count = 0
        for (const child of childrenByParent.get(frame.id) ?? []) {
          count += 1 + (countCache.get(child.id) ?? 0)
        }
        countCache.set(frame.id, count)
      }
    }
  }

  const collapsedCache = new Map<number, ReadonlySet<string>>()

  const getDescendants = (parentId: string): TaskTreeItem[] => {
    const cached = descendantsCache.get(parentId)
    if (cached) return [...cached]
    const result: TaskTreeItem[] = []
    const visited = new Set<string>([parentId])
    const stack: { id: string; depth: number; childIndex: number }[] = [
      { id: parentId, depth: 0, childIndex: 0 },
    ]

    // Keep the old depth-first ordering without using recursive calls, so a
    // deeply nested imported task chain cannot overflow the call stack.
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      const children = childrenByParent.get(frame.id) ?? []
      if (frame.childIndex >= children.length) {
        stack.pop()
        continue
      }

      const child = children[frame.childIndex]
      frame.childIndex += 1
      if (visited.has(child.id)) continue
      visited.add(child.id)
      result.push({ task: child, depth: frame.depth })
      stack.push({ id: child.id, depth: frame.depth + 1, childIndex: 0 })
    }

    descendantsCache.set(parentId, result)
    return [...result]
  }

  const getDescendantCount = (parentId: string): number => {
    return validForest ? countCache.get(parentId) ?? 0 : getDescendants(parentId).length
  }

  const index: TaskTreeIndex = {
    childrenByParent,
    eventById,
    getDirectSubtasks: (parentId) => (childrenByParent.get(parentId) ?? []).slice(),
    getDescendants,
    getDescendantIds: (parentId) => getDescendants(parentId).map(({ task }) => task.id),
    getDescendantCount,
    getParentsWithManyDescendants: (threshold) => {
      const cached = collapsedCache.get(threshold)
      if (cached) return cached
      const collapsed = new Set<string>()
      for (const event of events) {
        if (event.type === 'task' && getDescendantCount(event.id) >= threshold) {
          collapsed.add(event.id)
        }
      }
      collapsedCache.set(threshold, collapsed)
      return collapsed
    },
  }
  return index
}

export function getTaskTreeIndex(events: CalendarEvent[]): TaskTreeIndex {
  const cached = indexCache.get(events)
  if (cached) return cached
  const index = buildTaskTreeIndex(events)
  indexCache.set(events, index)
  return index
}

export function getTaskChildrenMap(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  return new Map(
    [...getTaskTreeIndex(events).childrenByParent].map(([id, children]) => [id, [...children]])
  )
}

/** Return the immediate task children in their stored order. */
export function getDirectSubtasks(events: CalendarEvent[], parentId: string): CalendarEvent[] {
  return getTaskTreeIndex(events).getDirectSubtasks(parentId).slice()
}

/**
 * Flatten a task's descendants while retaining their nesting depth.
 *
 * The visited set is deliberately global: malformed imported data can contain
 * cycles or duplicate references, and neither should make a modal recurse
 * forever or render the same task more than once.
 */
export function getTaskDescendants(events: CalendarEvent[], parentId: string): TaskTreeItem[] {
  return getTaskTreeIndex(events).getDescendants(parentId)
}

export function getTaskDescendantIds(events: CalendarEvent[], parentId: string): string[] {
  return getTaskDescendants(events, parentId).map(({ task }) => task.id)
}

export function getTaskParentsWithManyDescendants(
  events: CalendarEvent[],
  threshold = SUBTASK_AUTO_COLLAPSE_THRESHOLD
): Set<string> {
  return new Set(getTaskTreeIndex(events).getParentsWithManyDescendants(threshold))
}

/**
 * Hide descendants only when their collapsed ancestor is also present on the
 * current surface. This keeps a child visible in a day view when its parent is
 * due on another day, where there would be no chevron available to reopen it.
 */
export function filterTasksByCollapsedAncestors(
  tasks: CalendarEvent[],
  events: CalendarEvent[],
  collapsedTaskIds: ReadonlySet<string>
): CalendarEvent[] {
  const visibleIds = new Set(tasks.map((task) => task.id))
  const eventById = getTaskTreeIndex(events).eventById

  return tasks.filter((task) => {
    const visited = new Set<string>()
    let ancestorId = task.parentTaskId
    while (ancestorId && !visited.has(ancestorId)) {
      visited.add(ancestorId)
      if (visibleIds.has(ancestorId) && collapsedTaskIds.has(ancestorId)) return false
      ancestorId = eventById.get(ancestorId)?.parentTaskId
    }
    return true
  })
}

/** Flatten a root's visible descendants while honoring collapsed branches. */
export function getVisibleTaskDescendants(
  events: CalendarEvent[],
  parentId: string,
  collapsedTaskIds: ReadonlySet<string>
): TaskTreeItem[] {
  const childrenByParent = getTaskTreeIndex(events).childrenByParent
  const result: TaskTreeItem[] = []
  const visited = new Set<string>([parentId])

  const stack: { id: string; depth: number; childIndex: number }[] = [
    { id: parentId, depth: 0, childIndex: 0 },
  ]
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]
    if (collapsedTaskIds.has(frame.id)) {
      stack.pop()
      continue
    }
    const children = childrenByParent.get(frame.id) ?? []
    if (frame.childIndex >= children.length) {
      stack.pop()
      continue
    }

    const child = children[frame.childIndex]
    frame.childIndex += 1
    if (visited.has(child.id)) continue
    visited.add(child.id)
    result.push({ task: child, depth: frame.depth })
    stack.push({ id: child.id, depth: frame.depth + 1, childIndex: 0 })
  }
  return result
}
