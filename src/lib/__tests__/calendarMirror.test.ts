import { describe, it, expect } from 'vitest'
import {
  buildMirrorPayload,
  hashPayload,
  toDuration,
  toBasicFormat,
  type MirrorEventPayload,
} from '../calendarMirror'
import type { Calendar, CalendarEvent } from '@/types'

const NOW = new Date('2026-06-15T12:00:00.000Z')

const calendars: Calendar[] = [
  {
    id: 'cal-1',
    name: 'Personal',
    color: '#3b82f6',
    isVisible: true,
    isDefault: true,
    showTasksInViews: true,
  },
  {
    id: 'cal-hidden',
    name: 'Hidden',
    color: '#ef4444',
    isVisible: false,
    isDefault: false,
    showTasksInViews: true,
  },
]

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt-1',
    calendarId: 'cal-1',
    title: 'Standup',
    start: '2026-06-16T09:00:00.000Z',
    end: '2026-06-16T09:30:00.000Z',
    isAllDay: false,
    ...overrides,
  }
}

function build(events: CalendarEvent[]): ReturnType<typeof buildMirrorPayload> {
  return buildMirrorPayload(events, calendars, 15, NOW)
}

describe('toDuration', () => {
  it('emits seconds for timed events', () => {
    expect(toDuration(0, 90 * 60 * 1000, false)).toBe('PT5400S')
  })

  it('emits whole days for all-day events so occurrences stay all-day', () => {
    expect(toDuration(0, 2 * 24 * 60 * 60 * 1000, true)).toBe('P2D')
  })

  it('never emits a zero-day all-day duration', () => {
    expect(toDuration(0, 0, true)).toBe('P1D')
  })
})

describe('toBasicFormat', () => {
  it('emits date-only for all-day exclusions', () => {
    expect(toBasicFormat('2026-06-16T00:00:00.000Z', true)).toBe('20260616')
  })

  it('emits UTC timestamps for timed exclusions', () => {
    expect(toBasicFormat('2026-06-16T09:00:00.000Z', false)).toBe('20260616T090000Z')
  })
})

describe('hashPayload', () => {
  const base: Omit<MirrorEventPayload, 'hash'> = {
    id: 'evt-1',
    calendarId: 'cal-1',
    title: 'Standup',
    start: 0,
    end: 1000,
    allDay: false,
    timezone: 'UTC',
    reminders: [15],
  }

  it('is stable across calls', () => {
    expect(hashPayload(base)).toBe(hashPayload(base))
  })

  it('changes when a mirrored field changes', () => {
    expect(hashPayload({ ...base, title: 'Retro' })).not.toBe(hashPayload(base))
    expect(hashPayload({ ...base, reminders: [10] })).not.toBe(hashPayload(base))
  })

  it('ignores the id, which is carried separately as the sync key', () => {
    expect(hashPayload({ ...base, id: 'evt-2' })).toBe(hashPayload(base))
  })
})

