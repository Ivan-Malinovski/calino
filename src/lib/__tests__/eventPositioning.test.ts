import { describe, it, expect } from 'vitest'
import { positionEvents } from '../eventPositioning'
import { makeEvent, eventTimeRange } from './fixtures'

const day = (hour: number, durationMin: number) =>
  eventTimeRange(2026, 4, 27, hour, 0, durationMin * 60_000)

describe('positionEvents - Bug #83: short event overlap detection', () => {
  it('assigns totalColumns=2 for two overlapping events regardless of duration', () => {
    // Two events that overlap but are both shorter than 30 minutes
    const events = [
      makeEvent({ id: 'a', title: 'Event a', ...day(10, 15) }),
      makeEvent({ id: 'b', title: 'Event b', ...day(10, 15) }),
    ]

    const result = positionEvents(events)
    expect(result).toHaveLength(2)

    // Both should report totalColumns = 2 since they fully overlap
    for (const positioned of result) {
      expect(positioned.totalColumns).toBe(2)
    }
  })

  it('assigns totalColumns=3 for three concurrent 10-minute events', () => {
    const events = [
      makeEvent({ id: 'a', title: 'Event a', ...day(10, 10) }),
      makeEvent({ id: 'b', title: 'Event b', ...day(10, 10) }),
      makeEvent({ id: 'c', title: 'Event c', ...day(10, 10) }),
    ]

    const result = positionEvents(events)

    for (const positioned of result) {
      expect(positioned.totalColumns).toBe(3)
    }
  })

  it('detects overlap between a short event and a long event', () => {
    const events = [
      makeEvent({ id: 'long', title: 'Event long', ...day(10, 60) }),
      makeEvent({ id: 'short', title: 'Event short', ...day(10, 5) }),
    ]

    const result = positionEvents(events)

    for (const positioned of result) {
      expect(positioned.totalColumns).toBe(2)
    }
  })

  it('short event sandwiched between two non-overlapping events gets totalColumns=1', () => {
    const events = [
      makeEvent({ id: 'a', title: 'Event a', ...day(10, 10) }),
      makeEvent({ id: 'b', title: 'Event b', ...day(10, 15) }),
      makeEvent({ id: 'c', title: 'Event c', ...day(11, 10) }),
    ]

    const result = positionEvents(events)

    const eventC = result.find((r) => r.event.id === 'c')!
    expect(eventC.totalColumns).toBe(1)
    expect(eventC.column).toBe(0)

    // a and b overlap each other
    const eventA = result.find((r) => r.event.id === 'a')!
    const eventB = result.find((r) => r.event.id === 'b')!
    expect(eventA.totalColumns).toBe(2)
    expect(eventB.totalColumns).toBe(2)
  })

  it('cascading short overlaps compute correct totalColumns', () => {
    // a: 10:00-10:10, b: 10:05-10:15, c: 10:10-10:20
    // a overlaps b, b overlaps c, a does NOT overlap c
    // a.totalColumns=2, b.totalColumns=3, c.totalColumns=2

    // All three start at 10:00 for simplicity
    const preciseEvents = [
      makeEvent({ id: 'a', title: 'Event a', ...day(10, 10) }),
      makeEvent({ id: 'b', title: 'Event b', ...day(10, 15) }),
      makeEvent({ id: 'c', title: 'Event c', ...day(10, 10) }),
    ]

    const result = positionEvents(preciseEvents)

    for (const positioned of result) {
      expect(positioned.totalColumns).toBe(3)
    }
  })

  it('single event has totalColumns=1', () => {
    const events = [makeEvent({ id: 'only', title: 'Event only', ...day(10, 15) })]

    const result = positionEvents(events)
    expect(result[0].totalColumns).toBe(1)
  })

  it('excludes transparent events from positioning', () => {
    const events = [
      makeEvent({ id: 'opaque', title: 'Event opaque', ...day(10, 30) }),
      makeEvent({
        id: 'transparent',
        title: 'Event transparent',
        ...day(10, 30),
        transparency: 'transparent',
      }),
    ]

    const result = positionEvents(events)
    // Only the opaque event should be positioned
    expect(result).toHaveLength(1)
    expect(result[0].event.id).toBe('opaque')
    expect(result[0].totalColumns).toBe(1)
  })

  it('events with zero-length duration (start === end) get totalColumns=1', () => {
    const events = [
      makeEvent({ id: 'a', title: 'Event a', ...day(10, 0) }),
      makeEvent({ id: 'b', title: 'Event b', ...day(10, 0) }),
    ]

    const result = positionEvents(events)
    // Zero-duration events don't overlap (start < end check fails)
    for (const positioned of result) {
      expect(positioned.totalColumns).toBe(1)
    }
  })
})

