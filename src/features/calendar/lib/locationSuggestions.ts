import { toEventInstant } from '@/lib/datetime'
import type { CalendarEvent } from '@/types'

const LOCATION_LIMIT = 8
const RECENT_LOCATION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export function normaliseLocation(location: string): string {
  return location.trim().replace(/\s+/g, ' ')
}

interface LocationRecord {
  key: string
  value: string
  latestStart: number
  latestOrder: number
}

/**
 * Return locations suitable for the event-form picker.
 *
 * Empty queries use the recent history window. Once a query is present, the
 * whole stored event list is searched, so an older or future event can still
 * be reused. Invalid starts cannot participate in the recent window or win a
 * recency comparison, but their location remains searchable rather than being
 * silently discarded.
 */
export function getLocationSuggestions(
  events: CalendarEvent[],
  query: string,
  now: Date = new Date()
): string[] {
  const normalisedQuery = normaliseLocation(query).toLowerCase()
  const nowMs = now.getTime()
  const recentStart = nowMs - RECENT_LOCATION_WINDOW_MS
  const locations = new Map<string, LocationRecord>()

  events.forEach((event, order) => {
    if (typeof event.location !== 'string') return
    const value = normaliseLocation(event.location)
    if (!value) return

    const start = toEventInstant(event.start, event.timezone).getTime()
    const isValidStart = Number.isFinite(start)
    if (!normalisedQuery && (!isValidStart || start < recentStart || start > nowMs)) return
    if (normalisedQuery && !value.toLowerCase().includes(normalisedQuery)) return

    const key = value.toLowerCase()
    const current = locations.get(key)
    if (
      !current ||
      (isValidStart &&
        (start > current.latestStart ||
          (start === current.latestStart && order > current.latestOrder))) ||
      (!isValidStart && !Number.isFinite(current.latestStart) && order > current.latestOrder)
    ) {
      locations.set(key, {
        key,
        value,
        latestStart: isValidStart ? start : Number.NEGATIVE_INFINITY,
        latestOrder: order,
      })
    }
  })

  return [...locations.values()]
    .sort((a, b) => b.latestStart - a.latestStart || b.latestOrder - a.latestOrder)
    .slice(0, LOCATION_LIMIT)
    .map((location) => location.value)
}
