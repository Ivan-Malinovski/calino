import type { CalendarEvent } from '@/types'

export type FreeBusyType = 'BUSY' | 'BUSY-UNAVAILABLE' | 'BUSY-TENTATIVE' | 'FREE'

export interface FreeBusyPeriod {
  start: Date
  end: Date
  type: FreeBusyType
}

export type Availability = 'available' | 'busy' | 'unknown'

/** Half-open overlap: an event ending exactly when another starts is not a clash. */
export function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

function toMillis(iso: string): number {
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? NaN : ms
}

/**
 * Which local events can be read as evidence about `attendeeEmail`.
 *
 * This is the honest answer to the plan's open question. A local calendar
 * belongs to the *user*, not to an arbitrary invitee, so an event only speaks
 * to an attendee's availability when that attendee is actually named on it —
 * either as an ATTENDEE who has accepted, or as the organizer. Anything else
 * would be inferring a colleague's schedule from our own diary.
 */
export function localEventsForAttendee(
  attendeeEmail: string,
  events: CalendarEvent[]
): CalendarEvent[] {
  const email = attendeeEmail.trim().toLowerCase()
  if (!email) return []

  return events.filter((event) => {
    if (event.type === 'journal') return false
    if (event.transparency === 'transparent') return false
    if (event.organizer?.email.toLowerCase() === email) return true
    return (event.attendees ?? []).some(
      (a) => a.email.toLowerCase() === email && a.partstat !== 'DECLINED'
    )
  })
}

/**
 * Availability for one attendee over one window.
 *
 * `unknown` is the honest default and the common case: with no local evidence
 * and no server free/busy data we simply do not know, and saying "available"
 * would be a guess the user might act on.
 */
export function checkAttendeeAvailability(
  attendeeEmail: string,
  startIso: string,
  endIso: string,
  localEvents: CalendarEvent[],
  freeBusyPeriods?: FreeBusyPeriod[] | null,
  /** Excluded from the local scan so an event doesn't conflict with itself. */
  excludeEventId?: string
): Availability {
  const start = toMillis(startIso)
  const end = toMillis(endIso)
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 'unknown'

  if (freeBusyPeriods && freeBusyPeriods.length > 0) {
    const busy = freeBusyPeriods.some(
      (p) =>
        p.type !== 'FREE' && rangesOverlap(start, end, p.start.getTime(), p.end.getTime())
    )
    if (busy) return 'busy'
  }

  const relevant = localEventsForAttendee(attendeeEmail, localEvents).filter(
    (e) => e.id !== excludeEventId
  )

  const clash = relevant.some((event) => {
    const s = toMillis(event.start)
    const e = toMillis(event.end)
    if (Number.isNaN(s) || Number.isNaN(e)) return false
    return rangesOverlap(start, end, s, e)
  })
  if (clash) return 'busy'

  // A server answered and reported nothing busy — that is a real "free".
  if (freeBusyPeriods) return 'available'
  // Local evidence exists and none of it clashes.
  if (relevant.length > 0) return 'available'

  return 'unknown'
}
