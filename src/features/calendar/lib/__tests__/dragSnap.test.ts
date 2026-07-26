import { describe, it, expect } from 'vitest'
import type { Active, Over } from '@dnd-kit/core'
import {
  snapMinuteOfDay,
  parseTimeSlotId,
  computeDropPreview,
  isSameDropPreview,
  MINUTE_SNAP_INTERVAL,
} from '../dragSnap'

const HOUR_HEIGHT = 60

describe('snapMinuteOfDay', () => {
  it('keeps the start time when nothing was dragged', () => {
    expect(snapMinuteOfDay(9 * 60, 0, HOUR_HEIGHT)).toBe(540)
  })

  it('snaps a partial-hour drag down to the nearest quarter', () => {
    // 9:00 dragged 50px down = +50min → 9:50 → snaps to 9:45
    expect(snapMinuteOfDay(9 * 60, 50, HOUR_HEIGHT)).toBe(9 * 60 + 45)
  })

  it('snaps upward drags too', () => {
    // 10:00 dragged 20px up = -20min → 9:40 → snaps to 9:45
    expect(snapMinuteOfDay(10 * 60, -20, HOUR_HEIGHT)).toBe(9 * 60 + 45)
  })

  it('cleans up an off-grid start time (absolute, not relative, snapping)', () => {
    // 9:07 dragged exactly one hour down → 10:07 → snaps to 10:00
    expect(snapMinuteOfDay(9 * 60 + 7, 60, HOUR_HEIGHT)).toBe(10 * 60)
  })

  it('respects a zoomed grid, where an hour is taller than 60px', () => {
    // At 1.5x zoom, 90px is one hour; 45px is 30min.
    expect(snapMinuteOfDay(9 * 60, 45, 90)).toBe(9 * 60 + 30)
  })

  it('clamps to the start of the day', () => {
    expect(snapMinuteOfDay(30, -600, HOUR_HEIGHT)).toBe(0)
  })

  it('clamps to the last quarter of the day', () => {
    expect(snapMinuteOfDay(23 * 60, 600, HOUR_HEIGHT)).toBe(24 * 60 - MINUTE_SNAP_INTERVAL)
  })
})

describe('parseTimeSlotId', () => {
  it('splits an hour cell id into its day and minute-of-day', () => {
    expect(parseTimeSlotId('2026-07-09-09:00')).toEqual({
      dateKey: '2026-07-09',
      minuteOfDay: 540,
    })
  })

  it('rejects the all-day header droppable', () => {
    expect(parseTimeSlotId('allday::2026-07-09')).toBeNull()
  })

  it('rejects ids with no hour part', () => {
    expect(parseTimeSlotId('nonsense')).toBeNull()
  })
})

describe('computeDropPreview', () => {
  const timedActive = { data: { current: { startMinutes: 9 * 60 } } } as unknown as Active
  const allDayActive = { data: { current: {} } } as unknown as Active
  const over = (id: string) => ({ id }) as unknown as Over

  it('takes the day from the cell and the time from the drag delta', () => {
    // Dropped on the 10:00 cell of the next day, but only 50px below a 9:00
    // start — the snapped time (9:45) wins over the cell's hour.
    expect(computeDropPreview(timedActive, over('2026-07-10-10:00'), 50, HOUR_HEIGHT, 60)).toEqual({
      dateKey: '2026-07-10',
      minuteOfDay: 9 * 60 + 45,
      durationMinutes: 60,
    })
  })

  it('falls back to the cell hour for all-day events, which have no start time', () => {
    expect(computeDropPreview(allDayActive, over('2026-07-09-14:00'), 50, HOUR_HEIGHT, 60)).toEqual(
      { dateKey: '2026-07-09', minuteOfDay: 14 * 60, durationMinutes: 60 }
    )
  })

  it('has no preview off the grid or over the all-day header', () => {
    expect(computeDropPreview(timedActive, null, 50, HOUR_HEIGHT, 60)).toBeNull()
    expect(
      computeDropPreview(timedActive, over('allday::2026-07-09'), 50, HOUR_HEIGHT, 60)
    ).toBeNull()
  })
})

describe('isSameDropPreview', () => {
  const preview = { dateKey: '2026-07-09', minuteOfDay: 540, durationMinutes: 60 }

  it('treats structurally equal previews as the same', () => {
    expect(isSameDropPreview(preview, { ...preview })).toBe(true)
    expect(isSameDropPreview(null, null)).toBe(true)
  })

  it('spots a moved or resized preview', () => {
    expect(isSameDropPreview(preview, { ...preview, minuteOfDay: 555 })).toBe(false)
    expect(isSameDropPreview(preview, { ...preview, dateKey: '2026-07-10' })).toBe(false)
    expect(isSameDropPreview(preview, null)).toBe(false)
  })
})
