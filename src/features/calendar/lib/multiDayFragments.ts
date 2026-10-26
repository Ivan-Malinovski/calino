import { endOfDay, format, parseISO, startOfDay } from 'date-fns'
import type { CalendarEvent } from '@/types'
import { addDays, toEventInstant } from '@/lib/datetime'
import { homeDayKey, homeMidnight } from '@/lib/homeTimezone'
import { compareTaskSortOrder } from '@/lib/taskSortOrder'

interface Span {
  event: CalendarEvent
  startKey: string
  days: string[]
}

/**
 * The last calendar day a timed event occupies. The end is exclusive (RFC 5545),
 * so an event ending exactly at midnight does not reach into the following day.
 */
export function eventLastDay(event: CalendarEvent): Date {
  const start = toEventInstant(event.start, event.timezone)
  const end = toEventInstant(event.end, event.timezone)
  if (!event.isAllDay && end > start) {
    const midnight = homeMidnight(homeDayKey(end))
    if (end.getTime() === midnight.getTime()) return new Date(midnight.getTime() - 1)
  }
  return end
}

function dayKeysBetween(startKey: string, endKey: string): string[] {
  const days: string[] = []
  let cursor = startKey
  while (cursor <= endKey) {
    days.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return days
}

function eventDayKeys(event: CalendarEvent): { startKey: string; endKey: string; days: string[] } {
  // Date in the string. toEventInstant would slide a naive midnight west.
  if (event.isAllDay) {
    const startKey = event.start.slice(0, 10)
    const endKey = event.end.slice(0, 10)
    return { startKey, endKey, days: dayKeysBetween(startKey, endKey) }
  }
  const start = toEventInstant(event.start, event.timezone)
  const end = eventLastDay(event)
  const startKey = homeDayKey(start)
  const endKey = homeDayKey(end)
  return { startKey, endKey, days: dayKeysBetween(startKey, endKey) }
}

/** Greedy lane per multi-day span: longest first, earlier start breaks a tie, then id. */
export function assignSpanLanes(events: CalendarEvent[]): Map<string, number> {
  const spans: Span[] = events
    .map((event) => {
      const { startKey, endKey, days } = eventDayKeys(event)
      return { event, startKey, endKey, days }
    })
    .filter(({ startKey, endKey }) => startKey !== endKey)
    .sort((a, b) => {
      if (a.days.length !== b.days.length) return b.days.length - a.days.length
      if (a.startKey !== b.startKey) return a.startKey < b.startKey ? -1 : 1
      return a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0
    })

  const laneOccupancy: Set<string>[] = []
  const laneOf = new Map<string, number>()
  spans.forEach(({ event, days }) => {
    let lane = 0
    while (lane < laneOccupancy.length && days.some((day) => laneOccupancy[lane].has(day))) {
      lane++
    }
    if (lane === laneOccupancy.length) laneOccupancy.push(new Set())
    days.forEach((day) => laneOccupancy[lane].add(day))
    laneOf.set(event.id, lane)
  })

  return laneOf
}

/** One fragment per day covered. Returns `[event]` unchanged for a same-day event. */
export function makeDayFragments(event: CalendarEvent, laneIndex?: number): CalendarEvent[] {
  const { startKey, endKey } = eventDayKeys(event)
  if (startKey === endKey) return [event]

  const fragments: CalendarEvent[] = []
  for (const dayKey of dayKeysBetween(startKey, endKey)) {
    const isFirst = dayKey === startKey
    const isLast = dayKey === endKey
    fragments.push({
      ...event,
      // Continuation bounds are real instants. A naive wall clock would be
      // re-read in the event's own zone by toEventInstant.
      start: isFirst
        ? event.start
        : event.isAllDay
          ? format(startOfDay(parseISO(dayKey)), "yyyy-MM-dd'T'HH:mm:ss")
          : homeMidnight(dayKey).toISOString(),
      end: isLast
        ? event.end
        : event.isAllDay
          ? format(endOfDay(parseISO(dayKey)), "yyyy-MM-dd'T'HH:mm:ss")
          : homeMidnight(addDays(dayKey, 1)).toISOString(),
      isFragment: true,
      isFirstFragment: isFirst,
      isLastFragment: isLast,
      ...(laneIndex === undefined ? {} : { laneIndex }),
      originalStart: event.start,
      originalEnd: event.end,
    })
  }

  return fragments
}

/** Fragments first, then laneIndex, then start time. */
export function compareDayEvents(a: CalendarEvent, b: CalendarEvent): number {
  if (a.isFragment && !b.isFragment) return -1
  if (!a.isFragment && b.isFragment) return 1
  if (a.isFragment && b.isFragment) {
    const laneDifference = (a.laneIndex ?? 0) - (b.laneIndex ?? 0)
    if (laneDifference !== 0) return laneDifference
  }
  return (
    toEventInstant(a.start, a.timezone).getTime() - toEventInstant(b.start, b.timezone).getTime() ||
    compareTaskSortOrder(a, b)
  )
}
