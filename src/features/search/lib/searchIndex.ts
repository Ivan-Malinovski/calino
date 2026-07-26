import Fuse, { type IFuseOptions } from 'fuse.js'
import { parseISO, isWithinInterval, startOfDay, endOfDay } from 'date-fns'
import { RRule, type Frequency, type Options } from 'rrule'
import type { CalendarEvent } from '@/types'
import type { SearchResult, SearchFilters, SearchOptions } from '../types'

const DEFAULT_WEIGHTS = {
  title: 2,
  location: 1.5,
  description: 1,
}

const DEFAULT_OPTIONS: IFuseOptions<CalendarEvent> = {
  keys: [
    { name: 'title', weight: DEFAULT_WEIGHTS.title },
    { name: 'location', weight: DEFAULT_WEIGHTS.location },
    { name: 'description', weight: DEFAULT_WEIGHTS.description },
  ],
  threshold: 0.3,
  includeScore: true,
  includeMatches: true,
  minMatchCharLength: 2,
  ignoreLocation: true,
}

let fuseInstance: Fuse<CalendarEvent> | null = null
/**
 * Stored reference to the original events array. Used by filterCollection
 * instead of reaching into Fuse internals (Bug #99).
 */
let indexedEvents: CalendarEvent[] = []

export function initializeSearchIndex(events: CalendarEvent[], options?: SearchOptions): void {
  indexedEvents = events
  // Only pick valid IFuseOptions fields — don't spread the entire SearchOptions
  // (which includes runtime fields like `limit` and `weights` that Fuse ignores)
  const fuseOptions: IFuseOptions<CalendarEvent> = {
    ...DEFAULT_OPTIONS,
    ...(options?.threshold !== undefined && { threshold: options.threshold }),
  }

  // Always remap keys when provided — not just when weights are present
  if (options?.keys) {
    fuseOptions.keys = options.keys.map((key) => ({
      name: key,
      weight: options.weights?.[key] ?? 1,
    }))
  }

  fuseInstance = new Fuse(events, fuseOptions)
}

export function search(
  query: string,
  filters?: SearchFilters,
  options?: SearchOptions
): SearchResult[] {
  if (!fuseInstance) {
    console.warn('[Search] Index not initialized. Call initializeSearchIndex() first.')
    return []
  }

  if (!query.trim()) {
    if (!filters) return []
    // Filter-only mode: return all events matching filters without Fuse search
    return filterCollection(fuseInstance, filters)
  }

  const limit = options?.limit ?? 50

  // Don't pass limit to Fuse — we need all matches for proper sorting
  const results = fuseInstance.search(query)

  let filteredResults = results

  if (filters) {
    filteredResults = results.filter((result) => {
      const event = result.item
      let passesFilters = true

      if (filters.calendarIds && filters.calendarIds.length > 0) {
        passesFilters = passesFilters && filters.calendarIds.includes(event.calendarId)
      }

      if (filters.types && filters.types.length > 0) {
        passesFilters = passesFilters && filters.types.includes(event.type ?? 'event')
      }

      if (filters.categoryIds && filters.categoryIds.length > 0) {
        passesFilters =
          passesFilters &&
          (event.categories ?? []).some((cat) => filters.categoryIds!.includes(cat))
      }

      if (filters.dateFrom || filters.dateTo) {
        const fromDate = filters.dateFrom ? startOfDay(parseISO(filters.dateFrom)) : null
        const toDate = filters.dateTo ? endOfDay(parseISO(filters.dateTo)) : null

        passesFilters = passesFilters && dateOverlapsRange(event, fromDate, toDate)
      }

      return passesFilters
    })
  }

  // Pre-parse start dates once for the sort
  const dateCache = new Map<string, number>()
  const getStartTime = (start: string): number => {
    let ts = dateCache.get(start)
    if (ts === undefined) {
      try {
        ts = parseISO(start).getTime()
      } catch {
        ts = 0
      }
      if (Number.isNaN(ts)) ts = 0
      dateCache.set(start, ts)
    }
    return ts
  }

  const now = Date.now()

  return filteredResults
    .sort((a, b) => {
      // Blend Fuse relevance with date recency
      const dateA = getStartTime(a.item.start)
      const dateB = getStartTime(b.item.start)
      const scoreA = a.score ?? 0
      const scoreB = b.score ?? 0
      // Lower Fuse score = better match
      const recencyA = 1 / (1 + (now - dateA) / (1000 * 60 * 60 * 24))
      const recencyB = 1 / (1 + (now - dateB) / (1000 * 60 * 60 * 24))
      const combinedA = (1 - scoreA) * 0.7 + recencyA * 0.3
      const combinedB = (1 - scoreB) * 0.7 + recencyB * 0.3
      return combinedB - combinedA
    })
    .slice(0, limit)
    .map((result) => ({
      event: result.item,
      score: result.score ?? 0,
      matches:
        result.matches?.map((match) => ({
          field: match.key as 'title' | 'description' | 'location',
          indices: match.indices as [number, number][],
          value: match.value ?? '',
        })) ?? [],
    }))
}

