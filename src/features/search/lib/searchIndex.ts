import Fuse, { type IFuseOptions } from 'fuse.js'
import { parseISO, isWithinInterval, startOfDay, endOfDay } from 'date-fns'
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

export function initializeSearchIndex(events: CalendarEvent[], options?: SearchOptions): void {
  const fuseOptions: IFuseOptions<CalendarEvent> = {
    ...DEFAULT_OPTIONS,
    ...options,
  }

  if (options?.keys && options?.weights) {
    fuseOptions.keys = options.keys.map((key) => ({
      name: key,
      weight: options.weights?.[key] ?? 1,
    }))
  }

  if (options?.threshold !== undefined) {
    fuseOptions.threshold = options.threshold
  }

  fuseInstance = new Fuse(events, fuseOptions)
}

export function search(
  query: string,
  filters?: SearchFilters,
  options?: SearchOptions
): SearchResult[] {
  if (!fuseInstance || !query.trim()) {
    return []
  }

  const results = fuseInstance.search(query, { limit: options?.limit ?? 50 })

  let filteredResults = results

  if (filters) {
    filteredResults = results.filter((result) => {
      const event = result.item
      let passesFilters = true

      if (filters.calendarIds && filters.calendarIds.length > 0) {
        passesFilters = passesFilters && filters.calendarIds.includes(event.calendarId)
      }

      if (filters.dateFrom && filters.dateTo) {
        const eventStart = parseISO(event.start)
        const eventEnd = parseISO(event.end)
        const fromDate = startOfDay(parseISO(filters.dateFrom))
        const toDate = endOfDay(parseISO(filters.dateTo))

        passesFilters =
          passesFilters &&
          (isWithinInterval(eventStart, { start: fromDate, end: toDate }) ||
            isWithinInterval(eventEnd, { start: fromDate, end: toDate }) ||
            (eventStart <= fromDate && eventEnd >= toDate))
      }

      return passesFilters
    })
  }

  return filteredResults
    .sort((a, b) => {
      const dateA = parseISO(a.item.start).getTime()
      const dateB = parseISO(b.item.start).getTime()
      return dateB - dateA
    })
    .map((result) => ({
      event: result.item,
      score: result.score ?? 0,
      matches:
        result.matches?.map((match) => ({
          field: match.key as 'title' | 'description' | 'location',
          indices: match.indices as [number, number][],
          value: match.value ?? '',
          key: match.key ?? '',
        })) ?? [],
    }))
}

export function getSearchInstance(): Fuse<CalendarEvent> | null {
  return fuseInstance
}

export function updateSearchIndex(events: CalendarEvent[]): void {
  if (fuseInstance) {
    fuseInstance.setCollection(events)
  } else {
    initializeSearchIndex(events)
  }
}
