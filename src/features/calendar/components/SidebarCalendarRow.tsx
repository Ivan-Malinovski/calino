import type { JSX, ReactNode, MouseEventHandler } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import type { Calendar } from '@/types'
import styles from './Sidebar.module.css'

export function SidebarCalendarRow({
  calendar,
  children,
  onContextMenu,
}: {
  calendar: Calendar
  children: ReactNode
  onContextMenu: MouseEventHandler<HTMLLabelElement>
}): JSX.Element {
  const { t } = useTranslation('calendar')
  const reducedMotion = useReducedMotion()
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: calendar.id })
  return (
    <label
      ref={setNodeRef}
      className={`${styles.calendarItem} ${isDragging ? styles.calendarDragging : ''}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: reducedMotion ? 'none' : transition,
      }}
      onContextMenu={onContextMenu}
      data-component="sidebar-calendar"
      data-calendar-id={calendar.id}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className={styles.calendarDragHandle}
        {...attributes}
        {...listeners}
        aria-label={t('views.sidebar.reorderCalendar', { name: calendar.name })}
        title={t('views.sidebar.reorderCalendar', { name: calendar.name })}
        data-action="reorder-calendar"
        data-drawer-drag-ignore
        onClick={(event) => event.preventDefault()}
      >
        <GripVertical size={14} aria-hidden="true" />
      </button>
      {children}
    </label>
  )
}
