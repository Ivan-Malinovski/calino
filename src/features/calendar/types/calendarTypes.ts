import type { CalendarEvent, RecurrenceRule, TaskPriority } from '@/types'
import type { EventInput } from '@fullcalendar/core'

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function getEventBackgroundColor(color: string | undefined): string {
  if (!color) return 'var(--color-accent-light)'
  return hexToRgba(color, 0.15)
}

export function toFullCalendarEvent(event: CalendarEvent): EventInput {
  const fcEvent: EventInput = {
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    allDay: event.isAllDay,
    backgroundColor: getEventBackgroundColor(event.color),
    borderColor: event.color,
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
  }

  if (event.rruleString) {
    fcEvent.rrule = event.rruleString
  }

  return fcEvent
}

function toISOString(date: Date | string | undefined): string {
  if (!date) return ''
  if (typeof date === 'string') return date
  return date.toISOString()
}

export function fromFullCalendarEvent(event: EventInput): Partial<CalendarEvent> {
  const extended = (event.extendedProps as Record<string, unknown>) || {}
  return {
    id: event.id as string,
    title: event.title || '',
    start: toISOString(event.start as Date | string | undefined),
    end: toISOString(event.end as Date | string | undefined),
    isAllDay: event.allDay || false,
    color: event.backgroundColor as string,
    calendarId: extended.calendarId as string,
    description: extended.description as string | undefined,
    location: extended.location as string | undefined,
    recurrence: extended.recurrence as RecurrenceRule | undefined,
    rruleString: extended.rruleString as string | undefined,
    travelDuration: extended.travelDuration as number | undefined,
    type: extended.type as 'event' | 'task' | undefined,
    dueDate: extended.dueDate as string | undefined,
    completed: extended.completed as boolean | undefined,
    priority: extended.priority as TaskPriority | undefined,
  }
}
