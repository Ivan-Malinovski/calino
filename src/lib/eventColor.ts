import type { CalendarEvent, Calendar } from '@/types'
import type { Category } from '@/types/categories'
import { DEFAULT_CALENDAR_COLOR } from '@/config'
import { isUUID } from './uuid'

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
  if (event.color) return event.color

  if (options.useCategoryColors && event.categories && event.categories.length > 0) {
    const firstCategory = options.categories.find((cat) => {
      const catValue = event.categories![0]
      return isUUID(catValue) ? cat.id === catValue : cat.name === catValue
    })
    if (firstCategory?.color) return firstCategory.color
  }

  const calendar = options.calendars.find((c) => c.id === event.calendarId)
  return calendar?.color ?? DEFAULT_CALENDAR_COLOR
}
