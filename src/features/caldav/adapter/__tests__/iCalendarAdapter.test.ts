import { describe, it, expect } from 'vitest'
import ICAL from 'ical.js'
import {
  eventToICAL,
  foldICalLines,
  parseICALData,
  parseICALEvent,
  parseICALTask,
  taskToICAL,
} from '../iCalendarAdapter'
import {
  calendarEventToIcalComponent,
  calendarEventToIcalVjournal,
  calendarEventToIcalVtodo,
} from '../icalTypeMapping'
import type { CalendarEvent, Reminder } from '@/types'

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

    it('includes SEQUENCE when present', () => {
      const event: CalendarEvent = {
        id: 'test-id',
        title: 'Event',
        start: '2024-03-15T14:00:00',
        end: '2024-03-15T15:00:00',
        isAllDay: false,
        calendarId: 'cal-1',
        sequence: 5,
      }

      const iCal = eventToICAL(event)

      expect(iCal).toContain('SEQUENCE:5')
    })

    it('defaults SEQUENCE to 0 when not present', () => {
      const event: CalendarEvent = {
        id: 'test-id',
        title: 'Event',
        start: '2024-03-15T14:00:00',
        end: '2024-03-15T15:00:00',
        isAllDay: false,
        calendarId: 'cal-1',
      }

      const iCal = eventToICAL(event)

      expect(iCal).toContain('SEQUENCE:0')
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

    it('exports EXDATE for excludedDates in recurring event', () => {
      const event: CalendarEvent = {
        id: 'test-exdate',
        title: 'Daily Standup',
        start: '2024-03-01T00:00:00.000Z',
        end: '2024-03-01T00:30:00.000Z',
        isAllDay: false,
        calendarId: 'cal-1',
        recurrence: {
          frequency: 'daily',
          interval: 1,
        },
        excludedDates: ['2024-03-05T00:00:00.000Z', '2024-03-06T00:00:00.000Z'],
      }

      const iCal = eventToICAL(event)

      expect(iCal).toContain('EXDATE:20240305T000000Z')
      expect(iCal).toContain('EXDATE:20240306T000000Z')
    })

    it('exports EXDATE with VALUE=DATE for all-day events', () => {
      const event: CalendarEvent = {
        id: 'test-exdate-allday',
        title: 'Weekly Review',
        start: '2024-03-01T00:00:00.000Z',
        end: '2024-03-01T23:59:59.000Z',
        isAllDay: true,
        calendarId: 'cal-1',
        recurrence: {
          frequency: 'weekly',
          interval: 1,
        },
        excludedDates: ['2024-03-08T00:00:00.000Z', '2024-03-15T00:00:00.000Z'],
      }

      const iCal = eventToICAL(event)

      expect(iCal).toContain('EXDATE;VALUE=DATE:20240308')
      expect(iCal).toContain('EXDATE;VALUE=DATE:20240315')
    })

    it('exports RECURRENCE-ID with VALUE=DATE for all-day events', () => {
      const event: CalendarEvent = {
        id: 'test-recurrence-id-allday',
        title: 'Exception All-Day Event',
        start: '2024-03-20T00:00:00.000Z',
        end: '2024-03-20T23:59:59.000Z',
        isAllDay: true,
        calendarId: 'cal-1',
        recurrenceId: '2024-03-15T00:00:00.000Z',
      }

      const iCal = eventToICAL(event)

      expect(iCal).toContain('RECURRENCE-ID;VALUE=DATE:20240315')
    })

    it('exports RECURRENCE-ID with DATE-TIME for non-all-day events', () => {
      const event: CalendarEvent = {
        id: 'test-recurrence-id-datetime',
        title: 'Exception Date-Time Event',
        start: '2024-03-20T14:00:00.000Z',
        end: '2024-03-20T15:00:00.000Z',
        isAllDay: false,
        calendarId: 'cal-1',
        recurrenceId: '2024-03-15T14:00:00.000Z',
      }

      const iCal = eventToICAL(event)

      expect(iCal).toContain('RECURRENCE-ID:20240315T140000Z')
    })

    it('exception event with recurrenceId does NOT have RRULE', () => {
      const event: CalendarEvent = {
        id: 'test-exception',
        title: 'Exception Event',
        start: '2024-03-20T14:00:00.000Z',
        end: '2024-03-20T15:00:00.000Z',
        isAllDay: false,
        calendarId: 'cal-1',
        recurrenceId: '2024-03-15T14:00:00.000Z',
      }

      const iCal = eventToICAL(event)

      expect(iCal).toContain('RECURRENCE-ID:')
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
      expect(events[0].start).toBe('2024-03-15')
      expect(events[0].end).toBe('2024-03-15')
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

    it('parses SEQUENCE field', () => {
      const iCal = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-123
DTSTART:20240315T140000Z
DTEND:20240315T150000Z
SUMMARY:Test Event
SEQUENCE:3
END:VEVENT
END:VCALENDAR`

      const events = parseICALEvent(iCal, 'cal-1')

      expect(events[0].sequence).toBe(3)
    })

    it('defaults sequence to undefined when not present', () => {
      const iCal = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-123
DTSTART:20240315T140000Z
DTEND:20240315T150000Z
SUMMARY:Test Event
END:VEVENT
END:VCALENDAR`

      const events = parseICALEvent(iCal, 'cal-1')

      expect(events[0].sequence).toBeUndefined()
    })

    it('parses RECURRENCE-ID with VALUE=DATE for all-day events', () => {
      const iCal = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-123
DTSTART;VALUE=DATE:20240315
DTEND;VALUE=DATE:20240316
SUMMARY:Exception Event
RECURRENCE-ID;VALUE=DATE:20240315
END:VEVENT
END:VCALENDAR`

      const events = parseICALEvent(iCal, 'cal-1')

      expect(events).toHaveLength(1)
      expect(events[0].recurrenceId).toBeDefined()
      expect(events[0].recurrenceId).toContain('2024-03-15')
      expect(events[0].start).toBe('2024-03-15')
      expect(events[0].end).toBe('2024-03-15')
    })

    it('parses RECURRENCE-ID with DATE-TIME for non-all-day events', () => {
      const iCal = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-123
DTSTART:20240315T140000Z
DTEND:20240315T150000Z
SUMMARY:Exception Event
RECURRENCE-ID:20240315T140000Z
END:VEVENT
END:VCALENDAR`

      const events = parseICALEvent(iCal, 'cal-1')

      expect(events).toHaveLength(1)
      expect(events[0].recurrenceId).toBeDefined()
      expect(events[0].recurrenceId).toContain('T14:00:00')
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
      expect(parsedEvents[0].start).toBe('2024-03-15')
      expect(parsedEvents[0].end).toBe('2024-03-16')
    })

    it('round-trip preserves SEQUENCE', () => {
      const originalEvent: CalendarEvent = {
        id: 'sequence-test',
        title: 'Sequence Test',
        start: '2024-03-15T14:00:00',
        end: '2024-03-15T15:00:00',
        isAllDay: false,
        calendarId: 'cal-1',
        sequence: 7,
      }

      const iCal = eventToICAL(originalEvent)
      const parsedEvents = parseICALEvent(iCal, 'cal-1')

      expect(parsedEvents[0].sequence).toBe(7)
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

      it('parses SEQUENCE from VTODO', () => {
        const iCalData = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTODO
UID:task-seq
SUMMARY:Task with sequence
SEQUENCE:4
END:VTODO
END:VCALENDAR`

        const tasks = parseICALTask(iCalData, 'cal-1')

        expect(tasks[0].sequence).toBe(4)
      })

      it('parses RELATED-TO without RELTYPE or with RELTYPE=PARENT as the parent task', () => {
        const iCalData = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTODO
UID:task-default-parent
SUMMARY:Task with implicit parent
RELATED-TO:parent-default
END:VTODO
BEGIN:VTODO
UID:task-explicit-parent
SUMMARY:Task with explicit parent
RELATED-TO;RELTYPE=PARENT:parent-explicit
RELATED-TO;RELTYPE=CHILD:child-task
END:VTODO
BEGIN:VTODO
UID:task-blank-parent
SUMMARY:Task with blank parent relation
RELATED-TO;RELTYPE=:parent-blank
END:VTODO
END:VCALENDAR`

        const tasks = parseICALTask(iCalData, 'cal-1')

        expect(tasks[0].parentTaskId).toBe('parent-default')
        expect(tasks[1].parentTaskId).toBe('parent-explicit')
        expect(tasks[2].parentTaskId).toBe('parent-blank')
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

      it('includes SEQUENCE when present', () => {
        const task: CalendarEvent = {
          id: 'task-seq',
          title: 'Task with sequence',
          start: '2024-03-20T00:00:00',
          end: '2024-03-20T23:59:59',
          isAllDay: true,
          calendarId: 'cal-1',
          type: 'task',
          sequence: 2,
        }

        const iCal = taskToICAL(task)

        expect(iCal).toContain('SEQUENCE:2')
      })

      it('defaults SEQUENCE to 0 for tasks', () => {
        const task: CalendarEvent = {
          id: 'task-no-seq',
          title: 'Task without sequence',
          start: '2024-03-20T00:00:00',
          end: '2024-03-20T23:59:59',
          isAllDay: true,
          calendarId: 'cal-1',
          type: 'task',
        }

        const iCal = taskToICAL(task)

        expect(iCal).toContain('SEQUENCE:0')
      })

      it('serializes parentTaskId as RELATED-TO with RELTYPE=PARENT', () => {
        const task: CalendarEvent = {
          id: 'task-child',
          title: 'Child task',
          start: '2024-03-20T00:00:00',
          end: '2024-03-20T23:59:59',
          isAllDay: true,
          calendarId: 'cal-1',
          type: 'task',
          parentTaskId: 'task-parent',
        }

        const iCal = taskToICAL(task)

        expect(iCal).toContain('RELATED-TO;RELTYPE=PARENT:task-parent')
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

    // R1.9 regression: parseICALData used to filter the settings event by
    // exact UID match against a hardcoded literal. After R1.9 the UID is
    // per-instance (`calino-settings-<uuid>`), so the filter MUST match by
    // prefix — otherwise the settings event leaks into the event store
    // as a "Jan 1, 1970" record.
    it('filters settings events by prefix regardless of per-instance UID', () => {
      const settingsUid = 'calino-settings-deadbeef-1234-5678-9abc-def012345678'
      const iCalData = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:${settingsUid}
SUMMARY:Calino Settings
DTSTART:19700101T000000Z
DTEND:19700101T000001Z
END:VEVENT
BEGIN:VEVENT
UID:real-event
SUMMARY:Real Event
DTSTART:20240315T140000Z
DTEND:20240315T150000Z
END:VEVENT
END:VCALENDAR`

      const result = parseICALData(iCalData, 'cal-1')

      // Only the real event survives — the settings event was filtered.
      expect(result).toHaveLength(1)
      expect(result[0]?.id).toBe('real-event')
      expect(result[0]?.title).toBe('Real Event')
    })
  })

  // R1.6 regression net for the DataSettings export path. We can't easily
  // exercise the Blob/anchor-click flow, but the export uses the same
  // per-event component builders that these tests cover; if those are
  // lossless, so is the export. The test below pins the multi-component
  // pattern (single VCALENDAR with several subcomponents) and the
  // round-trip for an RRULE-bearing event.
  describe('multi-component VCALENDAR export', () => {
    function buildVCalendar(events: CalendarEvent[]): string {
      const comp = new ICAL.Component('vcalendar')
      comp.updatePropertyWithValue('version', '2.0')
      comp.updatePropertyWithValue('prodid', '-//Calino//Calendar//EN')
      comp.updatePropertyWithValue('calscale', 'GREGORIAN')
      for (const event of events) {
        if (event.type === 'task') {
          comp.addSubcomponent(calendarEventToIcalVtodo(event))
        } else if (event.type === 'journal') {
          comp.addSubcomponent(calendarEventToIcalVjournal(event))
        } else {
          comp.addSubcomponent(calendarEventToIcalComponent(event))
        }
      }
      return comp.toString()
    }

    it('serializes a recurring event with RRULE + EXDATE losslessly', () => {
      const event: CalendarEvent = {
        id: 'weekly-standup',
        type: 'event',
        title: 'Weekly Standup',
        start: '2024-03-04T09:00:00.000Z',
        end: '2024-03-04T09:30:00.000Z',
        isAllDay: false,
        calendarId: 'cal-1',
        recurrence: { frequency: 'weekly', interval: 1 },
        excludedDates: ['2024-03-11T09:00:00.000Z'],
      }

      const ics = buildVCalendar([event])

      // The output must be a single VCALENDAR with one VEVENT inside.
      expect(ics.match(/BEGIN:VCALENDAR/g)).toHaveLength(1)
      expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1)
      expect(ics.match(/END:VEVENT/g)).toHaveLength(1)
      expect(ics.match(/END:VCALENDAR/g)).toHaveLength(1)
      expect(ics).toContain('RRULE')
      expect(ics).toContain('EXDATE')

      // Round-trip through the parser and confirm the recurrence + exdate
      // survived serialization.
      const parsed = parseICALData(ics, 'cal-1')
      expect(parsed).toHaveLength(1)
      expect(parsed[0]?.rruleString ?? parsed[0]?.recurrence).toBeDefined()
      expect(parsed[0]?.excludedDates).toEqual(['2024-03-11T09:00:00.000Z'])
    })

    it('handles a mix of events, tasks, and journals in one VCALENDAR', () => {
      const ev: CalendarEvent = {
        id: 'e1',
        type: 'event',
        title: 'Meeting',
        start: '2024-03-04T09:00:00.000Z',
        end: '2024-03-04T10:00:00.000Z',
        isAllDay: false,
        calendarId: 'cal-1',
      }
      const task: CalendarEvent = {
        id: 't1',
        type: 'task',
        title: 'Buy milk',
        start: '2024-03-04T00:00:00.000Z',
        end: '2024-03-04T00:00:00.000Z',
        isAllDay: true,
        dueDate: '2024-03-04',
        calendarId: 'cal-1',
      }
      const journal: CalendarEvent = {
        id: 'j1',
        type: 'journal',
        title: 'Daily reflection',
        start: '2024-03-04T20:00:00.000Z',
        end: '2024-03-04T20:30:00.000Z',
        isAllDay: false,
        calendarId: 'cal-1',
      }

      const ics = buildVCalendar([ev, task, journal])

      expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1)
      expect(ics.match(/BEGIN:VTODO/g)).toHaveLength(1)
      expect(ics.match(/BEGIN:VJOURNAL/g)).toHaveLength(1)

      const parsed = parseICALData(ics, 'cal-1')
      expect(parsed).toHaveLength(3)
      expect(parsed.find((p) => p.id === 'e1')).toBeDefined()
      expect(parsed.find((p) => p.id === 't1')).toBeDefined()
      expect(parsed.find((p) => p.id === 'j1')).toBeDefined()
    })

    it('produces empty but valid ICS for an empty event list', () => {
      const ics = buildVCalendar([])
      expect(ics).toContain('BEGIN:VCALENDAR')
      expect(ics).toContain('END:VCALENDAR')
      expect(ics).not.toContain('BEGIN:VEVENT')
    })
  })

  // =========================================================================
  // R2 — iCalendar compliance round-trip tests
  // =========================================================================
  // These tests pin the expected post-fix behavior for R2.1 through R2.7.
  // They are designed to FAIL on the current code (which is the point — they
  // document the spec) and PASS after the corresponding fixes land.
  //
  // Where the current type system doesn't yet know about a new field
  // (`timezone`, `taskStatus`, `completedAt`, `byWeekNo`, `wkst`, etc.) we
  // cast through `any` so the test compiles. The cast is localised to the
  // single assertion that actually exercises the new field.
  // =========================================================================
  describe('R2 iCalendar compliance', () => {
    // Helper: parse an ICS string and return the first VEVENT.
    function parseFirstEvent(ics: string): CalendarEvent {
      const events = parseICALEvent(ics, 'cal-1')
      if (events.length !== 1) throw new Error(`Expected 1 event, got ${events.length}`)
      return events[0]
    }

    // ---------------------------------------------------------------------
    // R2.1 — RRULE UNTIL form for all-day events
    // ---------------------------------------------------------------------
    describe('R2.1 RRULE UNTIL form for all-day events', () => {
      it('emits UNTIL as VALUE=DATE (YYYYMMDD) for all-day events', () => {
        // Per RFC 5545 §3.3.10, all-day recurring events must emit UNTIL
        // as a date value (YYYYMMDD), not a UTC DATE-TIME.
        const event: CalendarEvent = {
          id: 'r21-allday-until',
          title: 'All-day recurring',
          start: '2025-01-01',
          end: '2025-01-01',
          isAllDay: true,
          calendarId: 'cal-1',
          recurrence: {
            frequency: 'daily',
            interval: 1,
            endDate: '2025-12-31T00:00:00.000Z',
          },
        }

        const ics = eventToICAL(event)

        expect(ics).toContain('RRULE:')
        // Post-fix: UNTIL is YYYYMMDD for all-day.
        expect(ics).toMatch(/UNTIL=20251231(?!T)/)
        expect(ics).not.toMatch(/UNTIL=20251231T000000Z/)
      })

      it('emits UNTIL as UTC DATE-TIME for non-all-day events', () => {
        // Inverse: non-all-day events keep the UTC DATETIME form.
        const event: CalendarEvent = {
          id: 'r21-datetime-until',
          title: 'Date-time recurring',
          start: '2025-01-01T09:00:00.000Z',
          end: '2025-01-01T10:00:00.000Z',
          isAllDay: false,
          calendarId: 'cal-1',
          recurrence: {
            frequency: 'daily',
            interval: 1,
            endDate: '2025-12-31T00:00:00.000Z',
          },
        }

        const ics = eventToICAL(event)

        expect(ics).toContain('UNTIL=20251231T000000Z')
      })
    })

    // ---------------------------------------------------------------------
    // R2.2 — Preserve TZID on VEVENT round-trip
    // ---------------------------------------------------------------------
    describe('R2.2 Preserve TZID on VEVENT round-trip', () => {
      it('preserves TZID through parse and serialize', () => {
        const ics = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'PRODID:-//Test//Test//EN',
          'BEGIN:VEVENT',
          'UID:tzid-r22',
          'DTSTAMP:20250706T100000Z',
          'DTSTART;TZID=America/New_York:20250706T150000',
          'DTEND;TZID=America/New_York:20250706T160000',
          'SUMMARY:TZID Event',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n')

        const event = parseFirstEvent(ics)
        // Post-fix: parsed event must carry the IANA TZID so we can re-emit it.
        const withTz = event as CalendarEvent & { timezone?: string }
        expect(withTz.timezone).toBe('America/New_York')

        // Re-serialize and confirm the TZID survived.
        const out = eventToICAL(event)
        expect(out).toContain('DTSTART;TZID=America/New_York:20250706T150000')
        expect(out).toContain('DTEND;TZID=America/New_York:20250706T160000')
        // And it must not be silently converted to UTC.
        expect(out).not.toMatch(/DTSTART:20250706T1[5-9]0000Z/)
      })
    })

    // ---------------------------------------------------------------------
    // R2.3 — EXDATE / RECURRENCE-ID: value-form must match DTSTART
    // ---------------------------------------------------------------------
    describe('R2.3 EXDATE / RECURRENCE-ID: value-form must match DTSTART', () => {
      it('preserves EXDATE;VALUE=DATE for all-day events', () => {
        const ics = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'BEGIN:VEVENT',
          'UID:exdate-allday',
          'DTSTAMP:20250101T100000Z',
          'DTSTART;VALUE=DATE:20250101',
          'DTEND;VALUE=DATE:20250102',
          'SUMMARY:All-day EXDATE',
          'RRULE:FREQ=DAILY;COUNT=30',
          'EXDATE;VALUE=DATE:20250115,20250116',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n')

        const event = parseFirstEvent(ics)
        expect(event.excludedDates).toEqual(['2025-01-15', '2025-01-16'])

        const out = eventToICAL(event)
        expect(out).toContain('EXDATE;VALUE=DATE:20250115')
        expect(out).toContain('EXDATE;VALUE=DATE:20250116')
      })

      it('preserves EXDATE;TZID=... when DTSTART has a TZID', () => {
        const ics = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'BEGIN:VEVENT',
          'UID:exdate-tzid',
          'DTSTAMP:20250706T100000Z',
          'DTSTART;TZID=America/New_York:20250706T150000',
          'DTEND;TZID=America/New_York:20250706T160000',
          'SUMMARY:TZID EXDATE',
          'RRULE:FREQ=WEEKLY;COUNT=5',
          'EXDATE;TZID=America/New_York:20250713T150000',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n')

        const event = parseFirstEvent(ics)
        const out = eventToICAL(event)
        // The EXDATE value-form must match the DTSTART (TZID, not UTC).
        expect(out).toContain('EXDATE;TZID=America/New_York:20250713T150000')
        // The current code converts to UTC — this must not appear post-fix.
        expect(out).not.toMatch(/EXDATE[^:]*:20250713T1[5-9]0000Z/)
      })

      // R2.3 review follow-up (Gap 4): RECURRENCE-ID;TZID round-trip.
      // The serializer branches on event.timezone for RECURRENCE-ID just
      // as it does for EXDATE; this pins the TZID form so a future
      // refactor that drops setParameter('tzid', ...) is caught.
      it('preserves RECURRENCE-ID;TZID=... when DTSTART has a TZID', () => {
        const ics = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'BEGIN:VEVENT',
          'UID:master-tzid',
          'DTSTAMP:20250706T100000Z',
          'DTSTART;TZID=America/New_York:20250706T150000',
          'DTEND;TZID=America/New_York:20250706T160000',
          'SUMMARY:Master with TZID',
          'RRULE:FREQ=WEEKLY;COUNT=3',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'UID:exception-tzid',
          'DTSTAMP:20250706T100000Z',
          'RECURRENCE-ID;TZID=America/New_York:20250713T150000',
          'DTSTART;TZID=America/New_York:20250713T170000',
          'DTEND;TZID=America/New_York:20250713T180000',
          'SUMMARY:Exception (moved 2h)',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n')

        const events = parseICALEvent(ics, 'cal-1')
        const exception = events.find((e) => e.id === 'exception-tzid')
        expect(exception).toBeDefined()
        expect(exception!.timezone).toBe('America/New_York')
        expect(exception!.recurrenceId).toBe('2025-07-13T15:00:00')

        const out = eventToICAL(exception!)
        expect(out).toContain('RECURRENCE-ID;TZID=America/New_York:20250713T150000')
        // Must not be UTC-converted (the wall-clock is preserved, not the absolute instant).
        expect(out).not.toMatch(/RECURRENCE-ID[^:]*:20250713T1[5-9]0000Z/)
      })
    })

    // ---------------------------------------------------------------------
    // R2.4 — RRULE: missing parts preserved on round-trip
    // ---------------------------------------------------------------------
    describe('R2.4 RRULE: missing parts preserved on round-trip', () => {
      it('parses WKST, BYHOUR, BYMINUTE, BYWEEKNO into the recurrence object', () => {
        const ics = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'BEGIN:VEVENT',
          'UID:rrule-complex',
          'DTSTAMP:20250101T100000Z',
          'DTSTART:20250101T090000Z',
          'DTEND:20250101T100000Z',
          'SUMMARY:Complex RRULE',
          'RRULE:FREQ=MONTHLY;BYDAY=2MO,-1FR;BYSETPOS=-1;WKST=MO;BYHOUR=9;BYMINUTE=30;COUNT=12;INTERVAL=2;BYWEEKNO=20',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n')

        const event = parseFirstEvent(ics)
        const recurrence = event.recurrence as CalendarEvent['recurrence'] & {
          wkst?: string
          byHour?: number[]
          byMinute?: number[]
          byWeekNo?: number[]
        }

        // R2.4: parseRRule must populate these. Today the parser silently
        // drops WKST, BYHOUR, BYMINUTE, BYWEEKNO.
        expect(recurrence.wkst).toBe('MO')
        expect(recurrence.byHour).toEqual([9])
        expect(recurrence.byMinute).toEqual([30])
        expect(recurrence.byWeekNo).toEqual([20])
        // These already work — they're here to guard against regression.
        expect(recurrence.count).toBe(12)
        expect(recurrence.interval).toBe(2)
      })

      it('parses YEARLY+BYWEEKNO+BYDAY (week-number case)', () => {
        const ics = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'BEGIN:VEVENT',
          'UID:rrule-weekno',
          'DTSTAMP:20250101T100000Z',
          'DTSTART:20250101T090000Z',
          'DTEND:20250101T100000Z',
          'SUMMARY:Week-number RRULE',
          'RRULE:FREQ=YEARLY;BYWEEKNO=20;BYDAY=MO',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n')

        const event = parseFirstEvent(ics)
        const recurrence = event.recurrence as CalendarEvent['recurrence'] & {
          byWeekNo?: number[]
        }

        expect(recurrence.frequency).toBe('yearly')
        expect(recurrence.byWeekNo).toEqual([20])
        expect(recurrence.byWeekday).toEqual([1])
      })
    })

    // ---------------------------------------------------------------------
    // R2.5 — VTODO STATUS, percent-complete, COMPLETED timestamp
    // ---------------------------------------------------------------------
    describe('R2.5 VTODO STATUS, percent-complete, COMPLETED timestamp', () => {
      it('parses STATUS:IN-PROCESS with PERCENT-COMPLETE:50', () => {
        const ics = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'BEGIN:VTODO',
          'UID:task-inproc',
          'SUMMARY:In-progress task',
          'DUE:20240615T120000Z',
          'STATUS:IN-PROCESS',
          'PERCENT-COMPLETE:50',
          'END:VTODO',
          'END:VCALENDAR',
        ].join('\r\n')

        const task = parseICALTask(ics, 'cal-1')[0]
        expect(task).toBeDefined()
        const withStatus = task as CalendarEvent & {
          taskStatus?: 'NEEDS-ACTION' | 'IN-PROCESS' | 'COMPLETED' | 'CANCELLED'
        }
        expect(withStatus.taskStatus).toBe('IN-PROCESS')
        expect(task.percentComplete).toBe(50)
      })

      it('preserves STATUS:IN-PROCESS on serialize (round-trip)', () => {
        const ics = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'BEGIN:VTODO',
          'UID:task-inproc-rt',
          'SUMMARY:Round-trip in-progress',
          'DUE:20240615T120000Z',
          'STATUS:IN-PROCESS',
          'PERCENT-COMPLETE:50',
          'END:VTODO',
          'END:VCALENDAR',
        ].join('\r\n')

        const task = parseICALTask(ics, 'cal-1')[0]
        const out = taskToICAL(task)
        // Today the serializer only emits STATUS:NEEDS-ACTION or STATUS:COMPLETED.
        expect(out).toContain('STATUS:IN-PROCESS')
        expect(out).toContain('PERCENT-COMPLETE:50')
      })

      it('preserves the original COMPLETED timestamp on parse and serialize', () => {
        const ics = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'BEGIN:VTODO',
          'UID:task-completed-ts',
          'SUMMARY:Completed task',
          'DUE:20240615T120000Z',
          'STATUS:COMPLETED',
          'PERCENT-COMPLETE:100',
          'COMPLETED:20240615T143000Z',
          'END:VTODO',
          'END:VCALENDAR',
        ].join('\r\n')

        const task = parseICALTask(ics, 'cal-1')[0]
        const withCompletedAt = task as CalendarEvent & { completedAt?: string }
        // Post-fix: the parsed event must carry the original COMPLETED timestamp.
        expect(withCompletedAt.completedAt).toBe('2024-06-15T14:30:00.000Z')

        const out = taskToICAL(task)
        // Re-serialize must use the original timestamp, not now().
        expect(out).toContain('COMPLETED:20240615T143000Z')
      })

      it('parses STATUS:NEEDS-ACTION without percent-complete', () => {
        const ics = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'BEGIN:VTODO',
          'UID:task-needs',
          'SUMMARY:Needs action task',
          'DUE:20240620T120000Z',
          'STATUS:NEEDS-ACTION',
          'END:VTODO',
          'END:VCALENDAR',
        ].join('\r\n')

        const task = parseICALTask(ics, 'cal-1')[0]
        const withStatus = task as CalendarEvent & {
          taskStatus?: 'NEEDS-ACTION' | 'IN-PROCESS' | 'COMPLETED' | 'CANCELLED'
        }
        expect(withStatus.taskStatus).toBe('NEEDS-ACTION')
        expect(task.percentComplete).toBeUndefined()
      })

      it('parses STATUS:CANCELLED', () => {
        const ics = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'BEGIN:VTODO',
          'UID:task-cancelled',
          'SUMMARY:Cancelled task',
          'DUE:20240620T120000Z',
          'STATUS:CANCELLED',
          'END:VTODO',
          'END:VCALENDAR',
        ].join('\r\n')

        const task = parseICALTask(ics, 'cal-1')[0]
        const withStatus = task as CalendarEvent & {
          taskStatus?: 'NEEDS-ACTION' | 'IN-PROCESS' | 'COMPLETED' | 'CANCELLED'
        }
        expect(withStatus.taskStatus).toBe('CANCELLED')
      })
    })

    // ---------------------------------------------------------------------
    // R2.6 — VALARM: ACTION and trigger forms
    // ---------------------------------------------------------------------
    describe('R2.6 VALARM: ACTION and trigger forms', () => {
      it('parses ACTION:EMAIL with TRIGGER:-P2D (2 days before)', () => {
        const ics = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'BEGIN:VEVENT',
          'UID:valarm-email',
          'DTSTAMP:20250101T100000Z',
          'DTSTART:20250115T150000Z',
          'DTEND:20250115T160000Z',
          'SUMMARY:Email reminder',
          'BEGIN:VALARM',
          'ACTION:EMAIL',
          'TRIGGER:-P2D',
          'END:VALARM',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n')

        const event = parseFirstEvent(ics)
        // Post-fix: ACTION:EMAIL must round-trip into Reminder.method,
        // and -P2D must be parsed as 2 * 24 * 60 = 2880 minutes before.
        expect(event.reminders).toBeDefined()
        expect(event.reminders).toHaveLength(1)
        const reminder = event.reminders![0] as Reminder & { method: string }
        expect(reminder.method).toBe('email')
        expect(reminder.minutesBefore).toBe(2880)
      })

      it('parses TRIGGER:-PT15M (15 minutes before) — documents current behavior', () => {
        const ics = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'BEGIN:VEVENT',
          'UID:valarm-15m',
          'DTSTAMP:20250101T100000Z',
          'DTSTART:20250115T150000Z',
          'DTEND:20250115T160000Z',
          'SUMMARY:15m reminder',
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          'TRIGGER:-PT15M',
          'END:VALARM',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n')

        const event = parseFirstEvent(ics)
        expect(event.reminders).toHaveLength(1)
        expect(event.reminders![0].minutesBefore).toBe(15)
      })

      it('parses TRIGGER:+PT15M (post-event reminder)', () => {
        const ics = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'BEGIN:VEVENT',
          'UID:valarm-plus',
          'DTSTAMP:20250101T100000Z',
          'DTSTART:20250115T150000Z',
          'DTEND:20250115T160000Z',
          'SUMMARY:Post-event reminder',
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          'TRIGGER:+PT15M',
          'END:VALARM',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n')

        const event = parseFirstEvent(ics)
        // +PT15M is parsed by ical.js's ICAL.Duration as a positive
        // duration. The reminder's minutesBefore is taken from
        // Math.abs(...) to handle the sign uniformly; some clients
        // interpret post-event triggers as positive and pre-event as
        // negative, but Calino stores minutes-before-event uniformly.
        expect(event.reminders).toHaveLength(1)
        const reminder = event.reminders![0]
        expect(Math.abs(reminder.minutesBefore)).toBe(15)
      })

      it('parses TRIGGER:P1W (1 week before)', () => {
        const ics = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'BEGIN:VEVENT',
          'UID:valarm-p1w',
          'DTSTAMP:20250101T100000Z',
          'DTSTART:20250115T150000Z',
          'DTEND:20250115T160000Z',
          'SUMMARY:Week-before reminder',
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          'TRIGGER:P1W',
          'END:VALARM',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n')

        const event = parseFirstEvent(ics)
        expect(event.reminders).toHaveLength(1)
        // 1 week = 7 * 24 * 60 = 10080 minutes.
        expect(event.reminders![0].minutesBefore).toBe(7 * 24 * 60)
      })

      it('parses TRIGGER:P7D (7 days before)', () => {
        const ics = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'BEGIN:VEVENT',
          'UID:valarm-p7d',
          'DTSTAMP:20250101T100000Z',
          'DTSTART:20250115T150000Z',
          'DTEND:20250115T160000Z',
          'SUMMARY:7-day reminder',
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          'TRIGGER:P7D',
          'END:VALARM',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n')

        const event = parseFirstEvent(ics)
        expect(event.reminders).toHaveLength(1)
        expect(event.reminders![0].minutesBefore).toBe(7 * 24 * 60)
      })

      it('parses TRIGGER:-P1DT2H (1 day, 2 hours before)', () => {
        const ics = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'BEGIN:VEVENT',
          'UID:valarm-p1dt2h',
          'DTSTAMP:20250101T100000Z',
          'DTSTART:20250115T150000Z',
          'DTEND:20250115T160000Z',
          'SUMMARY:1d2h reminder',
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          'TRIGGER:-P1DT2H',
          'END:VALARM',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n')

        const event = parseFirstEvent(ics)
        expect(event.reminders).toHaveLength(1)
        // 1 day + 2 hours = 26 hours = 1560 minutes.
        expect(event.reminders![0].minutesBefore).toBe(26 * 60)
      })

      it('preserves both DISPLAY and EMAIL VALARMs on round-trip', () => {
        // Build the event with two reminders, then serialize and check that
        // both ACTIONs survive. Currently the serializer ignores `method` and
        // emits ACTION:DISPLAY for every reminder, so ACTION:EMAIL is lost.
        const event: CalendarEvent = {
          id: 'r26-two-alarms',
          title: 'Two reminders',
          start: '2025-01-15T15:00:00.000Z',
          end: '2025-01-15T16:00:00.000Z',
          isAllDay: false,
          calendarId: 'cal-1',
          reminders: [
            { id: 'r1', method: 'popup', minutesBefore: 15 },
            { id: 'r2', method: 'email', minutesBefore: 2880 },
          ],
        }

        const out = eventToICAL(event)
        // Both VALARMs must be present, with distinct ACTIONs.
        expect(out.match(/BEGIN:VALARM/g)).toHaveLength(2)
        expect(out).toContain('ACTION:DISPLAY')
        expect(out).toContain('ACTION:EMAIL')
        expect(out).toContain('TRIGGER:-PT15M')
        // 2880 minutes = 2 days; the fix should emit the day form, not 2880M.
        expect(out).toMatch(/TRIGGER:-P2D/)
      })

      // R2.6 review follow-up (Gap 2): the formatReminderTrigger function
      // has 6 distinct branches — only 2 were exercised by the round-trip
      // tests above (15 → -PT15M and 2880 → -P2D). These tests pin the
      // remaining branches so a refactor can't silently degrade them.
      it.each([
        [0, 'TRIGGER:-PT0M'],
        [30, 'TRIGGER:-PT30M'],
        [60, 'TRIGGER:-PT1H'],
        [90, 'TRIGGER:-PT1H30M'],
        [1440, 'TRIGGER:-P1D'],
        [10080, 'TRIGGER:-P1W'],
      ])('emits %i minutes as %s', (minutesBefore, expected) => {
        const event: CalendarEvent = {
          id: 'r26-trigger-form',
          title: 'Trigger form test',
          start: '2025-01-15T15:00:00.000Z',
          end: '2025-01-15T16:00:00.000Z',
          isAllDay: false,
          calendarId: 'cal-1',
          reminders: [{ id: 'r1', method: 'popup', minutesBefore }],
        }
        const out = eventToICAL(event)
        expect(out).toContain(expected)
      })
    })

    // ---------------------------------------------------------------------
    // R2.7 — Settings VEVENT: line folding + CRLF
    // ---------------------------------------------------------------------
    describe('R2.7 Settings VEVENT: line folding + CRLF', () => {
      it('eventToICAL folds long content lines to ≤75 octets with CRLF', () => {
        // 1000-char description forces line folding.
        const longDescription = 'A'.repeat(1000)
        const event: CalendarEvent = {
          id: 'r27-long-desc',
          title: 'Long description',
          description: longDescription,
          start: '2025-01-15T15:00:00.000Z',
          end: '2025-01-15T16:00:00.000Z',
          isAllDay: false,
          calendarId: 'cal-1',
        }

        const out = eventToICAL(event)

        // Line endings must be CRLF.
        expect(out).toContain('\r\n')
        expect(out).not.toMatch(/[^\r]\n/)
        // Every physical line must be ≤75 octets (RFC 5545 §3.1).
        const physicalLines = out.split('\r\n')
        for (const line of physicalLines) {
          // octet length = byte length of UTF-8 encoding
          const octets = new TextEncoder().encode(line).length
          expect(octets).toBeLessThanOrEqual(75)
        }
      })
    })

    // ---------------------------------------------------------------------
    // foldICalLines — direct unit tests for the post-processor
    // (R2.7 review follow-up, Gap 3).
    // ---------------------------------------------------------------------
    describe('foldICalLines', () => {
      it('returns the empty string unchanged', () => {
        expect(foldICalLines('')).toBe('')
      })

      it('passes through a line of exactly 75 octets without folding', () => {
        const line = 'A'.repeat(75)
        expect(foldICalLines(line)).toBe(line)
      })

      it('folds a line of 76 octets into a 75-octet line + 1-octet continuation', () => {
        const line = 'A'.repeat(76)
        const out = foldICalLines(line)
        const lines = out.split('\r\n')
        expect(lines).toHaveLength(2)
        expect(lines[0]).toBe('A'.repeat(75))
        // Continuation: leading space + remaining 1 octet
        expect(lines[1]).toBe(' A')
        // Every line ≤75 octets
        for (const l of lines) {
          expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75)
        }
      })

      it('folds each long line independently and passes short lines through verbatim', () => {
        const long = 'B'.repeat(200)
        const short = 'short'
        const out = foldICalLines(`${long}\r\n${short}`)
        const lines = out.split('\r\n')
        // 200 = 75 + 75 + 50 → 3 physical lines for the long input
        // + 1 for the short = 4 total
        expect(lines).toHaveLength(4)
        expect(lines[3]).toBe(short)
        for (const l of lines) {
          expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75)
        }
      })

      it('prefixes each continuation with exactly one space per RFC 5545 §3.1', () => {
        const line = 'C'.repeat(200)
        const out = foldICalLines(line)
        const lines = out.split('\r\n')
        // First line: no leading space. Continuations: exactly one leading space.
        expect(lines[0].startsWith(' ')).toBe(false)
        for (let i = 1; i < lines.length; i++) {
          expect(lines[i].startsWith(' ')).toBe(true)
          expect(lines[i].startsWith('  ')).toBe(false) // not two spaces
        }
      })

      // Unfold per RFC 5545: strip CRLF + the single continuation space.
      const unfold = (s: string): string => s.replace(/\r\n /g, '')

      it('never splits a 2-octet char (é) straddling the 75-octet boundary', () => {
        // 74 A's + 'é' puts the multibyte char across octet 75.
        const line = 'A'.repeat(74) + 'é' + 'B'.repeat(30)
        const out = foldICalLines(line)
        expect(out).not.toContain('�') // no corruption
        expect(unfold(out)).toBe(line) // round-trips byte-identical
        for (const l of out.split('\r\n')) {
          expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75)
        }
      })

      it('never splits a 4-octet emoji straddling the boundary', () => {
        const line = 'A'.repeat(73) + '\u{1F600}' + 'A'.repeat(20)
        const out = foldICalLines(line)
        expect(out).not.toContain('�')
        expect(unfold(out)).toBe(line)
        for (const l of out.split('\r\n')) {
          expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75)
        }
      })

      it('round-trips a long all-multibyte line with no corruption', () => {
        const line = 'é'.repeat(120) // 240 octets, boundaries land mid-nowhere-safe
        const out = foldICalLines(line)
        expect(out).not.toContain('�')
        expect(unfold(out)).toBe(line)
        for (const l of out.split('\r\n')) {
          expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75)
        }
      })
    })
  })
})
