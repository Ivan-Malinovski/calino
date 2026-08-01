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

export interface ViewMeta {
  value: ViewType
  label: string
  // Views split into two groups, rendered either side of a divider in the
  // desktop tab strip. The divider used to be a hardcoded `index === 4`,
  // which stopped meaning anything once the order became user-orderable.
  group: 'calendar' | 'tools'
}

// Canonical ordering of all switchable views. This is the *default* order —
// the user's own arrangement lives in settings (`viewOrder`) and is
// reconciled against this list by `useOrderedViews`, so adding a view here
// is enough for it to appear for existing users too.
//
// Note `3day` is deliberately absent: it has a route and participates in
// view cycling, but it is not a tab of its own — both switchers render it
// as the Week tab in an alternate state. See CYCLE_ORDER.
export const ALL_VIEWS: ViewMeta[] = [
  { value: 'month', label: 'Month', group: 'calendar' },
  { value: 'week', label: 'Week', group: 'calendar' },
  { value: 'agenda', label: 'Agenda', group: 'calendar' },
  { value: 'year', label: 'Year', group: 'calendar' },
  { value: 'day', label: 'Day', group: 'calendar' },
  { value: 'todo', label: 'Tasks', group: 'tools' },
  { value: 'journal', label: 'Journal', group: 'tools' },
  { value: 'contacts', label: 'Contacts', group: 'tools' },
]

/**
 * The order keyboard shortcuts and the two-finger swipe step through.
 *
 * Derived from a view order rather than hardcoded, so cycling follows the
 * same arrangement the user sees in the switcher. `3day` has no tab, so it
 * is spliced in directly after `week` — preserving the behaviour of the old
 * standalone VIEW_ORDER, where week and 3day were adjacent.
 */
export function buildCycleOrder(views: ViewMeta[]): ViewType[] {
  return views.flatMap((view): ViewType[] =>
    view.value === 'week' ? ['week', '3day'] : [view.value]
  )
}

/**
 * Where the tab-strip divider sits by default: after the last calendar
 * view, which is the boundary the `group` field encodes. Once the user
 * drags it, `group` no longer has any say — the divider is just an item
 * with a position of its own.
 */
export const DEFAULT_DIVIDER_AFTER: ViewType =
  [...ALL_VIEWS].reverse().find((v) => v.group === 'calendar')?.value ?? 'day'

/**
 * Resolve a persisted `viewOrder` into real view metadata.
 *
 * The stored array is untrusted: it can name views that no longer exist
 * (downgrade, or a view removed from the app), miss views that were added
 * since it was written, or contain duplicates. Rather than migrating it, we
 * reconcile on read — unknown entries are dropped, and views missing from
 * the stored order are appended at their canonical position, so a newly
 * shipped view shows up for existing users without touching their
 * arrangement.
 */
export function reconcileViewOrder(stored: ViewType[] | undefined): ViewMeta[] {
  const byValue = new Map(ALL_VIEWS.map((v) => [v.value, v]))
  const seen = new Set<ViewType>()
  const ordered: ViewMeta[] = []

  for (const value of stored ?? []) {
    const meta = byValue.get(value)
    if (meta && !seen.has(value)) {
      seen.add(value)
      ordered.push(meta)
    }
  }

  // Append anything the stored order didn't mention, keeping the canonical
  // relative order among the newcomers.
  for (const meta of ALL_VIEWS) {
    if (!seen.has(meta.value)) ordered.push(meta)
  }

  return ordered
}
