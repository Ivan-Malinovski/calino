import { describe, expect, it } from 'vitest'
import { format } from 'date-fns'
import { allDayKey, daysBetween, shiftAllDayValue } from '../datetime'

// Runs in both test projects (America/New_York and Europe/Copenhagen): an
// all-day move must not depend on the side of UTC the device is on.
describe('all-day day shift', () => {
  it('reads the day of floating all-day values', () => {
    expect(allDayKey('2026-11-10')).toBe('2026-11-10')
    expect(allDayKey('2026-11-10T00:00:00')).toBe('2026-11-10')
    expect(allDayKey('2026-11-10T23:59:59')).toBe('2026-11-10')
  })

  it('reads an instant-shaped value as the device-local day it stands for', () => {
    const instant = new Date(2026, 10, 11, 0, 0, 0).toISOString()
    expect(allDayKey(instant)).toBe(format(new Date(2026, 10, 11), 'yyyy-MM-dd'))
  })

  it('moves by whole days and keeps the floating shape', () => {
    expect(shiftAllDayValue('2026-11-10', 1)).toBe('2026-11-11')
    expect(shiftAllDayValue('2026-11-10T00:00:00', 1)).toBe('2026-11-11T00:00:00')
    expect(shiftAllDayValue('2026-11-12T23:59:59', 2)).toBe('2026-11-14T23:59:59')
    expect(shiftAllDayValue('2026-11-10', -10)).toBe('2026-10-31')
  })

  it('crosses month, year and DST boundaries on the calendar day', () => {
    expect(shiftAllDayValue('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftAllDayValue('2026-10-24', 2)).toBe('2026-10-26')
    expect(shiftAllDayValue('2027-03-27', 1)).toBe('2027-03-28')
  })

  it('drops the offset of an instant-shaped value and keeps its local day', () => {
    const instant = new Date(2026, 10, 11, 0, 0, 0).toISOString()
    expect(shiftAllDayValue(instant, 1)).toBe(format(new Date(2026, 10, 12), 'yyyy-MM-dd'))
  })

  it('gives the shift a drop needs, whatever the device zone', () => {
    const shift = daysBetween(allDayKey('2026-11-10'), '2026-11-11')
    expect(shift).toBe(1)
    expect(shiftAllDayValue('2026-11-10', shift)).toBe('2026-11-11')
  })
})
