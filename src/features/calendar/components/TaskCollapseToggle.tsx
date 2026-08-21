import type { JSX, MouseEvent, PointerEvent } from 'react'
import styles from './TaskCollapseToggle.module.css'

interface TaskCollapseToggleProps {
  taskTitle: string
  collapsed: boolean
  hiddenCount?: number
  onToggle: () => void
  className?: string
}

export function TaskCollapseToggle({
  taskTitle,
  collapsed,
  hiddenCount,
  onToggle,
  className,
}: TaskCollapseToggleProps): JSX.Element {
  const label = collapsed ? `Expand subtasks for "${taskTitle}"` : `Collapse subtasks for "${taskTitle}"`

  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    onToggle()
  }

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
  }

  return (
    <button
      type="button"
      className={`${styles.toggle} ${className ?? ''}`}
      data-component="task-collapse-toggle"
      data-collapsed={collapsed}
      aria-expanded={!collapsed}
      aria-label={hiddenCount && collapsed ? `${label} (${hiddenCount} hidden)` : label}
      title={label}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none">
        <path
          d="M6 4l4 4-4 4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}
