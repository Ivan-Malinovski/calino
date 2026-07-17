import type { JSX } from 'react'
import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { format, parseISO, isSameDay } from 'date-fns'
import { formatTime } from '@/lib/datetime'
import { useDraggable } from '@dnd-kit/core'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { ContextMenu } from '@/components/common/ContextMenu'
import { RecurringIcon } from '@/components/common/icons'
import { DeleteDialog } from './DeleteDialog'
import type { CalendarEvent } from '@/types'
import { getEventColor } from '@/lib/eventColor'
import { useGestures } from '@/hooks/useGestures'
import { useContextMenuStore } from '@/store/contextMenuStore'
import { useHoveredEventStore } from '@/store/hoveredEventStore'
import { useDragModifierStore } from '@/store/dragModifierStore'
import { safeCalDAVUpdate } from '@/lib/caldavHelpers'
import { deleteEventWithUndo } from '@/lib/deleteWithUndo'
import { showToast } from '@/lib/toast'
import { buildMasterTruncation, getFutureOverrideIds, isFirstOccurrence } from '@/lib/recurrenceSplit'

import { extractOriginalEventId, hasDueTime, formatTravelDuration } from '@/lib/events'
import { hapticIfEnabled } from '@/lib/haptics'
import { LocationLink } from './LocationLink'
import { EventBackground } from '@/components/common/EventBackground'
import { matchEventBackground } from '@/lib/eventBackground'
import { MINUTE_SNAP_INTERVAL } from '../lib/dragSnap'
import styles from './EventCard.module.css'



interface EventCardProps {
  event: CalendarEvent
  onClick?: (event: CalendarEvent) => void
  compact?: boolean
  isDragging?: boolean
  enableResize?: boolean
  hideTopRadius?: boolean
  isMobileMonth?: boolean
  monthView?: boolean
  transparent?: boolean
  hourHeight?: number
  dotMode?: boolean
  /** Suppress the task's due-time line. Used by week/day view, where the
   *  card's position on the timeline already conveys the time. */
  hideDueTime?: boolean
}

