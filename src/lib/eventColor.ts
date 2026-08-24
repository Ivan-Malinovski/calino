import type { CalendarEvent, Calendar } from '@/types'
import type { Category } from '@/types/categories'
import { DEFAULT_CALENDAR_COLOR } from '@/config'
import { isUUID } from './uuid'

export interface ResolvedEventColorSources {
  calendarColor?: string
  categoryColor?: string
  useCategoryColors: boolean
}

/**
 * Resolve an event color after the relevant calendar/category records have
 * already been selected. Keeping this separate from `getEventColor` lets
 * cards subscribe to only the records that can affect their own appearance.
 */
export function getEventColorFromSources(
  event: CalendarEvent,
  sources: ResolvedEventColorSources
): string {
  if (event.color) return event.color
  if (sources.useCategoryColors && sources.categoryColor) return sources.categoryColor
  return sources.calendarColor ?? DEFAULT_CALENDAR_COLOR
}

/**
 * Resolve the display color for an event.
 *
 * Resolution chain: `event.color` → category color (if `useCategoryColors`) →
 * calendar color → `DEFAULT_CALENDAR_COLOR`.
 *
 * Pass `useCategoryColors = false` to skip the category step (used in
 * `DayView` where category colors are not consulted).
 */
export function getEventColor(
  event: CalendarEvent,
  options: {
    categories: Category[]
    calendars: Calendar[]
    useCategoryColors: boolean
  }
): string {
  const categoryValue = event.categories?.[0]
  const firstCategory =
    options.useCategoryColors && categoryValue
      ? options.categories.find((cat) =>
          isUUID(categoryValue) ? cat.id === categoryValue : cat.name === categoryValue
        )
      : undefined
  const calendar = options.calendars.find((c) => c.id === event.calendarId)

  return getEventColorFromSources(event, {
    categoryColor: firstCategory?.color,
    calendarColor: calendar?.color,
    useCategoryColors: options.useCategoryColors,
  })
}