/**
 * Check if an event's time range overlaps with the given date bounds.
 */
function dateOverlapsRange(
  event: CalendarEvent,
  fromDate: Date | null,
  toDate: Date | null
): boolean {
  // For recurring events, expand occurrences within the filter range
  if (event.rruleString || event.recurrence) {
    return recurringEventOverlapsRange(event, fromDate, toDate)
  }

  try {
    const eventStart = parseISO(event.start)
    const eventEnd = parseISO(event.end)

    return overlapsBasic(eventStart, eventEnd, fromDate, toDate)
  } catch {
    return false
  }
}

/**
 * Build an RRule instance from an event's recurrence data and check whether
 * any occurrence falls within the filter date range.
 */
function recurringEventOverlapsRange(
  event: CalendarEvent,
  fromDate: Date | null,
  toDate: Date | null
): boolean {
  try {
    const eventStart = parseISO(event.start)
    let rrule: RRule | null = null

    if (event.rruleString) {
      const stripped = event.rruleString.replace(/^RRULE:/i, '')
      // Parse RRULE components manually so we can set dtstart correctly
      // (RRule.fromString ignores the dtstart option parameter)
      const parts: Record<string, string> = {}
      stripped.split(';').forEach((part) => {
        const eq = part.indexOf('=')
        if (eq !== -1) parts[part.slice(0, eq)] = part.slice(eq + 1)
      })

      const freqMap: Record<string, Frequency> = {
        SECONDLY: RRule.SECONDLY,
        MINUTELY: RRule.MINUTELY,
        HOURLY: RRule.HOURLY,
        DAILY: RRule.DAILY,
        WEEKLY: RRule.WEEKLY,
        MONTHLY: RRule.MONTHLY,
        YEARLY: RRule.YEARLY,
      }
      const weekdayMap = [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA, RRule.SU]
      const weekdayCodeMap: Record<string, typeof RRule.MO> = {
        MO: RRule.MO,
        TU: RRule.TU,
        WE: RRule.WE,
        TH: RRule.TH,
        FR: RRule.FR,
        SA: RRule.SA,
        SU: RRule.SU,
      }

      const opts: Partial<Options> = {
        dtstart: eventStart,
        freq: freqMap[parts['FREQ']] ?? RRule.WEEKLY,
        interval: parseInt(parts['INTERVAL'] ?? '1', 10),
      }
      if (parts['COUNT']) opts.count = parseInt(parts['COUNT'], 10)
      if (parts['UNTIL']) opts.until = new Date(parts['UNTIL'])
      if (parts['BYDAY']) {
        opts.byweekday = parts['BYDAY'].split(',').map((d) => {
          const code = d.trim()
          return weekdayCodeMap[code] ?? weekdayMap[parseInt(code, 10) - 1]
        })
      }
      rrule = new RRule(opts)
    } else if (event.recurrence) {
      const { frequency, interval, byWeekday } = event.recurrence
      const freqMap: Record<string, Frequency> = {
        daily: RRule.DAILY,
        weekly: RRule.WEEKLY,
        monthly: RRule.MONTHLY,
        yearly: RRule.YEARLY,
      }
      const weekdayMap = [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA, RRule.SU]
      const opts: Partial<Options> = {
        dtstart: eventStart,
        freq: freqMap[frequency] ?? RRule.WEEKLY,
        interval: interval ?? 1,
      }
      if (byWeekday && byWeekday.length > 0) {
        opts.byweekday = byWeekday.map((d) => weekdayMap[d])
      }
      rrule = new RRule(opts)
    }

    if (!rrule) return false

    const searchStart = fromDate ?? new Date(0)
    const searchEnd = toDate ?? new Date('2099-12-31')

    // Only the first occurrence at/after searchStart matters — using after()
    // instead of between() avoids materializing every occurrence up to searchEnd
    // (which can be tens of thousands for an unbounded daily rule).
    const firstOccurrence = rrule.after(searchStart, true)
    return firstOccurrence !== null && firstOccurrence <= searchEnd
  } catch {
    return false
  }
}

