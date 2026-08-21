import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from '@/types'
import { assignSpanLanes, makeDayFragments } from '../multiDayFragments'

const event = (id: string, start: string, end: string): CalendarEvent => ({
  id,
  calendarId: 'default',
  title: id,
  start,
  end,
  isAllDay: false,
})

describe('multi-day fragments', () => {
  it('assigns distinct lanes to overlapping spans and reuses lanes for non-overlapping spans', () => {
    const lanes = assignSpanLanes([
      event('long', '2024-03-11T09:00:00', '2024-03-14T10:00:00'),
      event('overlap', '2024-03-12T09:00:00', '2024-03-13T10:00:00'),
      event('later', '2024-03-15T09:00:00', '2024-03-16T10:00:00'),
    ])

    expect(lanes.get('long')).toBe(0)
    expect(lanes.get('overlap')).toBe(1)
    expect(lanes.get('later')).toBe(0)
  })

  it('orders equal-length overlapping spans by earlier start and then id', () => {
    const lanes = assignSpanLanes([
      event('later', '2024-03-12T09:00:00', '2024-03-14T10:00:00'),
      event('earlier', '2024-03-11T09:00:00', '2024-03-13T10:00:00'),
    ])

    expect(lanes.get('earlier')).toBe(0)
    expect(lanes.get('later')).toBe(1)
  })

  it('returns the same object for a single-day event', () => {
    const original = event('single', '2024-03-12T00:00:00', '2024-03-12T23:59:59')

    expect(makeDayFragments(original)).toEqual([original])
    expect(makeDayFragments(original)[0]).toBe(original)
  })

  it('creates one fragment per covered day with anchored first and last boundaries', () => {
    const original = event('span', '2024-03-12T09:30:00', '2024-03-14T17:45:00')
    const fragments = makeDayFragments(original, 2)

    expect(fragments).toHaveLength(3)
    expect(fragments[0]).toMatchObject({
      start: original.start,
      isFirstFragment: true,
      isLastFragment: false,
      laneIndex: 2,
    })
    expect(fragments[1]).toMatchObject({
      start: '2024-03-13T00:00:00',
      end: '2024-03-13T23:59:59',
      isFirstFragment: false,
      isLastFragment: false,
    })
    expect(fragments[2]).toMatchObject({
      end: original.end,
      isFirstFragment: false,
      isLastFragment: true,
      laneIndex: 2,
    })
  })

  it('keeps an inclusive all-day end from creating an extra fragment', () => {
    const original = {
      ...event('all-day', '2024-03-12T00:00:00', '2024-03-14T23:59:59'),
      isAllDay: true,
    }

    expect(makeDayFragments(original)).toHaveLength(3)
  })
})
