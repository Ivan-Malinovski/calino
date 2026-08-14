import { describe, it, expect } from 'vitest'
import {
  checkAttendeeAvailability,
  localEventsForAttendee,
  rangesOverlap,
  type FreeBusyPeriod,
} from '../freeBusyCalculator'
import type { CalendarEvent } from '@/types'

const ATTENDEE = 'colleague@example.com'

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt-1',
    calendarId: 'cal-1',
    title: 'Something',
    start: '2026-03-10T10:00:00.000Z',
    end: '2026-03-10T11:00:00.000Z',
    isAllDay: false,
    attendees: [{ email: ATTENDEE }],
    ...overrides,
  }
}

function period(start: string, end: string, type: FreeBusyPeriod['type'] = 'BUSY'): FreeBusyPeriod {
  return { start: new Date(start), end: new Date(end), type }
}

describe('rangesOverlap', () => {
  it('detects a genuine overlap', () => {
    expect(rangesOverlap(10, 20, 15, 25)).toBe(true)
    expect(rangesOverlap(10, 20, 5, 15)).toBe(true)
    expect(rangesOverlap(10, 20, 12, 18)).toBe(true)
  })

  it('treats touching ranges as free — back-to-back meetings do not clash', () => {
    expect(rangesOverlap(10, 20, 20, 30)).toBe(false)
    expect(rangesOverlap(20, 30, 10, 20)).toBe(false)
  })

  it('rejects disjoint ranges', () => {
    expect(rangesOverlap(10, 20, 30, 40)).toBe(false)
  })
})

describe('localEventsForAttendee', () => {
  it('matches events where the person is a named attendee', () => {
    expect(localEventsForAttendee(ATTENDEE, [makeEvent()])).toHaveLength(1)
  })

  it('matches case-insensitively', () => {
    expect(localEventsForAttendee('COLLEAGUE@Example.com', [makeEvent()])).toHaveLength(1)
  })

  it('matches events the person organized', () => {
    const event = makeEvent({ attendees: undefined, organizer: { email: ATTENDEE } })
    expect(localEventsForAttendee(ATTENDEE, [event])).toHaveLength(1)
  })

  it('ignores events that do not name the person at all', () => {
    expect(localEventsForAttendee(ATTENDEE, [makeEvent({ attendees: [] })])).toHaveLength(0)
    expect(
      localEventsForAttendee(ATTENDEE, [makeEvent({ attendees: [{ email: 'other@example.com' }] })])
    ).toHaveLength(0)
  })

  it('ignores events the person has declined', () => {
    const declined = makeEvent({ attendees: [{ email: ATTENDEE, partstat: 'DECLINED' }] })
    expect(localEventsForAttendee(ATTENDEE, [declined])).toHaveLength(0)
  })

  it('ignores transparent events and journal entries', () => {
    expect(localEventsForAttendee(ATTENDEE, [makeEvent({ transparency: 'transparent' })])).toHaveLength(0)
    expect(localEventsForAttendee(ATTENDEE, [makeEvent({ type: 'journal' })])).toHaveLength(0)
  })

  it('returns nothing for an empty email', () => {
    expect(localEventsForAttendee('  ', [makeEvent()])).toHaveLength(0)
  })
})

describe('checkAttendeeAvailability', () => {
  const START = '2026-03-10T10:30:00.000Z'
  const END = '2026-03-10T11:30:00.000Z'

  it('is unknown when there is no evidence either way', () => {
    expect(checkAttendeeAvailability(ATTENDEE, START, END, [])).toBe('unknown')
  })

  it('is busy when a local event naming the person overlaps', () => {
    expect(checkAttendeeAvailability(ATTENDEE, START, END, [makeEvent()])).toBe('busy')
  })

  it('is available when local evidence exists but does not overlap', () => {
    const elsewhere = makeEvent({
      start: '2026-03-10T14:00:00.000Z',
      end: '2026-03-10T15:00:00.000Z',
    })
    expect(checkAttendeeAvailability(ATTENDEE, START, END, [elsewhere])).toBe('available')
  })

  it('does not let an event conflict with itself', () => {
    const self = makeEvent({ id: 'being-edited', start: START, end: END })
    expect(checkAttendeeAvailability(ATTENDEE, START, END, [self], null, 'being-edited')).toBe(
      'unknown'
    )
  })

  it('uses server free/busy periods when supplied', () => {
    const periods = [period('2026-03-10T10:00:00Z', '2026-03-10T11:00:00Z')]
    expect(checkAttendeeAvailability(ATTENDEE, START, END, [], periods)).toBe('busy')
  })

  it('treats a server answer with no overlap as genuinely available', () => {
    const periods = [period('2026-03-10T16:00:00Z', '2026-03-10T17:00:00Z')]
    expect(checkAttendeeAvailability(ATTENDEE, START, END, [], periods)).toBe('available')
  })

  it('ignores FREE periods when deciding busy', () => {
    const periods = [period('2026-03-10T10:00:00Z', '2026-03-10T12:00:00Z', 'FREE')]
    expect(checkAttendeeAvailability(ATTENDEE, START, END, [], periods)).toBe('available')
  })

  it('counts tentative and unavailable as busy', () => {
    for (const type of ['BUSY-TENTATIVE', 'BUSY-UNAVAILABLE'] as const) {
      const periods = [period('2026-03-10T10:00:00Z', '2026-03-10T11:00:00Z', type)]
      expect(checkAttendeeAvailability(ATTENDEE, START, END, [], periods)).toBe('busy')
    }
  })

  it('stays unknown for an unusable time window', () => {
    expect(checkAttendeeAvailability(ATTENDEE, 'garbage', END, [makeEvent()])).toBe('unknown')
    expect(checkAttendeeAvailability(ATTENDEE, END, START, [makeEvent()])).toBe('unknown')
  })

  it('ignores local events with unparseable dates instead of throwing', () => {
    const broken = makeEvent({ start: 'nope', end: 'also nope' })
    expect(checkAttendeeAvailability(ATTENDEE, START, END, [broken])).toBe('available')
  })
})