export const EventCard = React.memo(function EventCard({
  event,
  onClick,
  compact = false,
  isDragging = false,
  enableResize = true,
  hideTopRadius = false,
  isMobileMonth = false,
  monthView = false,
  transparent = false,
  hourHeight = 60,
  dotMode = false,
  hideDueTime = false,
}: EventCardProps): JSX.Element {
  const calendars = useCalendarStore((state) => state.calendars)
  const categories = useCalendarStore((state) => state.categories)
  const openModal = useCalendarStore((state) => state.openModal)
  const openPreview = useCalendarStore((state) => state.openPreview)
  const closePreview = useCalendarStore((state) => state.closePreview)
  // Subscribe to a boolean rather than the raw id so a preview opening on a
  // different card doesn't re-render every EventCard in the grid.
  const isPreviewing = useCalendarStore((state) => state.previewEventId === event.id)
  const updateEvent = useCalendarStore((state) => state.updateEvent)
  const completeTask = useCalendarStore((state) => state.completeTask)
  const deleteEvent = useCalendarStore((state) => state.deleteEvent)
  const addEvent = useCalendarStore((state) => state.addEvent)
  const duplicateEvent = useCalendarStore((state) => state.duplicateEvent)
  const timeFormat = useSettingsStore((state) => state.timeFormat)
  const {
    deleteEvent: deleteCalDAVEvent,
    updateEvent: updateCalDAVEvent,
    createEvent: createCalDAVEvent,
    saveRecurrenceOverride,
  } = useCalDAV()
  // Cross-fragment hover: a multi-day event is rendered as separate cards per
  // grid cell. Share one hover highlight by tracking the hovered id in a store.
  // Subscribe to a boolean so only the previously- and newly-hovered cards
  // re-render, not every card in the grid.
  const isSharedHovered = useHoveredEventStore(
    (state) => state.hoveredEventId === event.id
  )
  const setHoveredEventId = useHoveredEventStore((state) => state.setHoveredEventId)
  const isDuplicateModifierHeld = useDragModifierStore((state) => state.isDuplicateModifierHeld)
  const openMenuId = useContextMenuStore((state) => state.openMenuId)
  const openMenu = useContextMenuStore((state) => state.openMenu)
  const closeMenu = useContextMenuStore((state) => state.closeMenu)

  const menuId = `event-${event.id}`
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const originalEventId = extractOriginalEventId(event.id)

  const [isResizing, setIsResizing] = useState(false)
  const [didInteract, setDidInteract] = useState(false)
  const resizeStartY = useRef<number | null>(null)
  const pointerStartPos = useRef<{ x: number; y: number } | null>(null)
  const resizeStartEnd = useRef<Date | null>(null)
  const handleResizeMoveRef = useRef<((e: PointerEvent) => void) | null>(null)
  const handleResizeEndRef = useRef<(() => void) | null>(null)

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

  const isRecurring = !!event.recurrence || !!event.rruleString
  const isRecurringInstance = !!originalEventId
  const isReadOnlyCalendar = calendars.find((c) => c.id === event.calendarId)?.readOnly === true
  // Drag-and-drop is disabled for any recurring event (master or generated
  // instance) and for exceptions. The "which occurrence?" question has to
  // be answered via the RecurrenceDialog in the modal, so we force the user
  // through the modal instead of silently moving the whole series. Webcal
  // subscriptions are read-only for the same reason EventModal blocks
  // save/delete on them (see isCalendarReadOnly() in calendarStore.ts).
  const disableDirectEdit = isRecurring || isRecurringInstance || isReadOnlyCalendar

  const dragStartMinutes = event.isAllDay
    ? undefined
    : (() => {
        const start = parseISO(event.start)
        return start.getHours() * 60 + start.getMinutes()
      })()

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging: isCurrentDragging,
  } = useDraggable({
    // Each fragment of a multi-day event shares event.id, which would give
    // duplicate draggable ids. Encode the fragment's day so drag handling knows
    // which day was grabbed and can move the whole span by the right offset.
    id: event.isFragment
      ? `${event.id}::${format(parseISO(event.start), 'yyyy-MM-dd')}`
      : event.id,
    // Carry the layout variant so the DragOverlay can render a preview that
    // matches the source card (e.g. keep a compact pill looking like a pill
    // instead of expanding into a full card). `startMinutes` lets the time-grid
    // views snap the drag to quarter hours; all-day events omit it.
    data: { compact, monthView, dotMode, isMobileMonth, startMinutes: dragStartMinutes },
    disabled: disableDirectEdit,
  })

  const useCategoryColors = useSettingsStore((state) => state.useCategoryColors)
  const eventColor = getEventColor(event, {
    categories,
    calendars,
    useCategoryColors,
  })
  const isTask = event.type === 'task'
  // Decorative keyword icon — only on full-size cards, never on the dense
  // "pill" variants (compact / dot / mobile-month) where there's no room, and
  // only when the user hasn't turned event icons off.
  const showEventIcons = useSettingsStore((state) => state.showEventIcons)
  const showBackground = showEventIcons && !compact && !dotMode && !isMobileMonth && !isTask
  const backgroundId = showBackground ? matchEventBackground(event.title || event.location) : null
  const isMultiDay = !isSameDay(parseISO(event.start), parseISO(event.end))
  const isFragmentMiddle = event.isFragment && !event.isFirstFragment && !event.isLastFragment
  const isFragmentFirst = event.isFragment && event.isFirstFragment
  const isFragmentLast = event.isFragment && event.isLastFragment

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

    // Ctrl/Cmd+click is a shortcut for the context menu's "Duplicate" action.
    if ((e.ctrlKey || e.metaKey) && !isReadOnlyCalendar) {
      duplicateEvent(event.id)
      return
    }

    if (isPreviewing) {
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
    // Defense-in-depth: the resize handle isn't rendered for recurring events
    // (see the JSX below), so this guard is unreachable today. Kept so that
    // if a future code path ever wires a resize trigger to a recurring card,
    // the modal stays the only path for duration changes on recurring events.
    if (disableDirectEdit) return
    // Don't preventDefault and don't flip isResizing/didInteract here — let the
    // click fire if the user just taps. Both flags are flipped inside
    // handleResizeMove once the pointer has moved more than a few px.
    resizeStartY.current = e.clientY
    resizeStartEnd.current = parseISO(event.end)

    // Remove any previously attached listeners to prevent accumulation
    if (handleResizeMoveRef.current) {
      document.removeEventListener('pointermove', handleResizeMoveRef.current)
    }
    if (handleResizeEndRef.current) {
      document.removeEventListener('pointerup', handleResizeEndRef.current)
    }

    const handleResizeMove = (moveEvent: PointerEvent): void => {
      if (resizeStartY.current === null || resizeStartEnd.current === null) return

      const deltaY = moveEvent.clientY - resizeStartY.current
      // Only flag as a real interaction once the pointer moves more than a few px.
      // This lets a pure tap on the resize handle still trigger the card's click.
      if (Math.abs(deltaY) > 4) {
        setIsResizing(true)
        setDidInteract(true)
      }
      const rawDeltaMinutes = (deltaY / hourHeight) * 60
      const deltaMinutes = Math.round(rawDeltaMinutes / MINUTE_SNAP_INTERVAL) * MINUTE_SNAP_INTERVAL
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
      handleResizeMoveRef.current = null
      handleResizeEndRef.current = null
    }

    handleResizeMoveRef.current = handleResizeMove
    handleResizeEndRef.current = handleResizeEnd
    document.addEventListener('pointermove', handleResizeMove)
    document.addEventListener('pointerup', handleResizeEnd)
  }

  // Cleanup resize listeners on unmount
  useEffect(() => {
    return () => {
      if (handleResizeMoveRef.current) {
        document.removeEventListener('pointermove', handleResizeMoveRef.current)
      }
      if (handleResizeEndRef.current) {
        document.removeEventListener('pointerup', handleResizeEndRef.current)
      }
    }
  }, [])

  const style = transform
    ? ({
        '--event-color': eventColor,
        // Ctrl+drag duplicates rather than moves. dnd-kit translates the
        // source node by the same delta as the DragOverlay clone, so
        // leaving `transform` on here would just make the source follow
        // the cursor too, stacked on the overlay — indistinguishable from
        // a normal move. Pin it in place instead: no transform, full
        // opacity, so it visibly "stays behind" while only the overlay
        // clone (with the duplicate badge) follows the pointer.
        transform: isDuplicateModifierHeld
          ? undefined
          : `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        cursor: isDuplicateModifierHeld ? 'copy' : 'grabbing',
        zIndex: isDuplicateModifierHeld ? undefined : 1000,
        opacity: isDuplicateModifierHeld ? 1 : 0,
      } as React.CSSProperties)
    : ({
        '--event-color': eventColor,
        cursor: disableDirectEdit ? 'pointer' : 'grab',
      } as React.CSSProperties)

  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    openMenu(menuId)
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  const handleCheckboxClick = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    if (isReadOnlyCalendar) return
    const newCompleted = !event.completed
    const updatedTasks = completeTask(event.id, newCompleted)
    if (!event.calendarId) return
    await Promise.all(updatedTasks.map((updatedTask) => safeCalDAVUpdate(
      updateCalDAVEvent,
      updatedTask.calendarId,
      updatedTask,
      { completed: updatedTask.completed, taskStatus: updatedTask.taskStatus, percentComplete: updatedTask.percentComplete, completedAt: updatedTask.completedAt }
    )))
  }

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        data-event-card
        data-component="event-card"
        role="button"
        tabIndex={0}
        aria-label={isTask
          ? `${event.title}${event.completed ? ' (completed)' : ''}${event.dueDate ? ` due ${formatTime(event.dueDate, timeFormat)}` : ''}`
          : event.isAllDay
          ? `${event.title}, all day`
          : `${event.title}, ${formatTime(event.start, timeFormat)} to ${formatTime(event.end, timeFormat)}`
        }
        {...(isMultiDay ? { 'data-multi-day': '' } : {})}
        {...(isFragmentFirst ? { 'data-fragment-first': '' } : {})}
        {...(isFragmentMiddle ? { 'data-fragment-middle': '' } : {})}
        {...(isFragmentLast ? { 'data-fragment-last': '' } : {})}
        {...(disableDirectEdit
          ? {
              'data-no-drag': '',
              title: isReadOnlyCalendar
                ? 'Click to view (read-only subscription)'
                : 'Click to edit (recurring event)',
            }
          : {})}
        className={`${styles.card} ${compact ? styles.compact : ''} ${isCurrentDragging || isDragging ? styles.dragging : ''} ${isResizing ? styles.resizing : ''} ${hideTopRadius ? styles.noTopRadius : ''} ${isTask ? styles.task : ''} ${event.completed ? styles.completed : ''} ${event.completed ? styles.isDone : ''} ${isMobileMonth ? styles.mobileMonth : ''} ${monthView ? styles.monthView : ''} ${transparent ? styles.transparent : ''} ${isMultiDay ? styles.multiDay : ''} ${isFragmentMiddle ? styles.fragmentMiddle : ''} ${isFragmentFirst ? styles.fragmentFirst : ''} ${isFragmentLast ? styles.fragmentLast : ''} ${dotMode ? styles.dot : ''} ${event.isFragment && isSharedHovered ? styles.hovered : ''} ${disableDirectEdit ? styles.noDrag : ''}`}
        onContextMenu={handleContextMenu}
        onClick={handleClick}
        // role="button" requires Enter and Space activation for keyboard
        // users. The drag/resize listeners in `bind` are pointer-only
        // (mouse + touch) so they don't conflict with key handling here.
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleClick(e as unknown as React.MouseEvent)
          }
        }}
        onMouseEnter={event.isFragment ? () => setHoveredEventId(event.id) : undefined}
        onMouseLeave={event.isFragment ? () => setHoveredEventId(null) : undefined}
        {...bind}
      >
        {backgroundId && (
          <EventBackground id={backgroundId} className={styles.keywordBackground} />
        )}
        {isDragging && isDuplicateModifierHeld && (
          <div className={styles.duplicateBadge} title="Drop to duplicate">
            <DuplicateIcon />
          </div>
        )}
        {event.syncStatus === 'failed' && (
          <div className={styles.syncFailedIcon} title="Sync failed - changes not saved to server">
            <SyncWarningIcon />
          </div>
        )}
        {(isRecurring || (event.attachments && event.attachments.length > 0)) && (
          <div className={styles.iconGroup}>
            {event.attachments && event.attachments.length > 0 && (
              <div className={styles.attachmentIcon} title={`${event.attachments.length} attachment${event.attachments.length !== 1 ? 's' : ''}`}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            )}
            {isRecurring && (
              <div className={styles.recurringIcon}>
                <RecurringIcon />
              </div>
            )}
          </div>
        )}
        {isTask && (
          <button
            className={`${styles.checkbox} ${styles.taskCheckbox}`}
            onClick={handleCheckboxClick}
            aria-label="Toggle completion"
          >
            {event.completed ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : null}
          </button>
        )}
        {isTask ? (
          <div
            className={styles.dragContent}
            onPointerDown={(e) => {
              e.stopPropagation()
              pointerStartPos.current = { x: e.clientX, y: e.clientY }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                handleClick(e as unknown as React.MouseEvent)
              }
            }}
            {...listeners}
            {...attributes}
          >
            <div className={styles.title} title={event.title}>{event.title}</div>
            {!hideDueTime && hasDueTime(event) && event.dueDate && (
              <div className={styles.dueDate}>{formatTime(event.dueDate, timeFormat)}</div>
            )}
          </div>
        ) : (
          <>
            <div
              className={styles.dragContent}
              onPointerDown={(e) => {
                e.stopPropagation()
                pointerStartPos.current = { x: e.clientX, y: e.clientY }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  e.stopPropagation()
                  handleClick(e as unknown as React.MouseEvent)
                }
              }}
              {...listeners}
              {...attributes}
          >
            <div className={styles.title} title={event.title}>{event.title}</div>
            {(() => {
              const timeText = !compact && !event.isAllDay
                ? isFragmentFirst
                  ? `${formatTime(event.start, timeFormat)} - ${format(parseISO(event.originalEnd || event.end), 'MMM d')}`
                  : isFragmentMiddle
                  ? `${format(parseISO(event.originalStart || event.start), 'MMM d')} - ${format(parseISO(event.originalEnd || event.end), 'MMM d')}`
                  : isFragmentLast
                  ? `${format(parseISO(event.originalStart || event.start), 'MMM d')} - ${formatTime(event.end, timeFormat)}`
                  : `${formatTime(event.start, timeFormat)} - ${formatTime(event.end, timeFormat)}`
                : event.isAllDay ? 'All day' : null
              const locText = event.location || null
              if (timeText && locText) {
                return (
                  <div className={styles.meta}>
                    <span className={styles.time}>{timeText}</span>
                    <span className={styles.metaDot}>·</span>
                    <LocationLink location={locText} className={styles.location} />
                  </div>
                )
              }
              return (
                <>
                  {timeText && <div className={styles.time}>{timeText}</div>}
                  {locText && <LocationLink location={locText} className={styles.location} />}
                </>
              )
            })()}
            {event.travelDuration && (
              <div className={styles.travelTime}>
                <TravelIcon />
                <span>{formatTravelDuration(event.travelDuration)}</span>
              </div>
            )}
            </div>
            {enableResize && !disableDirectEdit && (
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
              // Convert/Duplicate/Delete all write into event.calendarId — for a
              // read-only webcal subscription that would either be silently
              // wiped on the next refresh (diff-by-id sees an id the feed
              // doesn't have) or mutate synced data, so they're hidden rather
              // than allowed and then undone. "Edit" still works — it opens
              // the modal, which shows the same read-only notice.
              ...(isReadOnlyCalendar
                ? []
                : [
                    {
                      label: isTask ? 'Convert to event' : 'Convert to task',
                      onClick: async () => {
                        const newType = isTask ? 'event' : 'task'
                        // The event modal's calendar picker only offers
                        // calendars that support the required component
                        // (VEVENT/VTODO), so switching type there can't land
                        // on an incompatible calendar. This shortcut bypasses
                        // that picker, so check directly: without this, an
                        // event on an events-only calendar becomes a task
                        // whose calendar doesn't support VTODO, and the modal's
                        // Save button — which requires calendarId to be in
                        // compatibleCalendars — is permanently disabled.
                        const requiredComponent = newType === 'task' ? 'VTODO' : 'VEVENT'
                        const calendar = calendars.find((c) => c.id === event.calendarId)
                        if (
                          calendar?.supportedComponents &&
                          !calendar.supportedComponents.includes(requiredComponent)
                        ) {
                          showToast(
                            newType === 'task'
                              ? `"${calendar.name}" doesn't support tasks`
                              : `"${calendar.name}" doesn't support events`
                          )
                          return
                        }
                        // Converting to a task needs a due date, or it silently
                        // drops out of every date-based view (AgendaView, the
                        // Week/Day timeline) since those key off dueDate, not
                        // start/end. Carry the event's start over as the due
                        // date; converting back to an event clears it since
                        // start/end already hold the real time.
                        const updates: Partial<CalendarEvent> = {
                          type: newType,
                          dueDate: newType === 'task' ? event.start : undefined,
                        }
                        updateEvent(event.id, updates)
                        await safeCalDAVUpdate(
                          updateCalDAVEvent,
                          event.calendarId,
                          { ...event, ...updates },
                          updates
                        )
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
                      onClick: () => {
                        const isRecurring = !!event.recurrence || !!event.rruleString || !!originalEventId
                        if (isRecurring) {
                          setShowDeleteDialog(true)
                        } else {
                          deleteEventWithUndo({
                            event,
                            deleteEvent,
                            addEvent,
                            createCalDAVEvent,
                            deleteCalDAVEvent,
                          })
                        }
                      },
                      icon: <DeleteIcon />,
                      danger: true,
                    },
                  ]),
            ]}
          />,
          document.body
        )}
      {showDeleteDialog &&
        createPortal(
          <DeleteDialog
            isOpen={showDeleteDialog}
            onClose={() => setShowDeleteDialog(false)}
            onConfirm={async (mode) => {
              const recurringMasterId = originalEventId || event.id
              if (mode === 'this') {
                const masterEvent = useCalendarStore.getState().events.find((e) => e.id === recurringMasterId)
                if (masterEvent) {
                  const occurrenceStart = event.recurrenceId || event.start
                  const dateStr = occurrenceStart.split('T')[0]
                  if (dateStr) {
                    const exclusionValue = masterEvent.isAllDay ? dateStr : occurrenceStart
                    const excludedDates = masterEvent.excludedDates || []
                    const updatedExcludedDates = excludedDates.includes(exclusionValue)
                      ? excludedDates
                      : [...excludedDates, exclusionValue]
                    try {
                      await saveRecurrenceOverride(
                        masterEvent.calendarId,
                        { ...masterEvent, excludedDates: updatedExcludedDates },
                        null,
                        event.recurrenceId ? [event.id] : []
                      )
                    } catch {
                      showToast('Failed to delete this occurrence. The event was kept.')
                      return
                    }
                  }
                }
              } else if (mode === 'future') {
                const storedEvents = useCalendarStore.getState().events
                const masterEvent = storedEvents.find((candidate) => candidate.id === recurringMasterId)
                const occurrenceStart = event.recurrenceId || event.start
                const occurrenceDate = occurrenceStart.split('T')[0]
                if (masterEvent && occurrenceDate) {
                  if (isFirstOccurrence(masterEvent, occurrenceStart)) {
                    deleteEventWithUndo({
                      event: masterEvent,
                      deleteEvent,
                      addEvent,
                      createCalDAVEvent,
                      deleteCalDAVEvent,
                    })
                    setShowDeleteDialog(false)
                    return
                  }
                  const truncation = buildMasterTruncation(masterEvent, occurrenceStart)
                  const removedOverrideIds = getFutureOverrideIds(
                    storedEvents,
                    masterEvent,
                    occurrenceStart
                  )
                  try {
                    await saveRecurrenceOverride(
                      masterEvent.calendarId,
                      { ...masterEvent, ...truncation },
                      null,
                      removedOverrideIds
                    )
                  } catch {
                    showToast('Failed to delete this and following events. The series was kept.')
                    return
                  }
                }
              } else if (originalEventId) {
                const eventToDelete = useCalendarStore.getState().events.find((e) => e.id === originalEventId)
                if (eventToDelete) {
                  deleteEventWithUndo({
                    event: eventToDelete,
                    deleteEvent,
                    addEvent,
                    createCalDAVEvent,
                    deleteCalDAVEvent,
                  })
                }
              } else {
                deleteEventWithUndo({
                  event,
                  deleteEvent,
                  addEvent,
                  createCalDAVEvent,
                  deleteCalDAVEvent,
                })
              }
              setShowDeleteDialog(false)
            }}
          />,
          document.body
        )}
    </>
  )
}, arePropsEqual)

