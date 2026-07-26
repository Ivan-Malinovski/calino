import type { JSX, ReactNode } from 'react'
import styles from './EmptyState.module.css'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}

/**
 * Generic, accessible empty state for the calendar views.
 * Renders a centered icon, a title, an optional description, and an optional action.
 */
export function EmptyState({ icon, title, description, action }: EmptyStateProps): JSX.Element {
  return (
    <div className={styles.empty} role="status">
      {icon && (
        <div className={styles.icon} aria-hidden="true">
          {icon}
        </div>
      )}
      <h3 className={styles.title}>{title}</h3>
      {description && <p className={styles.description}>{description}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  )
}
