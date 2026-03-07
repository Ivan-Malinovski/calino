import type { JSX } from 'react'
import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { format, parseISO } from 'date-fns'
import { useDraggable } from '@dnd-kit/core'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { ContextMenu } from '@/components/common/ContextMenu'
import type { CalendarEvent } from '@/types'
import { DEFAULT_CALENDAR_COLOR } from '@/config'
import { useGestures } from '@/hooks/useGestures'
import { useContextMenuStore } from '@/store/contextMenuStore'
import { hapticIfEnabled } from '@/lib/haptics'
import styles from './EventCard.module.css'

interface EventCardProps {
  event: CalendarEvent
  onClick?: (event: CalendarEvent) => void
  compact?: boolean
  isDragging?: boolean
  enableResize?: boolean
  hideTopRadius?: boolean
  isMobileMonth?: boolean
}

export function EventCard({
  event,
  onClick,
  compact = false,
  isDragging = false,
  enableResize = true,
  hideTopRadius = false,
  isMobileMonth = false,
}: EventCardProps): JSX.Element {
  const calendars = useCalendarStore((state) => state.calendars)
  const openModal = useCalendarStore((state) => state.openModal)
  const openPreview = useCalendarStore((state) => state.openPreview)
  const closePreview = useCalendarStore((state) => state.closePreview)
  const previewEventId = useCalendarStore((state) => state.previewEventId)
  const updateEvent = useCalendarStore((state) => state.updateEvent)
  const deleteEvent = useCalendarStore((state) => state.deleteEvent)
  const duplicateEvent = useCalendarStore((state) => state.duplicateEvent)
  const timeFormat = useSettingsStore((state) => state.timeFormat)
  const { deleteEvent: deleteCalDAVEvent, updateEvent: updateCalDAVEvent } = useCalDAV()
  const openMenuId = useContextMenuStore((state) => state.openMenuId)
  const openMenu = useContextMenuStore((state) => state.openMenu)
  const closeMenu = useContextMenuStore((state) => state.closeMenu)

  const menuId = `event-${event.id}`
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  const [isResizing, setIsResizing] = useState(false)
  const [didInteract, setDidInteract] = useState(false)
  const resizeStartY = useRef<number | null>(null)
  const pointerStartPos = useRef<{ x: number; y: number } | null>(null)
  const resizeStartEnd = useRef<Date | null>(null)

  const { bind } = useGestures({
    onLongPress: ({ x, y }) => {
      hapticIfEnabled('medium')
      openMenu(menuId)
      setContextMenu({ x, y })
    },
    onTap: ({ x, y }) => {
      pointerStartPos.current = { x, y }
    },
    longPressDelay: 400,
    swipeThreshold: 30,
  })

  useEffect(() => {
    if (openMenuId !== null && openMenuId !== menuId && contextMenu) {
      setContextMenu(null)
    }
  }, [openMenuId, menuId])

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging: isCurrentDragging,
  } = useDraggable({
    id: event.id,
  })

  const calendar = calendars.find((c) => c.id === event.calendarId)
  const eventColor = event.color || calendar?.color || DEFAULT_CALENDAR_COLOR
  const isTask = event.type === 'task'
  const isRecurring = !!event.recurrence || !!event.rruleString

  const handleClick = (e: React.MouseEvent): void => {
    let moved = false
    if (pointerStartPos.current) {
      const dx = e.clientX - pointerStartPos.current.x
      const dy = e.clientY - pointerStartPos.current.y
      moved = Math.abs(dx) > 5 || Math.abs(dy) > 5
      pointerStartPos.current = null
    }

    if (isCurrentDragging || isResizing || didInteract || moved) {
      e.stopPropagation()
      setDidInteract(false)
      return
    }
    e.stopPropagation()

    if (previewEventId === event.id) {
      closePreview()
      openModal(undefined, undefined, event.id)
      return
    }

    if (onClick) {
      onClick(event)
    } else {
      openPreview(event.id, { x: e.clientX, y: e.clientY })
    }
  }

  const handleResizeStart = (e: React.PointerEvent): void => {
    e.stopPropagation()
    e.preventDefault()
    setIsResizing(true)
    setDidInteract(true)
    resizeStartY.current = e.clientY
    resizeStartEnd.current = parseISO(event.end)

    const handleResizeMove = (moveEvent: PointerEvent): void => {
      if (resizeStartY.current === null || resizeStartEnd.current === null) return

      const deltaY = moveEvent.clientY - resizeStartY.current
      const rawDeltaMinutes = (deltaY / 60) * 60
      const deltaMinutes = Math.round(rawDeltaMinutes / 15) * 15
      const newEnd = new Date(resizeStartEnd.current.getTime() + deltaMinutes * 60 * 1000)

      if (newEnd > parseISO(event.start)) {
        updateEvent(event.id, { end: newEnd.toISOString() })
      }
    }

    const handleResizeEnd = (): void => {
      setIsResizing(false)
      resizeStartY.current = null
      resizeStartEnd.current = null
      document.removeEventListener('pointermove', handleResizeMove)
      document.removeEventListener('pointerup', handleResizeEnd)
    }

    document.addEventListener('pointermove', handleResizeMove)
    document.addEventListener('pointerup', handleResizeEnd)
  }

  const formatTime = (dateString: string): string => {
    const pattern = timeFormat === '24h' ? 'HH:mm' : 'h:mm a'
    return format(parseISO(dateString), pattern)
  }

  const style = transform
    ? {
        backgroundColor: `${eventColor}20`,
        borderLeftColor: eventColor,
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        cursor: 'grabbing',
        zIndex: 1000,
        opacity: 0,
      }
    : {
        backgroundColor: `${eventColor}20`,
        borderLeftColor: eventColor,
        cursor: 'grab',
      }

  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    openMenu(menuId)
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  const handleCheckboxClick = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    const newCompleted = !event.completed
    updateEvent(event.id, { completed: newCompleted })
    if (!event.calendarId) return
    try {
      await updateCalDAVEvent(event.calendarId, { ...event, completed: newCompleted })
    } catch {
      // error handled by useCalDAV
    }
  }

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        data-event-card
        className={`${styles.card} ${compact ? styles.compact : ''} ${isCurrentDragging || isDragging ? styles.dragging : ''} ${isResizing ? styles.resizing : ''} ${hideTopRadius ? styles.noTopRadius : ''} ${isTask ? styles.task : ''} ${event.completed ? styles.completed : ''} ${isMobileMonth ? styles.mobileMonth : ''}`}
        onContextMenu={handleContextMenu}
        {...bind}
      >
        {isRecurring && (
          <div className={styles.recurringIcon}>
            <RecurringIcon />
          </div>
        )}
        {isTask ? (
          <div
            className={styles.taskContent}
            onClick={handleClick}
            onPointerDown={(e) => {
              e.stopPropagation()
              pointerStartPos.current = { x: e.clientX, y: e.clientY }
            }}
            {...listeners}
            {...attributes}
          >
            <div className={styles.checkbox} onClick={handleCheckboxClick}>
              {event.completed ? <CheckedIcon /> : <UncheckedIcon />}
            </div>
            <div className={styles.taskInfo}>
              <div className={styles.title}>{event.title}</div>
              {event.dueDate && (
                <div className={styles.dueDate}>
                  Due: {format(parseISO(event.dueDate), 'MMM d')}
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            <div
              className={styles.dragContent}
              onClick={handleClick}
              onPointerDown={(e) => {
                e.stopPropagation()
                pointerStartPos.current = { x: e.clientX, y: e.clientY }
              }}
              {...listeners}
              {...attributes}
            >
              <div className={styles.title}>{event.title}</div>
              {!compact && !event.isAllDay && (
                <div className={styles.time}>
                  {formatTime(event.start)} - {formatTime(event.end)}
                </div>
              )}
              {event.isAllDay && <div className={styles.time}>All day</div>}
              {event.travelDuration && (
                <div className={styles.travelTime}>
                  <TravelIcon />
                  <span>{formatTravelDuration(event.travelDuration)}</span>
                </div>
              )}
              {event.location && <div className={styles.location}>{event.location}</div>}
            </div>
            {enableResize && (
              <div
                className={styles.resizeHandle}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  handleResizeStart(e)
                }}
              />
            )}
          </>
        )}
      </div>
      {contextMenu &&
        createPortal(
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            menuId={menuId}
            onClose={() => {
              closeMenu()
              setContextMenu(null)
            }}
            items={[
              {
                label: 'Edit',
                onClick: () => {
                  openModal(undefined, undefined, event.id)
                },
                icon: <EditIcon />,
              },
              {
                label: 'Duplicate',
                onClick: () => duplicateEvent(event.id),
                icon: <DuplicateIcon />,
              },
              {
                label: 'Delete',
                onClick: async () => {
                  deleteEvent(event.id)
                  try {
                    await deleteCalDAVEvent(event.calendarId, event.id)
                  } catch {
                    // error handled by useCalDAV
                  }
                },
                icon: <DeleteIcon />,
                danger: true,
              },
            ]}
          />,
          document.body
        )}
    </>
  )
}

function DeleteIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  )
}

function DuplicateIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  )
}

function EditIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function TravelIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9L18 10l-3-5H9L6 10l-2.5 1.1C2.7 11.3 2 12.1 2 13v3c0 .6.4 1 1 1h2" />
      <circle cx="7" cy="17" r="2" />
      <circle cx="17" cy="17" r="2" />
      <path d="M8 12h8" />
    </svg>
  )
}

function formatTravelDuration(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    if (mins > 0) {
      return `${hours}h ${mins}m`
    }
    return `${hours}h`
  }
  return `${minutes} min`
}

function CheckedIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function UncheckedIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    </svg>
  )
}

function RecurringIcon(): JSX.Element {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11v-1a4 4 0 014-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v1a4 4 0 01-4 4H3" />
    </svg>
  )
}
