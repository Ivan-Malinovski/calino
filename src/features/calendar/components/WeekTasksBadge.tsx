import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './WeekTasksBadge.module.css'

interface WeekTasksBadgeProps {
  count: number
  weekNumber: number
  expanded: boolean
  onOpen: (anchor: HTMLElement) => void
}

/**
 * The week row's "sometime this week" tasks, collapsed into a count in the
 * gutter. A row with none shows a faint "+" on hover instead, so the first
 * task for a week can be added from the month too.
 */
export function WeekTasksBadge({
  count,
  weekNumber,
  expanded,
  onOpen,
}: WeekTasksBadgeProps): JSX.Element {
  const { t } = useTranslation('calendar')
  const empty = count === 0
  return (
    <button
      type="button"
      className={styles.badge}
      data-component="week-tasks-badge"
      data-week-badge={empty ? 'empty' : 'count'}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      aria-label={
        empty
          ? t('views.week.weekTasksAriaLabel', { number: weekNumber })
          : t('views.week.weekTasksBadge', { count })
      }
      onClick={(e) => {
        // The gutter cell jumps to the week view when clicked.
        e.stopPropagation()
        onOpen(e.currentTarget)
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {empty ? (
        <span aria-hidden="true">+</span>
      ) : (
        <>
          <svg
            className={styles.glyph}
            viewBox="0 0 12 12"
            width="10"
            height="10"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M2.5 6.5l2.2 2.2L9.5 3.8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>{count}</span>
        </>
      )}
    </button>
  )
}
