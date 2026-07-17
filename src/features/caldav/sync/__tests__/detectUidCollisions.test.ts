import { describe, it, expect } from 'vitest'
import type { CalendarEvent } from '@/types'
import { detectUidCollisions, type ParsedWithHref } from '../detectUidCollisions'

const makeEvent = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'uid-1',
  calendarId: 'cal-1',
  title: 'Event',
  start: '2024-04-02T00:00:00Z',
  end: '2024-04-03T00:00:00Z',
  isAllDay: true,
  ...overrides,
})

const entry = (event: CalendarEvent, href: string): ParsedWithHref => ({ event, href })

describe('detectUidCollisions', () => {
  it('flags two independent events that share a UID across different resources', () => {
    const items = [
      entry(makeEvent({ id: 'shared', title: 'Event A', start: '2024-04-02T00:00:00Z' }), '/cal/event-a.ics'),
      entry(makeEvent({ id: 'shared', title: 'Event B', start: '2024-09-15T00:00:00Z' }), '/cal/event-b.ics'),
    ]

    const { issues, skip } = detectUidCollisions(items)

    expect(issues).toHaveLength(1)
    expect(issues[0].uid).toBe('shared')
    expect(issues[0].calendarId).toBe('cal-1')
    expect(issues[0].resources).toHaveLength(2)

    // The lexicographically-smaller href (event-a) is kept; the other is skipped.
    const kept = issues[0].resources.find((r) => r.kept)
    const hidden = issues[0].resources.find((r) => !r.kept)
    expect(kept?.href).toBe('/cal/event-a.ics')
    expect(hidden?.href).toBe('/cal/event-b.ics')

    expect(skip.size).toBe(1)
    expect(skip.has(items[1])).toBe(true)
    expect(skip.has(items[0])).toBe(false)
  })

  it('is deterministic regardless of resource order', () => {
    const a = entry(makeEvent({ id: 'shared', title: 'A' }), '/cal/event-a.ics')
    const b = entry(makeEvent({ id: 'shared', title: 'B' }), '/cal/event-b.ics')

    const forward = detectUidCollisions([a, b])
    const reversed = detectUidCollisions([b, a])

    // Same kept/hidden decision (ignoring the detectedAt timestamp).
    const strip = (r: ReturnType<typeof detectUidCollisions>): unknown =>
      r.issues.map((i) => ({ uid: i.uid, resources: i.resources }))
    expect(strip(forward)).toEqual(strip(reversed))

    // In both orderings the event-b entry is the one skipped.
    expect(forward.skip.has(b)).toBe(true)
    expect(reversed.skip.has(b)).toBe(true)
  })

  it('skips overrides belonging to the losing duplicate resource', () => {
    const keptMaster = entry(makeEvent({ id: 'shared', uid: 'shared' }), '/cal/a.ics')
    const losingMaster = entry(makeEvent({ id: 'shared', uid: 'shared' }), '/cal/b.ics')
    const losingOverride = entry(
      makeEvent({
        id: 'shared-2024-04-02T00:00:00Z',
        uid: 'shared',
        recurrenceId: '2024-04-02T00:00:00Z',
      }),
      '/cal/b.ics'
    )

    const { skip } = detectUidCollisions([keptMaster, losingMaster, losingOverride])

    expect(skip.has(keptMaster)).toBe(false)
    expect(skip.has(losingMaster)).toBe(true)
    expect(skip.has(losingOverride)).toBe(true)
  })

  it('does not flag a recurring master plus a RECURRENCE-ID override sharing a UID', () => {
    const master = entry(
      makeEvent({ id: 'birthday', rruleString: 'FREQ=YEARLY' }),
      '/cal/birthday.ics',
    )
    const override = entry(
      makeEvent({ id: 'birthday', recurrenceId: '2025-04-02T00:00:00Z', title: 'Birthday (moved)' }),
      '/cal/birthday-override.ics',
    )

    const { issues, skip } = detectUidCollisions([master, override])

    expect(issues).toHaveLength(0)
    expect(skip.size).toBe(0)
  })

  it('does not flag the same UID appearing once (single resource)', () => {
    const items = [entry(makeEvent({ id: 'unique' }), '/cal/unique.ics')]
    const { issues, skip } = detectUidCollisions(items)
    expect(issues).toHaveLength(0)
    expect(skip.size).toBe(0)
  })

  it('does not flag distinct UIDs', () => {
    const items = [
      entry(makeEvent({ id: 'a' }), '/cal/a.ics'),
      entry(makeEvent({ id: 'b' }), '/cal/b.ics'),
    ]
    const { issues, skip } = detectUidCollisions(items)
    expect(issues).toHaveLength(0)
    expect(skip.size).toBe(0)
  })

  it('keeps one event across three colliding resources and skips the other two', () => {
    const items = [
      entry(makeEvent({ id: 'shared' }), '/cal/c.ics'),
      entry(makeEvent({ id: 'shared' }), '/cal/a.ics'),
      entry(makeEvent({ id: 'shared' }), '/cal/b.ics'),
    ]
    const { issues, skip } = detectUidCollisions(items)
    expect(issues).toHaveLength(1)
    expect(issues[0].resources).toHaveLength(3)
    expect(issues[0].resources.filter((r) => r.kept)).toHaveLength(1)
    expect(issues[0].resources.find((r) => r.kept)?.href).toBe('/cal/a.ics')
    expect(skip.size).toBe(2)
  })
})