// Recurrence occurrences are rebuilt as fresh objects on every expansion, so the
// default shallow `event` reference check never hits. Compare the fields the card
// actually renders instead, plus the primitive layout props.
//
// ⚠️ Keep in sync with CalendarEvent fields rendered by this component. If you
// add a rendered field to EventCard and forget to add it here, the card won't
// re-render when that field changes.
function arePropsEqual(prev: EventCardProps, next: EventCardProps): boolean {
  if (
    prev.onClick !== next.onClick ||
    prev.compact !== next.compact ||
    prev.isDragging !== next.isDragging ||
    prev.enableResize !== next.enableResize ||
    prev.hideTopRadius !== next.hideTopRadius ||
    prev.isMobileMonth !== next.isMobileMonth ||
    prev.monthView !== next.monthView ||
    prev.transparent !== next.transparent ||
    prev.hourHeight !== next.hourHeight ||
    prev.dotMode !== next.dotMode ||
    prev.hideDueTime !== next.hideDueTime
  ) {
    return false
  }

  const a = prev.event
  const b = next.event
  if (a === b) return true

  return (
    a.id === b.id &&
    a.calendarId === b.calendarId &&
    a.title === b.title &&
    a.start === b.start &&
    a.end === b.end &&
    a.isAllDay === b.isAllDay &&
    a.completed === b.completed &&
    a.location === b.location &&
    a.type === b.type &&
    a.dueDate === b.dueDate &&
    a.syncStatus === b.syncStatus &&
    a.travelDuration === b.travelDuration &&
    a.rruleString === b.rruleString &&
    a.isFragment === b.isFragment &&
    a.isFirstFragment === b.isFirstFragment &&
    a.isLastFragment === b.isLastFragment &&
    a.originalStart === b.originalStart &&
    a.originalEnd === b.originalEnd &&
    (a.attachments?.length ?? 0) === (b.attachments?.length ?? 0) &&
    (a.categories?.join(',') ?? '') === (b.categories?.join(',') ?? '')
  )
}

function DeleteIcon(): JSX.Element {
  return (
    <svg aria-hidden="true"
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
    <svg aria-hidden="true"
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
    <svg aria-hidden="true"
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
    <svg aria-hidden="true"
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

function SyncWarningIcon(): JSX.Element {
  return (
    <svg aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}
