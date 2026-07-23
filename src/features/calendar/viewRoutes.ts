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

// Canonical ordering of all views as presented in the mobile nav pill's
// expanded "..." grid — also used to drive swipe-to-switch-view on the
// pill, so swiping steps through views in the same order they're laid out.
export const ALL_VIEWS: { value: ViewType; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'agenda', label: 'Agenda' },
  { value: 'year', label: 'Year' },
  { value: 'day', label: 'Day' },
  { value: 'todo', label: 'Tasks' },
  { value: 'journal', label: 'Journal' },
  { value: 'contacts', label: 'Contacts' },
]
