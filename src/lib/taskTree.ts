import type { CalendarEvent } from '@/types'

export interface TaskTreeItem {
  task: CalendarEvent
  depth: number
}

/** A subtree this large is dense enough to start collapsed in list surfaces. */
export const SUBTASK_AUTO_COLLAPSE_THRESHOLD = 4

export function getTaskChildrenMap(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const childrenByParent = new Map<string, CalendarEvent[]>()
  for (const event of events) {
    if (event.type !== 'task' || !event.parentTaskId) continue
    const children = childrenByParent.get(event.parentTaskId) ?? []
    children.push(event)
    childrenByParent.set(event.parentTaskId, children)
  }
  return childrenByParent
}

/** Return the immediate task children in their stored order. */
export function getDirectSubtasks(events: CalendarEvent[], parentId: string): CalendarEvent[] {
  return events.filter((event) => event.type === 'task' && event.parentTaskId === parentId)
}

/**
 * Flatten a task's descendants while retaining their nesting depth.
 *
 * The visited set is deliberately global: malformed imported data can contain
 * cycles or duplicate references, and neither should make a modal recurse
 * forever or render the same task more than once.
 */
export function getTaskDescendants(events: CalendarEvent[], parentId: string): TaskTreeItem[] {
  const childrenByParent = getTaskChildrenMap(events)

  const result: TaskTreeItem[] = []
  // Exclude the starting task itself if malformed imported data points back
  // to it through a cycle.
  const visited = new Set<string>([parentId])

  const append = (id: string, depth: number): void => {
    for (const child of childrenByParent.get(id) ?? []) {
      if (visited.has(child.id)) continue
      visited.add(child.id)
      result.push({ task: child, depth })
      append(child.id, depth + 1)
    }
  }

  append(parentId, 0)
  return result
}

export function getTaskDescendantIds(events: CalendarEvent[], parentId: string): string[] {
  return getTaskDescendants(events, parentId).map(({ task }) => task.id)
}

export function getTaskParentsWithManyDescendants(
  events: CalendarEvent[],
  threshold = SUBTASK_AUTO_COLLAPSE_THRESHOLD
): Set<string> {
  const collapsed = new Set<string>()
  for (const event of events) {
    if (event.type !== 'task') continue
    if (getTaskDescendantIds(events, event.id).length >= threshold) collapsed.add(event.id)
  }
  return collapsed
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
  const eventById = new Map(events.map((event) => [event.id, event]))

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
  const childrenByParent = getTaskChildrenMap(events)
  const result: TaskTreeItem[] = []
  const visited = new Set<string>([parentId])

  const append = (id: string, depth: number): void => {
    if (collapsedTaskIds.has(id)) return
    for (const child of childrenByParent.get(id) ?? []) {
      if (visited.has(child.id)) continue
      visited.add(child.id)
      result.push({ task: child, depth })
      append(child.id, depth + 1)
    }
  }

  append(parentId, 0)
  return result
}
