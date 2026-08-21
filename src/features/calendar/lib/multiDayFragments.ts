import { addDays, eachDayOfInterval, endOfDay, format, startOfDay } from 'date-fns'
import type { CalendarEvent } from '@/types'
import { toEventInstant } from '@/lib/datetime'

interface Span {
  event: CalendarEvent
  startKey: string
  days: string[]
}

function eventDayKeys(event: CalendarEvent): { startKey: string; endKey: string; days: string[] } {
  const start = toEventInstant(event.start, event.timezone)
  const end = toEventInstant(event.end, event.timezone)
  const startKey = format(start, 'yyyy-MM-dd')
  const endKey = format(end, 'yyyy-MM-dd')
  const days = eachDayOfInterval({
    start: startOfDay(start),
    end: startOfDay(end),
  }).map((day) => format(day, 'yyyy-MM-dd'))
  return { startKey, endKey, days }
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

  const eventStart = toEventInstant(event.start, event.timezone)
  const eventEnd = toEventInstant(event.end, event.timezone)
  const fragments: CalendarEvent[] = []
  let currentDay = startOfDay(eventStart)

  while (currentDay <= eventEnd) {
    const dayKey = format(currentDay, 'yyyy-MM-dd')
    const isFirst = dayKey === startKey
    const isLast = dayKey === endKey
    fragments.push({
      ...event,
      start: isFirst ? event.start : format(currentDay, "yyyy-MM-dd'T'HH:mm:ss"),
      end: isLast ? event.end : format(endOfDay(currentDay), "yyyy-MM-dd'T'HH:mm:ss"),
      isFragment: true,
      isFirstFragment: isFirst,
      isLastFragment: isLast,
      ...(laneIndex === undefined ? {} : { laneIndex }),
      originalStart: event.start,
      originalEnd: event.end,
    })
    currentDay = addDays(currentDay, 1)
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
    toEventInstant(a.start, a.timezone).getTime() - toEventInstant(b.start, b.timezone).getTime()
  )
}