describe('buildMirrorPayload', () => {
  it('mirrors only visible calendars', () => {
    const result = build([event(), event({ id: 'evt-2', calendarId: 'cal-hidden' })])
    expect(result.calendars.map((c) => c.id)).toEqual(['cal-1'])
    expect(result.events.map((e) => e.id)).toEqual(['evt-1'])
  })

  it('skips tasks and journals, which the provider has no table for', () => {
    const result = build([
      event({ id: 'task', type: 'task' }),
      event({ id: 'journal', type: 'journal' }),
      event({ id: 'plain', type: 'event' }),
    ])
    expect(result.events.map((e) => e.id)).toEqual(['plain'])
  })

  it('anchors all-day events to midnight UTC with a UTC timezone', () => {
    const [mirrored] = build([
      event({ isAllDay: true, start: '2026-06-16T00:00:00.000Z', end: '2026-06-17T00:00:00.000Z' }),
    ]).events
    expect(mirrored.start).toBe(Date.UTC(2026, 5, 16))
    expect(mirrored.timezone).toBe('UTC')
    expect(mirrored.allDay).toBe(true)
  })

  it('carries a raw RRULE through with a DURATION instead of an end', () => {
    const [mirrored] = build([event({ rruleString: 'FREQ=WEEKLY;BYDAY=MO' })]).events
    expect(mirrored.rrule).toBe('FREQ=WEEKLY;BYDAY=MO')
    // The provider rejects a recurring event that carries DTEND.
    expect(mirrored.duration).toBe('PT1800S')
  })

  it('derives an RRULE from the structured recurrence when there is no raw one', () => {
    const [mirrored] = build([event({ recurrence: { frequency: 'daily', interval: 2 } })]).events
    expect(mirrored.rrule).toContain('FREQ=DAILY')
    expect(mirrored.rrule).toContain('INTERVAL=2')
  })

  it('excludes detached occurrences from the master and mirrors them standalone', () => {
    const result = build([
      event({ id: 'master', uid: 'uid-1', rruleString: 'FREQ=WEEKLY' }),
      event({
        id: 'detached',
        uid: 'uid-1',
        recurrenceId: '2026-06-23T09:00:00.000Z',
        recurrenceMasterId: 'uid-1',
        start: '2026-06-23T14:00:00.000Z',
        end: '2026-06-23T15:00:00.000Z',
      }),
    ])

    const master = result.events.find((e) => e.id === 'master')
    const detached = result.events.find((e) => e.id === 'detached')

    expect(master?.exdate).toBe('20260623T090000Z')
    // The moved occurrence is a plain event, not a provider exception row.
    expect(detached?.rrule).toBeUndefined()
    expect(detached?.start).toBe(new Date('2026-06-23T14:00:00.000Z').getTime())
  })

  it('merges explicit exclusions with detached-occurrence exclusions', () => {
    const result = build([
      event({
        id: 'master',
        uid: 'uid-1',
        rruleString: 'FREQ=WEEKLY',
        excludedDates: ['2026-06-30T09:00:00.000Z'],
      }),
      event({
        id: 'detached',
        uid: 'uid-1',
        recurrenceId: '2026-06-23T09:00:00.000Z',
        recurrenceMasterId: 'uid-1',
      }),
    ])
    expect(result.events.find((e) => e.id === 'master')?.exdate).toBe(
      '20260630T090000Z,20260623T090000Z'
    )
  })

  it('drops cancelled occurrences, which EXDATE already covers', () => {
    const result = build([
      event({
        id: 'cancelled',
        recurrenceId: '2026-06-23T09:00:00.000Z',
        eventStatus: 'CANCELLED',
      }),
    ])
    expect(result.events).toHaveLength(0)
  })

  it('bounds one-off events to the mirror window but never bounds a series', () => {
    const result = build([
      event({ id: 'ancient', start: '2010-01-01T09:00:00.000Z', end: '2010-01-01T10:00:00.000Z' }),
      event({ id: 'distant', start: '2040-01-01T09:00:00.000Z', end: '2040-01-01T10:00:00.000Z' }),
      event({
        id: 'old-series',
        start: '2010-01-01T09:00:00.000Z',
        end: '2010-01-01T10:00:00.000Z',
        rruleString: 'FREQ=WEEKLY',
      }),
    ])
    expect(result.events.map((e) => e.id)).toEqual(['old-series'])
  })

  it('falls back to the default reminder and drops email alarms', () => {
    const [withDefault] = build([event()]).events
    expect(withDefault.reminders).toEqual([15])

    const [withExplicit] = build([
      event({
        reminders: [
          { id: 'a', minutesBefore: 30, method: 'popup' },
          { id: 'b', minutesBefore: 60, method: 'email' },
        ],
      }),
    ]).events
    expect(withExplicit.reminders).toEqual([30])
  })

  it('maps transparency to the provider availability the native side expects', () => {
    const [free] = build([event({ transparency: 'transparent' })]).events
    expect(free.transparency).toBe('transparent')
  })
})
