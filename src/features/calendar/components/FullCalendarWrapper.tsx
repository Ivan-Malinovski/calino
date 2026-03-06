import { useMemo, useCallback, useRef, useEffect, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import listPlugin from '@fullcalendar/list'
import interactionPlugin from '@fullcalendar/interaction'
import rrulePlugin from '@fullcalendar/rrule'
import '@fullcalendar/core'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { getEventBackgroundColor } from '../types/calendarTypes'
import { ContextMenu } from '@/components/common/ContextMenu'
import styles from './FullCalendarWrapper.module.css'

export function FullCalendarWrapper() {
  const events = useCalendarStore((state) => state.events)
  const calendars = useCalendarStore((state) => state.calendars)
  const currentView = useCalendarStore((state) => state.currentView)
  const setCurrentView = useCalendarStore((state) => state.setCurrentView)
  const openModal = useCalendarStore((state) => state.openModal)
  const updateEvent = useCalendarStore((state) => state.updateEvent)
  const firstDayOfWeek = useSettingsStore((state) => state.firstDayOfWeek)

  const calendarEvents = useMemo(() => {
    const visibleCalendarIds = calendars.filter((c) => c.isVisible).map((c) => c.id)

    return events
      .filter((e) => visibleCalendarIds.includes(e.calendarId))
      .map((event) => {
        const calendar = calendars.find((c) => c.id === event.calendarId)
        const calendarColor = calendar?.color || '#4285f4'

        return {
          id: event.id,
          title: event.title,
          start: event.start,
          end: event.end,
          allDay: event.isAllDay,
          backgroundColor: getEventBackgroundColor(event.color || calendarColor),
          borderColor: event.color || calendarColor,
          extendedProps: {
            calendarId: event.calendarId,
            description: event.description,
            location: event.location,
            recurrence: event.recurrence,
            rruleString: event.rruleString,
            travelDuration: event.travelDuration,
            type: event.type,
            dueDate: event.dueDate,
            completed: event.completed,
            priority: event.priority,
          },
          ...(event.rruleString && { rrule: event.rruleString }),
        }
      })
  }, [events, calendars])

  const viewMap = useMemo(
    () => ({
      month: 'dayGridMonth',
      week: 'timeGridWeek',
      day: 'timeGridDay',
      agenda: 'listMonth',
    }),
    []
  )

  const reverseViewMap = useMemo(
    () => ({
      dayGridMonth: 'month',
      timeGridWeek: 'week',
      timeGridDay: 'day',
      listMonth: 'agenda',
    }),
    []
  )

  const calendarRef = useRef<InstanceType<typeof FullCalendar>>(null)
  const isFirstRender = useRef(true)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    date: string
  } | null>(null)

  useEffect(() => {
    const calendarApi = calendarRef.current?.getApi()
    if (calendarApi) {
      const fcView = viewMap[currentView]
      if (fcView && calendarApi.view.type !== fcView) {
        calendarApi.changeView(fcView)
      }
    }
  }, [currentView, viewMap])

  const handleDatesSet = useCallback(
    (dateInfo: { view: { type: string } }) => {
      if (isFirstRender.current) {
        isFirstRender.current = false
        return
      }

      const fcView = reverseViewMap[dateInfo.view.type as keyof typeof reverseViewMap]
      if (fcView && fcView !== currentView) {
        setCurrentView(fcView as 'month' | 'week' | 'day' | 'agenda')
      }
    },
    [setCurrentView, currentView, reverseViewMap]
  )

  const handleDateClick = useCallback(
    (info: { dateStr: string }) => {
      openModal(info.dateStr)
    },
    [openModal]
  )

  const handleSelect = useCallback(
    (info: { start: Date; end: Date }) => {
      const startStr = info.start.toISOString()
      const endStr = info.end.toISOString()
      openModal(startStr, endStr)
    },
    [openModal]
  )

  const handleEventClick = useCallback(
    (info: { event: { id: string }; el: HTMLElement; jsEvent: MouseEvent }) => {
      const target = info.jsEvent.target as HTMLElement
      if (target.closest('input[type="checkbox"]')) {
        info.jsEvent.stopPropagation()
        const event = events.find((e) => e.id === info.event.id)
        if (event && event.type === 'task') {
          updateEvent(info.event.id, { completed: !event.completed })
        }
        return
      }
      openModal(undefined, undefined, info.event.id)
    },
    [openModal, events, updateEvent]
  )

  const handleEventDrop = useCallback(
    (info: { event: { id: string; start: Date | null; end: Date | null } }) => {
      const eventId = info.event.id
      const start = info.event.start?.toISOString() || ''
      const end = info.event.end?.toISOString() || start
      updateEvent(eventId, { start, end })
    },
    [updateEvent]
  )

  const handleEventResize = useCallback(
    (info: { event: { id: string; start: Date | null; end: Date | null } }) => {
      const eventId = info.event.id
      const start = info.event.start?.toISOString() || ''
      const end = info.event.end?.toISOString() || start
      updateEvent(eventId, { start, end })
    },
    [updateEvent]
  )

  const handleEventContent = useCallback(
    (arg: {
      event: {
        title: string
        start: Date | null
        end: Date | null
        allDay: boolean
        extendedProps: Record<string, unknown>
        backgroundColor?: string
        borderColor?: string
      }
      timeText: string
    }) => {
      const { event, timeText } = arg
      const extendedProps = event.extendedProps
      const eventType = extendedProps.type as string | undefined
      const completed = extendedProps.completed as boolean | undefined
      const priority = extendedProps.priority as number | undefined
      const location = extendedProps.location as string | undefined

      const isTask = eventType === 'task'

      const priorityColors = ['', '#e53935', '#fb8c00', '#fdd835']
      const priorityLabel =
        priority && priority > 0 && priority <= 3
          ? `<span style="color: ${priorityColors[priority]}; font-weight: bold;">●</span>`
          : ''

      const borderColor = event.borderColor || '#4285f4'
      const bgColor = event.backgroundColor || `${borderColor}20`

      if (isTask) {
        return {
          html: `
          <div class="fc-event-task" style="display: flex; align-items: center; gap: 6px; background: ${bgColor} !important; border-left: 3px solid ${borderColor} !important; border-radius: 4px; padding: 2px 6px; height: 100%;">
            <input type="checkbox" ${completed ? 'checked' : ''} style="pointer-events: auto; width: 14px; height: 14px; cursor: pointer; margin: 0;" />
            <div style="flex: 1; min-width: 0;">
              <div style="font-size: 12px; font-weight: 500; color: var(--color-text-primary); ${completed ? 'text-decoration: line-through; opacity: 0.6;' : ''} white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${event.title}${priorityLabel}</div>
            </div>
          </div>
        `,
        }
      }

      return {
        html: `
          <div style="display: flex; flex-direction: column; min-width: 0; height: 100%; background: ${bgColor} !important; border-left: 3px solid ${borderColor} !important; border-radius: 4px; padding: 2px 6px;">
            <div style="font-size: 12px; font-weight: 500; color: var(--color-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${timeText ? `<span style="font-weight: 400; opacity: 0.7; margin-right: 4px;">${timeText}</span>` : ''}${event.title}${priorityLabel}
            </div>
            ${location ? `<div style="font-size: 11px; color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px;">📍 ${location}</div>` : ''}
          </div>
        `,
      }
    },
    []
  )

  const handleEventDidMount = useCallback((arg: { el: HTMLElement }) => {
    arg.el.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault()
    })
  }, [])

  const handleContainerContextMenu = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    const dayCell = target.closest('.fc-daygrid-day, .fc-timegrid-slot')

    if (dayCell) {
      e.preventDefault()
      const dateStr =
        dayCell.getAttribute('data-date') ||
        dayCell.closest('[data-date]')?.getAttribute('data-date') ||
        ''

      if (dateStr) {
        setContextMenu({ x: e.clientX, y: e.clientY, date: dateStr })
      }
    }
  }, [])

  return (
    <div
      className={styles.container}
      onContextMenu={handleContainerContextMenu}
      onClick={() => setContextMenu(null)}
    >
      <FullCalendar
        ref={calendarRef}
        plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, rrulePlugin]}
        initialView={viewMap[currentView] || 'dayGridMonth'}
        headerToolbar={false}
        events={calendarEvents}
        editable={true}
        selectable={true}
        selectMirror={true}
        dayMaxEvents={4}
        weekends={true}
        weekNumbers={true}
        weekText="W"
        firstDay={firstDayOfWeek || 0}
        slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
        eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
        fixedMirrorParent={document.body}
        datesSet={handleDatesSet}
        dateClick={handleDateClick}
        select={handleSelect}
        eventClick={handleEventClick}
        eventDrop={handleEventDrop}
        eventResize={handleEventResize}
        eventContent={handleEventContent}
        eventDidMount={handleEventDidMount}
        height="100%"
      />
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          menuId="calendar-context"
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: 'Create event',
              onClick: () => {
                openModal(contextMenu.date)
                setContextMenu(null)
              },
            },
            {
              label: 'Create task',
              onClick: () => {
                openModal(contextMenu.date, undefined, undefined, 'task')
                setContextMenu(null)
              },
            },
          ]}
        />
      )}
    </div>
  )
}