/**
 * Basic non-recurring overlap check between an event's [eventStart, eventEnd]
 * and the filter range [fromDate, toDate].
 */
function overlapsBasic(
  eventStart: Date,
  eventEnd: Date,
  fromDate: Date | null,
  toDate: Date | null
): boolean {
  if (fromDate && toDate) {
    return (
      isWithinInterval(eventStart, { start: fromDate, end: toDate }) ||
      isWithinInterval(eventEnd, { start: fromDate, end: toDate }) ||
      (eventStart <= fromDate && eventEnd >= toDate)
    )
  }
  if (fromDate) {
    return eventEnd >= fromDate
  }
  if (toDate) {
    return eventStart <= toDate
  }
  return true
}

/**
 * Filter the full Fuse collection against the given filters (no query search).
 */
function filterCollection(_instance: Fuse<CalendarEvent>, filters: SearchFilters): SearchResult[] {
  const allEvents = indexedEvents

  const filtered = allEvents.filter((event) => {
    let passes = true

    if (filters.calendarIds && filters.calendarIds.length > 0) {
      passes = passes && filters.calendarIds.includes(event.calendarId)
    }

    if (filters.types && filters.types.length > 0) {
      passes = passes && filters.types.includes(event.type ?? 'event')
    }

    if (filters.categoryIds && filters.categoryIds.length > 0) {
      passes = passes && (event.categories ?? []).some((cat) => filters.categoryIds!.includes(cat))
    }

    if (filters.dateFrom || filters.dateTo) {
      const fromDate = filters.dateFrom ? startOfDay(parseISO(filters.dateFrom)) : null
      const toDate = filters.dateTo ? endOfDay(parseISO(filters.dateTo)) : null
      passes = passes && dateOverlapsRange(event, fromDate, toDate)
    }

    return passes
  })

  return filtered.map((event) => ({
    event,
    score: 0,
    matches: [],
  }))
}

export function getSearchInstance(): Fuse<CalendarEvent> | null {
  return fuseInstance
}

/**
 * Rebuild the search index with the given events.
 *
 * Returns a Promise that resolves when the index is ready. R4.5: the
 * `setCollection` work is deferred to idle time (or setTimeout(0) in
 * environments without `requestIdleCallback`) so a large sync doesn't
 * block the main thread and stutter the sync progress UI. Callers that
 * need to read the fresh index must `await` the returned promise —
 * `indexedEvents` (used by filter-only mode) is updated synchronously
 * and is therefore visible immediately.
 */
export function updateSearchIndex(events: CalendarEvent[], options?: SearchOptions): Promise<void> {
  // `indexedEvents` is read by filter-only mode and must reflect the new
  // collection synchronously, before the deferred setCollection runs.
  indexedEvents = events
  if (fuseInstance) {
    if (options) {
      // Re-initialize with new options
      initializeSearchIndex(events, options)
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      if (typeof globalThis.requestIdleCallback === 'function') {
        globalThis.requestIdleCallback(
          () => {
            fuseInstance!.setCollection(events)
            resolve()
          },
          { timeout: 1000 }
        )
      } else {
        setTimeout(() => {
          fuseInstance!.setCollection(events)
          resolve()
        }, 0)
      }
    })
  }
  initializeSearchIndex(events, options)
  return Promise.resolve()
}
