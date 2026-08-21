import { useCallback, useMemo, useState } from 'react'
import type { CalendarEvent } from '@/types'
import {
  getTaskChildrenMap,
  getTaskParentsWithManyDescendants,
  SUBTASK_AUTO_COLLAPSE_THRESHOLD,
} from '@/lib/taskTree'

export interface TaskCollapseState {
  collapsedTaskIds: ReadonlySet<string>
  hasSubtasks: (taskId: string) => boolean
  descendantCount: (taskId: string) => number
  isCollapsed: (taskId: string) => boolean
  toggleTask: (taskId: string) => void
}

/**
 * Local disclosure state for a task surface. Large trees start collapsed, but
 * every manual toggle becomes an explicit override until the surface unmounts.
 */
export function useTaskCollapse(
  events: CalendarEvent[],
  threshold = SUBTASK_AUTO_COLLAPSE_THRESHOLD
): TaskCollapseState {
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map())

  const childrenByParent = useMemo(() => getTaskChildrenMap(events), [events])
  const defaultCollapsed = useMemo(
    () => getTaskParentsWithManyDescendants(events, threshold),
    [events, threshold]
  )

  const collapsedTaskIds = useMemo(() => {
    const result = new Set<string>()
    for (const taskId of defaultCollapsed) {
      if (overrides.get(taskId) !== false) result.add(taskId)
    }
    for (const [taskId, collapsed] of overrides) {
      if (collapsed) result.add(taskId)
      else result.delete(taskId)
    }
    return result
  }, [defaultCollapsed, overrides])

  const hasSubtasks = useCallback(
    (taskId: string): boolean => (childrenByParent.get(taskId)?.length ?? 0) > 0,
    [childrenByParent]
  )

  const descendantCount = useCallback(
    (taskId: string): number => {
      const visited = new Set<string>()
      const count = (id: string): number => {
        let total = 0
        for (const child of childrenByParent.get(id) ?? []) {
          if (visited.has(child.id)) continue
          visited.add(child.id)
          total += 1 + count(child.id)
        }
        return total
      }
      return count(taskId)
    },
    [childrenByParent]
  )

  const isCollapsed = useCallback(
    (taskId: string): boolean => collapsedTaskIds.has(taskId),
    [collapsedTaskIds]
  )

  const toggleTask = useCallback(
    (taskId: string): void => {
      setOverrides((previous) => {
        const next = new Map(previous)
        const currentlyCollapsed = previous.has(taskId)
          ? previous.get(taskId) === true
          : defaultCollapsed.has(taskId)
        next.set(taskId, !currentlyCollapsed)
        return next
      })
    },
    [defaultCollapsed]
  )

  return { collapsedTaskIds, hasSubtasks, descendantCount, isCollapsed, toggleTask }
}
