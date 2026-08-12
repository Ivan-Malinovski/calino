import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import { ContextMenu } from '@/components/common/ContextMenu'
import { useTaskContextMenuItems, type TaskMenuTarget } from '../hooks/useTaskContextMenuItems'

interface TaskContextMenuProps {
  task: TaskMenuTarget
  x: number
  y: number
  menuId: string
  onEdit: () => void
  onClose: () => void
}

/**
 * The task menu as one portaled unit. It exists so callers can render a menu
 * for whichever row was right-clicked without calling a hook per row — task
 * lists are virtualized and render hundreds of rows, only one of which ever
 * has a menu open.
 */
export function TaskContextMenu({
  task,
  x,
  y,
  menuId,
  onEdit,
  onClose,
}: TaskContextMenuProps): JSX.Element | null {
  // No onAfterAction: ContextMenu already runs its close animation after every
  // item click, and unmounting from here would cut that short.
  const { items } = useTaskContextMenuItems(task, { onEdit })
  if (items.length === 0) return null
  return createPortal(
    <ContextMenu x={x} y={y} menuId={menuId} items={items} onClose={onClose} />,
    document.body
  )
}
