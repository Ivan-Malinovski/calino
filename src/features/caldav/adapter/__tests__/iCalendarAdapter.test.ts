import { describe, it, expect } from 'vitest'
import {
  eventToICAL,
  parseICALData,
  parseICALEvent,
  parseICALTask,
  taskToICAL,
} from '../iCalendarAdapter'
import type { CalendarEvent } from '@/types'

describe('iCalendarAdapter', () => {
  describe('eventToICAL', () => {
    it('converts basic event to iCal format', () => {
      const event: CalendarEvent = {
        id: 'test-id-123',
        title: 'Test Event',
        description: 'Test description',
        location: 'Test location',
        start: '2024-03-15T14:00:00',
        end: '2024-03-15T15:00:00',
        isAllDay: false,
        calendarId: 'cal-1',
      }

      const iCal = eventToICAL(event)

      expect(iCal).toContain('BEGIN:VCALENDAR')
      expect(iCal).toContain('VERSION:2.0')
      expect(iCal).toContain('BEGIN:VEVENT')
      expect(iCal).toContain('UID:test-id-123')
      expect(iCal).toContain('SUMMARY:Test Event')
      expect(iCal).toContain('DESCRIPTION:Test description')
      expect(iCal).toContain('LOCATION:Test location')
      expect(iCal).toContain('DTSTART:')
      expect(iCal).toContain('DTEND:')
      expect(iCal).toContain('END:VEVENT')
      expect(iCal).toContain('END:VCALENDAR')
    })

    it('formats DTSTART and DTEND correctly for non-all-day events', () => {
      const event: CalendarEvent = {
        id: 'test-id',
        title: 'Meeting',
        start: '2024-03-15T14:00:00',
        end: '2024-03-15T15:30:00',
        isAllDay: false,
        calendarId: 'cal-1',
      }

      const iCal = eventToICAL(event)

      expect(iCal).toContain('DTSTART:')
      expect(iCal).toContain('DTEND:')
      expect(iCal).not.toContain('DTSTART;VALUE=DATE')
      expect(iCal).not.toContain('DTEND;VALUE=DATE')
    })

    it('uses VALUE=DATE for all-day events', () => {
      const event: CalendarEvent = {
        id: 'test-id',
        title: 'All Day Event',
        start: '2024-03-15T00:00:00',
        end: '2024-03-16T23:59:59',
        isAllDay: true,
        calendarId: 'cal-1',
      }

      const iCal = eventToICAL(event)

      expect(iCal).toContain('DTSTART;VALUE=DATE:')
      expect(iCal).toContain('DTEND;VALUE=DATE:')
    })

    it('includes description when present', () => {
      const event: CalendarEvent = {
        id: 'test-id',
        title: 'Event',
        description: 'Important meeting',
        start: '2024-03-15T14:00:00',
        end: '2024-03-15T15:00:00',
        isAllDay: false,
        calendarId: 'cal-1',
      }

      const iCal = eventToICAL(event)

      expect(iCal).toContain('DESCRIPTION:Important meeting')
    })

    it('includes location when present', () => {
      const event: CalendarEvent = {
        id: 'test-id',
        title: 'Event',
        location: 'Conference Room A',
        start: '2024-03-15T14:00:00',
        end: '2024-03-15T15:00:00',
        isAllDay: false,
        calendarId: 'cal-1',
      }

      const iCal = eventToICAL(event)

      expect(iCal).toContain('LOCATION:Conference Room A')
    })

    it('includes RRULE when recurrence is present', () => {
      const event: CalendarEvent = {
        id: 'test-id',
        title: 'Recurring Event',
        start: '2024-03-15T14:00:00',
        end: '2024-03-15T15:00:00',
        isAllDay: false,
        calendarId: 'cal-1',
        rruleString: 'FREQ=WEEKLY;INTERVAL=1',
      }

      const iCal = eventToICAL(event)

      expect(iCal).toContain('RRULE:FREQ=WEEKLY;INTERVAL=1')
    })

    it('excludes optional fields when not present', () => {
      const event: CalendarEvent = {
        id: 'test-id',
        title: 'Simple Event',
        start: '2024-03-15T14:00:00',
        end: '2024-03-15T15:00:00',
        isAllDay: false,
        calendarId: 'cal-1',
      }

      const iCal = eventToICAL(event)

      expect(iCal).not.toContain('DESCRIPTION:')
      expect(iCal).not.toContain('LOCATION:')
      expect(iCal).not.toContain('RRULE:')
    })
  })

  describe('parseICALEvent', () => {
    it('parses basic iCal event', () => {
      const iCal = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:event-123
DTSTAMP:20240315T100000Z
DTSTART:20240315T140000Z
DTEND:20240315T150000Z
SUMMARY:Test Event
END:VEVENT
END:VCALENDAR`

      const events = parseICALEvent(iCal, 'cal-1')

      expect(events).toHaveLength(1)
      expect(events[0].id).toBe('event-123')
      expect(events[0].title).toBe('Test Event')
      expect(events[0].calendarId).toBe('cal-1')
    })

    it('parses all-day event with VALUE=DATE', () => {
      const iCal = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-123
DTSTART;VALUE=DATE:20240315
DTEND;VALUE=DATE:20240316
SUMMARY:All Day Event
END:VEVENT
END:VCALENDAR`

      const events = parseICALEvent(iCal, 'cal-1')

      expect(events).toHaveLength(1)
      expect(events[0].isAllDay).toBe(true)
      expect(events[0].title).toBe('All Day Event')
    })

    it('parses event with description', () => {
      const iCal = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-123
DTSTART:20240315T140000Z
DTEND:20240315T150000Z
SUMMARY:Test Event
DESCRIPTION:This is a description
END:VEVENT
END:VCALENDAR`

      const events = parseICALEvent(iCal, 'cal-1')

      expect(events[0].description).toBe('This is a description')
    })

    it('parses event with location', () => {
      const iCal = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-123
DTSTART:20240315T140000Z
DTEND:20240315T150000Z
SUMMARY:Test Event
LOCATION:Conference Room
END:VEVENT
END:VCALENDAR`

      const events = parseICALEvent(iCal, 'cal-1')

      expect(events[0].location).toBe('Conference Room')
    })

    it('parses RRULE for recurring events', () => {
      const iCal = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-123
DTSTART:20240315T140000Z
DTEND:20240315T150000Z
SUMMARY:Weekly Meeting
RRULE:FREQ=WEEKLY;INTERVAL=1
END:VEVENT
END:VCALENDAR`

      const events = parseICALEvent(iCal, 'cal-1')

      expect(events[0].recurrence).toBeDefined()
      expect(events[0].recurrence?.frequency).toBe('weekly')
      expect(events[0].recurrence?.interval).toBe(1)
    })

    it('handles multiple events in one iCal', () => {
      const iCal = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-1
DTSTART:20240315T140000Z
DTEND:20240315T150000Z
SUMMARY:Event 1
END:VEVENT
BEGIN:VEVENT
UID:event-2
DTSTART:20240316T140000Z
DTEND:20240316T150000Z
SUMMARY:Event 2
END:VEVENT
END:VCALENDAR`

      const events = parseICALEvent(iCal, 'cal-1')

      expect(events).toHaveLength(2)
      expect(events[0].id).toBe('event-1')
      expect(events[1].id).toBe('event-2')
    })

    it('uses calendarId for parsed events', () => {
      const iCal = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-123
DTSTART:20240315T140000Z
DTEND:20240315T150000Z
SUMMARY:Test Event
END:VEVENT
END:VCALENDAR`

      const events = parseICALEvent(iCal, 'my-calendar-id')

      expect(events[0].calendarId).toBe('my-calendar-id')
    })
  })

  describe('round-trip', () => {
    it('event → iCal → parse preserves core fields', () => {
      const originalEvent: CalendarEvent = {
        id: 'round-trip-test',
        title: 'Round Trip Test',
        description: 'Testing round trip',
        location: 'Test Location',
        start: '2024-03-15T14:00:00',
        end: '2024-03-15T15:00:00',
        isAllDay: false,
        calendarId: 'cal-1',
      }

      const iCal = eventToICAL(originalEvent)
      const parsedEvents = parseICALEvent(iCal, 'cal-1')
      const parsed = parsedEvents[0]

      expect(parsed.id).toBe(originalEvent.id)
      expect(parsed.title).toBe(originalEvent.title)
      expect(parsed.description).toBe(originalEvent.description)
      expect(parsed.location).toBe(originalEvent.location)
      expect(parsed.isAllDay).toBe(originalEvent.isAllDay)
    })

    it('all-day event round-trip preserves isAllDay', () => {
      const originalEvent: CalendarEvent = {
        id: 'all-day-test',
        title: 'All Day Test',
        start: '2024-03-15T00:00:00',
        end: '2024-03-16T23:59:59',
        isAllDay: true,
        calendarId: 'cal-1',
      }

      const iCal = eventToICAL(originalEvent)
      const parsedEvents = parseICALEvent(iCal, 'cal-1')

      expect(parsedEvents[0].isAllDay).toBe(true)
    })
  })

  describe('timezone handling', () => {
    it('parses UTC datetime with Z suffix', () => {
      const iCal = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:utc-event
DTSTART:20240315T140000Z
DTEND:20240315T150000Z
SUMMARY:UTC Event
END:VEVENT
END:VCALENDAR`

      const events = parseICALEvent(iCal, 'cal-1')

      expect(events[0].start).toContain('14:00:00')
      expect(events[0].start).toContain('Z')
    })

    it('parses datetime without timezone as local time', () => {
      const iCal = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:local-event
DTSTART:20240315T140000
DTEND:20240315T150000
SUMMARY:Local Event
END:VEVENT
END:VCALENDAR`

      const events = parseICALEvent(iCal, 'cal-1')

      expect(events[0].start).toContain('T')
      expect(events[0].end).toContain('T')
    })

    it('handles datetime with TZID parameter', () => {
      const iCal = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:tzid-event
DTSTART;TZID=Europe/Berlin:20240315T080000
DTEND;TZID=Europe/Berlin:20240315T090000
SUMMARY:Berlin Event
END:VEVENT
END:VCALENDAR`

      const events = parseICALEvent(iCal, 'cal-1')

      expect(events[0].start).toContain('T')
    })

    it('exports UTC datetime with Z suffix', () => {
      const event: CalendarEvent = {
        id: 'utc-export',
        title: 'UTC Export',
        start: '2024-03-15T14:00:00.000Z',
        end: '2024-03-15T15:00:00.000Z',
        isAllDay: false,
        calendarId: 'cal-1',
      }

      const iCal = eventToICAL(event)

      expect(iCal).toContain('DTSTART:20240315T140000Z')
      expect(iCal).toContain('DTEND:20240315T150000Z')
    })
  })

  describe('VTODO functions', () => {
    describe('parseICALTask', () => {
      it('parses basic VTODO', () => {
        const iCalData = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTODO
UID:task-123
SUMMARY:Buy groceries
DUE;VALUE=DATE:20240320
PRIORITY:1
END:VTODO
END:VCALENDAR`

        const tasks = parseICALTask(iCalData, 'cal-1')

        expect(tasks).toHaveLength(1)
        expect(tasks[0].id).toBe('task-123')
        expect(tasks[0].title).toBe('Buy groceries')
        expect(tasks[0].type).toBe('task')
        expect(tasks[0].dueDate).toContain('2024-03-20')
        expect(tasks[0].priority).toBe(1)
      })

      it('parses completed task', () => {
        const iCalData = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTODO
UID:task-456
SUMMARY:Completed task
STATUS:COMPLETED
PERCENT-COMPLETE:100
END:VTODO
END:VCALENDAR`

        const tasks = parseICALTask(iCalData, 'cal-1')
        const task = tasks[0]

        expect(task).toBeDefined()
        expect(task.percentComplete).toBe(100)
        expect(task.completed).toBe(true)
      })

      it('handles multiple tasks', () => {
        const iCalData = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTODO
UID:task-1
SUMMARY:Task 1
END:VTODO
BEGIN:VTODO
UID:task-2
SUMMARY:Task 2
END:VTODO
END:VCALENDAR`

        const tasks = parseICALTask(iCalData, 'cal-1')

        expect(tasks).toHaveLength(2)
      })
    })

    describe('taskToICAL', () => {
      it('converts basic task to VTODO format', () => {
        const task: CalendarEvent = {
          id: 'task-123',
          title: 'Buy groceries',
          start: '2024-03-20T00:00:00',
          end: '2024-03-20T23:59:59',
          isAllDay: true,
          calendarId: 'cal-1',
          type: 'task',
          dueDate: '2024-03-20T00:00:00',
          priority: 1,
        }

        const iCal = taskToICAL(task)

        expect(iCal).toContain('BEGIN:VTODO')
        expect(iCal).toContain('UID:task-123')
        expect(iCal).toContain('SUMMARY:Buy groceries')
        expect(iCal).toContain('DUE;VALUE=DATE:')
        expect(iCal).toContain('PRIORITY:1')
        expect(iCal).toContain('STATUS:NEEDS-ACTION')
        expect(iCal).toContain('END:VTODO')
      })

      it('includes COMPLETED status for completed tasks', () => {
        const task: CalendarEvent = {
          id: 'task-456',
          title: 'Done task',
          start: '2024-03-20T00:00:00',
          end: '2024-03-20T23:59:59',
          isAllDay: true,
          calendarId: 'cal-1',
          type: 'task',
          completed: true,
          percentComplete: 100,
        }

        const iCal = taskToICAL(task)

        expect(iCal).toContain('STATUS:COMPLETED')
        expect(iCal).toContain('PERCENT-COMPLETE:100')
      })

      it('maps priority correctly', () => {
        const taskHigh: CalendarEvent = {
          id: 'task-high',
          title: 'High priority',
          start: '2024-03-20T00:00:00',
          end: '2024-03-20T23:59:59',
          isAllDay: true,
          calendarId: 'cal-1',
          type: 'task',
          priority: 1,
        }

        const taskLow: CalendarEvent = {
          id: 'task-low',
          title: 'Low priority',
          start: '2024-03-20T00:00:00',
          end: '2024-03-20T23:59:59',
          isAllDay: true,
          calendarId: 'cal-1',
          type: 'task',
          priority: 3,
        }

        const iCalHigh = taskToICAL(taskHigh)
        const iCalLow = taskToICAL(taskLow)

        expect(iCalHigh).toContain('PRIORITY:1')
        expect(iCalLow).toContain('PRIORITY:9')
      })
    })
  })

  describe('parseICALData', () => {
    it('parses both events and tasks from combined iCal data', () => {
      const iCalData = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-1
SUMMARY:Test Event
DTSTART:20240315T140000Z
DTEND:20240315T150000Z
END:VEVENT
BEGIN:VTODO
UID:task-1
SUMMARY:Test Task
DUE:20240315
END:VTODO
END:VCALENDAR`

      const result = parseICALData(iCalData, 'cal-1')

      expect(result).toHaveLength(2)
      const event = result.find((e) => e.id === 'event-1')
      const task = result.find((e) => e.id === 'task-1')
      expect(event).toBeDefined()
      expect(event?.type).toBeUndefined()
      expect(task).toBeDefined()
      expect(task?.type).toBe('task')
    })

    it('returns empty array for empty iCal data', () => {
      const result = parseICALData('', 'cal-1')
      expect(result).toHaveLength(0)
    })

    it('returns only events when no tasks present', () => {
      const iCalData = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-1
SUMMARY:Test Event
DTSTART:20240315T140000Z
DTEND:20240315T150000Z
END:VEVENT
END:VCALENDAR`

      const result = parseICALData(iCalData, 'cal-1')

      expect(result).toHaveLength(1)
      expect(result[0]?.type).toBeUndefined()
    })

    it('returns only tasks when no events present', () => {
      const iCalData = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTODO
UID:task-1
SUMMARY:Test Task
DUE:20240315
END:VTODO
END:VCALENDAR`

      const result = parseICALData(iCalData, 'cal-1')

      expect(result).toHaveLength(1)
      expect(result[0]?.type).toBe('task')
    })
  })
})
