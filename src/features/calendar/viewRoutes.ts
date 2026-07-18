import type { ViewType } from '@/types'

/**
 * Shared view <-> route maps. Previously duplicated between App.tsx and
 * CalendarHeader.tsx — extracted so both (and the mobile nav pill) stay in
 * sync.
 */
export const VIEW_ROUTES: Record<ViewType, string> = {
  month: '/month',
  year: '/year',
  week: '/week',
  '3day': '/3day',
  day: '/day',
  agenda: '/agenda',
  todo: '/tasks',
  journal: '/journal',
  contacts: '/contacts',
}

export const URL_TO_VIEW: Record<string, ViewType> = {
  '/month': 'month',
  '/year': 'year',
  '/week': 'week',
  '/3day': '3day',
  '/day': 'day',
  '/agenda': 'agenda',
  '/tasks': 'todo',
  '/journal': 'journal',
  '/contacts': 'contacts',
}
