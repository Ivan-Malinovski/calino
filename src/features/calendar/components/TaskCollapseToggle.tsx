import { useEffect, useState } from 'react'
import type { JSX, MouseEvent, PointerEvent } from 'react'
import styles from './TaskCollapseToggle.module.css'
import { useTranslation } from 'react-i18next'

interface TaskCollapseToggleProps {
  taskTitle: string
  collapsed: boolean
  hiddenCount?: number
  onToggle: (trigger: HTMLButtonElement) => void
  className?: string
  actionLabel?: string
  component?: 'task-collapse-toggle' | 'task-subtasks-popup-trigger'
}

export function TaskCollapseToggle({
  taskTitle,
  collapsed,
  hiddenCount,
  onToggle,
  className,
  actionLabel,
  component = 'task-collapse-toggle',
}: TaskCollapseToggleProps): JSX.Element {
  const { t } = useTranslation('calendar')
  const [visualCollapsed, setVisualCollapsed] = useState(collapsed)

  useEffect(() => {
    setVisualCollapsed(collapsed)
  }, [collapsed])

  const label =
    actionLabel ??
    (visualCollapsed
      ? t('surface.expandSubtasks', { title: taskTitle })
      : t('surface.collapseSubtasks', { title: taskTitle }))

  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    if (!actionLabel) setVisualCollapsed((previous) => !previous)
    onToggle(event.currentTarget)
  }

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
  }

  return (
    <button
      type="button"
      className={`${styles.toggle} ${className ?? ''}`}
      data-component={component}
      data-collapsed={visualCollapsed}
      aria-expanded={actionLabel ? undefined : !visualCollapsed}
      aria-label={
        !actionLabel && hiddenCount && visualCollapsed
          ? `${label} (${t('surface.hiddenCount', { count: hiddenCount })})`
          : label
      }
      title={label}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
    >
      {actionLabel ? (
        <span className={styles.actionIcon} aria-hidden="true">
          ↲
        </span>
      ) : (
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none">
          <path
            d="M6 4l4 4-4 4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  )
}
