import type { CalendarEvent } from '@/types'

export interface TaskTreeItem {
  task: CalendarEvent
  depth: number
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
  const childrenByParent = new Map<string, CalendarEvent[]>()
  for (const event of events) {
    if (event.type !== 'task' || !event.parentTaskId) continue
    const children = childrenByParent.get(event.parentTaskId) ?? []
    children.push(event)
    childrenByParent.set(event.parentTaskId, children)
  }

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
