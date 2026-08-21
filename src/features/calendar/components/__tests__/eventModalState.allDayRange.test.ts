import { describe, it, expect } from 'vitest'
import { getInitialFormState } from '../eventModalState'

/**
 * Month-view drag-to-create passes a date-only (no time) end date to represent
 * an all-day range. The modal must seed an all-day event spanning the inclusive
 * start..end, and must NOT change single-day click-to-create behaviour.
 */
const writableCalendars = [{ id: 'default', isDefault: true }]

describe('date-only range is interpreted as an all-day event', () => {
  it('seeds an all-day event for a date-only start/end range', () => {
    const state = getInitialFormState(
      true,
      null,
      '2026-08-01',
      '2026-08-03',
      [],
      writableCalendars,
      []
    )
    expect(state.isAllDay).toBe(true)
    expect(state.startDate).toBe('2026-08-01')
    expect(state.endDate).toBe('2026-08-03')
  })

  it('keeps single-day click-to-create as a timed event (no endDate)', () => {
    const state = getInitialFormState(true, null, '2026-08-01', null, [], writableCalendars, [])
    expect(state.isAllDay).toBe(false)
    expect(state.startDate).toBe('2026-08-01')
    expect(state.endDate).toBe('2026-08-01')
  })

  it('does not treat a date-only end as a timed range', () => {
    const state = getInitialFormState(
      true,
      null,
      '2026-08-01',
      '2026-08-03',
      [],
      writableCalendars,
      []
    )
    expect(state.startTime).toBe('00:00')
    expect(state.endTime).toBe('23:59')
  })

  it('still seeds a timed range when the end date carries a time', () => {
    const state = getInitialFormState(
      true,
      null,
      '2026-08-01T09:00',
      '2026-08-01T10:30',
      [],
      writableCalendars,
      []
    )
    expect(state.isAllDay).toBe(false)
    expect(state.endDate).toBe('2026-08-01')
    expect(state.endTime).toBe('10:30')
  })
})
