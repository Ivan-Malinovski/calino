import ICAL from 'ical.js'
import { describe, it, expect, beforeEach } from 'vitest'
import { useCalendarStore, getTasksForDay } from '../calendarStore'
import { icalVtodoToCalendarEvent } from '@/features/caldav/adapter/icalTypeMapping'
import { buildRecurrenceSet, nextOpenOccurrence } from '@/lib/occurrenceExpansion'
import { resolveRecurringTasks } from '@/lib/openTasks'
import { makeRecurringTask, makeTask } from '@/lib/__tests__/fixtures'
import type { CalendarEvent } from '@/types'

/**
 * Issue #275 — a missed recurring task jumped to its next due date instead of
 * going overdue.
 *
 * RFC 5545 §3.8.5.3: "The DTSTART property value always counts as the first
 * occurrence." rrule.js and ical.js only emit instants on the rule's pattern,
 * so a task whose DTSTART/DUE sits off it (another client moved "monthly on the
 * 15th" to the 18th) lost its first occurrence and showed next month's slot.
 */

function parseVtodo(body: string): CalendarEvent {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//test//EN',
    'BEGIN:VTODO',
    'UID:rent',
    'DTSTAMP:20261116T100000Z',
    'SUMMARY:Pay rent',
    ...body.split('\n'),
    'STATUS:NEEDS-ACTION',
    'END:VTODO',
    'END:VCALENDAR',
  ].join('\r\n')
  const vtodo = new ICAL.Component(ICAL.parse(ics)).getFirstSubcomponent('vtodo')!
  return icalVtodoToCalendarEvent(vtodo, 'cal1')
}

const dayOf = (iso: string | undefined): string | undefined => iso?.split('T')[0]