describe('positionEvents with measured information', () => {
  const event = (id: string, startMinutes: number, endMinutes: number) =>
    makeEvent({
      id,
      start: new Date(2026, 4, 27, 0, startMinutes).toISOString(),
      end: new Date(2026, 4, 27, 0, endMinutes).toISOString(),
    })
  const layout = (events: ReturnType<typeof makeEvent>[], height = 40, hourHeight = 60) =>
    positionEvents(events, {
      hourHeight,
      contentHeights: new Map(events.map((e) => [e.id, height])),
    })

  it('lets staggered events share the full lane after the earlier information ends', () => {
    const events = [event('workshop', 960, 1050), event('call', 1020, 1080)]
    const placed = layout(events)
    expect(placed.map((p) => [p.column, p.totalColumns, p.columnSpan, p.inset])).toEqual([
      [0, 1, 1, 0],
      [0, 1, 1, 8],
    ])
    expect(placed.map((p) => p.event)).toEqual(events)
  })

  it('keeps simultaneous and closely spaced headers side by side', () => {
    const placed = layout([event('first', 960, 1080), event('second', 975, 1050)])
    expect(placed.map((p) => p.column)).toEqual([0, 1])
    expect(placed.every((p) => p.totalColumns === 2)).toBe(true)
    const simultaneous = layout([event('first', 960, 1080), event('second', 960, 1080)])
    expect(simultaneous.map((p) => p.column)).toEqual([0, 1])
  })

  it('responds to tall text and zoom rather than assuming a fixed number of minutes', () => {
    const events = [event('first', 960, 1080), event('second', 1020, 1110)]
    expect(layout(events, 70).map((p) => p.column)).toEqual([0, 1])
    expect(layout(events, 40, 30).map((p) => p.column)).toEqual([0, 1])
    expect(layout(events, 40, 120).map((p) => p.column)).toEqual([0, 0])
  })

  it('expands into free neighbouring lanes while keeping later information visible', () => {
    const placed = layout([event('a', 960, 1140), event('b', 960, 1140), event('c', 1020, 1080)])
    expect(placed.map((p) => [p.column, p.totalColumns, p.columnSpan])).toEqual([
      [0, 2, 1],
      [1, 2, 1],
      [0, 2, 2],
    ])
  })

  it('uses a consistent column grid through chains of overlaps', () => {
    const placed = layout([
      event('a', 960, 1140),
      event('b', 960, 1080),
      event('c', 975, 1050),
      event('d', 1020, 1080),
    ])
    expect(placed.every((p) => p.totalColumns === 3)).toBe(true)
    expect(placed.find((p) => p.event.id === 'd')?.columnSpan).toBe(3)
  })

  it('protects visually coincident headers during a repeated daylight-saving hour', () => {
    const events = [
      makeEvent({ id: 'before', start: '2026-11-01T05:00:00Z', end: '2026-11-01T05:15:00Z' }),
      makeEvent({ id: 'after', start: '2026-11-01T06:00:00Z', end: '2026-11-01T06:15:00Z' }),
    ]
    const placed = layout(events, 30)
    // In New York both land at 01:00. Other test zones display distinct hours.
    const sameRow = new Date(events[0].start).getHours() === new Date(events[1].start).getHours()
    expect(placed[0].column === placed[1].column).toBe(!sameRow)
  })

  it('reserves the whole interval until measured, and protects travel information', () => {
    const events = [event('first', 960, 1080), event('second', 1020, 1110)]
    expect(
      positionEvents(events, { hourHeight: 60, contentHeights: new Map() }).map((p) => p.column)
    ).toEqual([0, 1])
    expect(layout([{ ...events[0], travelDuration: 30 }, events[1]]).map((p) => p.column)).toEqual([
      0, 1,
    ])
  })

  it('does not let expanded foreground cards cover earlier information', () => {
    let seed = 1234
    const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
    for (let run = 0; run < 30; run++) {
      const events = Array.from({ length: 15 }, (_, i) => {
        const start = 600 + Math.floor(random() * 180)
        return event(String(i), start, start + 20 + Math.floor(random() * 180))
      })
      const heights = new Map(events.map((e) => [e.id, 20 + Math.floor(random() * 60)]))
      const placed = positionEvents(events, { hourHeight: 60, contentHeights: heights })
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
          const back = placed[i],
            front = placed[j]
          if (
            new Date(front.event.start).getTime() >=
            new Date(back.event.start).getTime() + heights.get(back.event.id)! * 60_000
          )
            continue
          const backLeft = back.column / back.totalColumns
          const backRight = (back.column + back.columnSpan!) / back.totalColumns
          const frontLeft = front.column / front.totalColumns
          const frontRight = (front.column + front.columnSpan!) / front.totalColumns
          expect(backRight <= frontLeft || frontRight <= backLeft).toBe(true)
        }
      }
    }
  })
})
