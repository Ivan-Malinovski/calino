import type { JSX, ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import styles from './CalendarGrid.module.css'

/** Droppable ids of the month's gutter cells are this prefix plus the row's first day. */
export const WEEK_ROW_DROP_PREFIX = 'weekrow::'

interface WeekGutterCellProps {
  /** First day (`yyyy-MM-dd`) of the week row this gutter cell belongs to. */
  weekStartKey: string
  /** True while a task that can become a week task is being dragged. */
  acceptsTask: boolean
  className: string
  onClick: () => void
  children: ReactNode
}

/**
 * A week row's gutter cell. While a task is being dragged it lights up as a
 * drop target: dropping there makes the task a "sometime this week" task for
 * that row, the month counterpart of the week view's footer bar.
 */
export function WeekGutterCell({
  weekStartKey,
  acceptsTask,
  className,
  onClick,
  children,
}: WeekGutterCellProps): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({
    id: `${WEEK_ROW_DROP_PREFIX}${weekStartKey}`,
    disabled: !acceptsTask,
  })
  return (
    <div
      ref={setNodeRef}
      className={`${className} ${acceptsTask ? styles.weekDropReady : ''} ${isOver ? styles.weekDropOver : ''}`}
      data-week-drop={acceptsTask ? (isOver ? 'over' : 'ready') : undefined}
      onClick={onClick}
    >
      {children}
    </div>
  )
}