describe('issue #275 — DTSTART off the RRULE pattern', () => {
  describe('open occurrence of a parsed task', () => {
    const shapes: Record<string, string> = {
      'all-day, DUE only (Tasks.org via DAVx5)': 'DUE;VALUE=DATE:20261118',
      'all-day, DTSTART and DUE': 'DTSTART;VALUE=DATE:20261118\nDUE;VALUE=DATE:20261118',
      'timed, TZID': 'DUE;TZID=Europe/Copenhagen:20261118T090000',
      'timed, UTC': 'DUE:20261118T090000Z',
      'timed, floating': 'DUE:20261118T090000',
    }
    for (const [name, props] of Object.entries(shapes)) {
      it(`keeps the missed first occurrence (${name})`, () => {
        const task = parseVtodo(`${props}\nRRULE:FREQ=MONTHLY;BYMONTHDAY=15`)
        const [open] = resolveRecurringTasks([task])
        // Was 2026-12-15: the task skipped straight past its missed due date.
        expect(dayOf(open.dueDate)).toBe('2026-11-18')
      })
    }

    it('also holds for a weekly rule whose BYDAY misses DTSTART', () => {
      // 2026-11-18 is a Wednesday; the rule says Mondays.
      const task = parseVtodo('DUE;VALUE=DATE:20261118\nRRULE:FREQ=WEEKLY;BYDAY=MO')
      expect(dayOf(resolveRecurringTasks([task])[0].dueDate)).toBe('2026-11-18')
    })
  })

  describe('nextOpenOccurrence', () => {
    const master = makeRecurringTask('FREQ=MONTHLY;BYMONTHDAY=15', {
      start: '2026-11-18T00:00:00',
    })

    it('moves on to the rule once the off-pattern occurrence is completed', () => {
      const done = makeTask({ recurrenceId: '2026-11-18', completed: true })
      const next = nextOpenOccurrence(master, new Map([['2026-11-18', done]]))
      expect(next!.occDateStr).toBe('2026-12-15')
    })

    it('counts DTSTART against COUNT', () => {
      const finite = makeRecurringTask('FREQ=MONTHLY;BYMONTHDAY=15;COUNT=2', {
        start: '2026-11-18T00:00:00',
      })
      const overrides = new Map([
        ['2026-11-18', makeTask({ recurrenceId: '2026-11-18', completed: true })],
        ['2026-12-15', makeTask({ recurrenceId: '2026-12-15', completed: true })],
      ])
      expect(nextOpenOccurrence(finite, overrides)).toBeNull()
    })

    it('counts DTSTART against COUNT on a timed TZID series', () => {
      const finite = makeRecurringTask('FREQ=MONTHLY;BYMONTHDAY=15;COUNT=2', {
        start: '2026-11-18T09:00:00',
        end: '2026-11-18T09:00:00',
        dueDate: '2026-11-18T09:00:00',
        isAllDay: false,
        timezone: 'Europe/Copenhagen',
      })
      const first = nextOpenOccurrence(finite, new Map())!
      expect(first.occStartStr).toBe('2026-11-18T08:00:00.000Z')
      const afterFirst = nextOpenOccurrence(
        finite,
        new Map([
          [first.occStartStr, makeTask({ recurrenceId: first.occStartStr, completed: true })],
        ])
      )!
      expect(afterFirst.occStartStr).toBe('2026-12-15T08:00:00.000Z')
      const both = new Map(
        [first, afterFirst].map((s) => [
          s.occStartStr,
          makeTask({ recurrenceId: s.occStartStr, completed: true }),
        ])
      )
      expect(nextOpenOccurrence(finite, both)).toBeNull()
    })
  })

  describe('buildRecurrenceSet', () => {
    const at = (iso: string): Date => new Date(iso)

    it('leaves an on-pattern series unchanged', () => {
      const set = buildRecurrenceSet(
        'FREQ=MONTHLY;BYMONTHDAY=15;COUNT=3',
        at('2026-11-15T00:00:00Z')
      )
      expect(set.all().map((d) => d.toISOString().slice(0, 10))).toEqual([
        '2026-11-15',
        '2026-12-15',
        '2027-01-15',
      ])
    })

    it('puts an off-pattern DTSTART first and counts it', () => {
      const set = buildRecurrenceSet(
        'FREQ=MONTHLY;BYMONTHDAY=15;COUNT=3',
        at('2026-11-18T00:00:00Z')
      )
      expect(set.all().map((d) => d.toISOString().slice(0, 10))).toEqual([
        '2026-11-18',
        '2026-12-15',
        '2027-01-15',
      ])
    })

    it('yields only DTSTART for COUNT=1', () => {
      const set = buildRecurrenceSet(
        'FREQ=MONTHLY;BYMONTHDAY=15;COUNT=1',
        at('2026-11-18T00:00:00Z')
      )
      expect(set.all().map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-11-18'])
    })
  })

  describe('calendar grid', () => {
    beforeEach(() => {
      const store = useCalendarStore.getState()
      store.events.forEach((e) => store.deleteEvent(e.id))
      store.calendars.forEach((c) => {
        if (!c.isDefault) store.deleteCalendar(c.id)
      })
      useCalendarStore.setState({ selectedCategoryIds: [] })
    })

    const calId = (): string => useCalendarStore.getState().calendars.find((c) => c.isDefault)!.id

    it('shows the task on its real due day, and the rule after that', () => {
      const store = useCalendarStore.getState()
      store.addEvent(
        makeRecurringTask('FREQ=MONTHLY;BYMONTHDAY=15', {
          id: 'rent',
          uid: 'rent',
          calendarId: calId(),
          title: 'Pay rent',
          start: '2026-11-18T00:00:00',
        })
      )
      const events = useCalendarStore.getState().events
      expect(getTasksForDay(events, '2026-11-18').map((t) => t.title)).toEqual(['Pay rent'])
      expect(getTasksForDay(events, '2026-11-15')).toEqual([])
      expect(getTasksForDay(events, '2026-12-15').map((t) => t.title)).toEqual(['Pay rent'])
    })

    it('shows an event on its DTSTART day too', () => {
      useCalendarStore.getState().addEvent({
        id: 'standup',
        calendarId: calId(),
        title: 'Monthly review',
        start: '2026-11-18T00:00:00',
        end: '2026-11-18T00:00:00',
        isAllDay: true,
        rruleString: 'FREQ=MONTHLY;BYMONTHDAY=15',
      })
      const days = useCalendarStore
        .getState()
        .getEventsForDateRange('2026-11-01', '2026-12-31')
        .map((e) => e.start.split('T')[0])
        .sort()
      expect(days).toEqual(['2026-11-18', '2026-12-15'])
    })
  })
})
