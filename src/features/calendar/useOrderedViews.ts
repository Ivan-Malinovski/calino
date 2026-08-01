import { useCallback, useMemo } from 'react'
import { useSettingsStore } from '@/store/settingsStore'
import { reconcileViewOrder, buildCycleOrder, type ViewMeta } from './viewRoutes'
import type { ViewType } from '@/types'

/**
 * The user's view arrangement, reconciled against the views this build
 * actually ships.
 *
 * Each hook selects primitives (or the stored array reference) out of the
 * store and derives with useMemo — returning a freshly built array straight
 * from a zustand selector would produce a new reference on every store
 * change and re-render every consumer.
 */
export function useOrderedViews(): ViewMeta[] {
  const viewOrder = useSettingsStore((state) => state.viewOrder)
  return useMemo(() => reconcileViewOrder(viewOrder), [viewOrder])
}

/**
 * The arrangement minus views the user has switched off entirely. This is
 * what both switchers render.
 */
export function useVisibleViews(): ViewMeta[] {
  const ordered = useOrderedViews()
  const journalEnabled = useSettingsStore((state) => state.journalEnabled)
  const contactsEnabled = useSettingsStore((state) => state.contactsEnabled)

  return useMemo(
    () =>
      ordered.filter(
        (v) =>
          (journalEnabled || v.value !== 'journal') && (contactsEnabled || v.value !== 'contacts')
      ),
    [ordered, journalEnabled, contactsEnabled]
  )
}

/**
 * Order that keyboard shortcuts and the two-finger swipe step through —
 * the visible arrangement, with `3day` spliced in beside Week.
 */
export function useViewCycleOrder(): ViewType[] {
  const visible = useVisibleViews()
  return useMemo(() => buildCycleOrder(visible), [visible])
}

/**
 * Write a new *visible* sequence back onto the full arrangement.
 *
 * Views the user has switched off aren't on screen and so can't be dragged,
 * but they still hold a position in the stored order. Rewriting only the
 * visible slots, in place, keeps those positions intact — so switching
 * Journal back on returns it to where it was rather than to the end.
 */
function applyVisibleOrder(
  full: ViewType[],
  visible: ViewType[],
  nextVisible: ViewType[]
): ViewType[] {
  const isVisible = new Set(visible)
  let cursor = 0
  return full.map((value) => (isVisible.has(value) ? nextVisible[cursor++] : value))
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * Current arrangement read straight from the store rather than from a
 * render-time snapshot.
 *
 * A drag commits many reorders in quick succession, and the gesture's move
 * handler closes over whatever callback existed at pointerdown. If that
 * callback also closed over the view arrays, every commit after the first
 * would recompute from drag-start state and overwrite the one before it —
 * so a multi-cell drag ended up applying only its final step, against a
 * stale list. Reading state at call time keeps each step building on the
 * last, and lets these callbacks stay referentially stable.
 */
function currentArrangement(): { ordered: ViewType[]; visible: ViewType[] } {
  const state = useSettingsStore.getState()
  const ordered = reconcileViewOrder(state.viewOrder).map((v) => v.value)
  const visible = ordered.filter(
    (v) =>
      (state.journalEnabled || v !== 'journal') && (state.contactsEnabled || v !== 'contacts')
  )
  return { ordered, visible }
}

/** Move a view within the visible list, by visible index. Used by the
 *  mobile grid, which has no divider. */
export function useReorderViews(): (from: number, to: number) => void {
  return useCallback((from: number, to: number) => {
    if (from === to) return
    const { ordered, visible } = currentArrangement()
    if (from < 0 || to < 0 || from >= visible.length || to >= visible.length) return

    useSettingsStore.getState().updateSettings({
      viewOrder: applyVisibleOrder(ordered, visible, moveItem(visible, from, to)),
    })
  }, [])
}

/**
 * The desktop tab strip is a list of items, not just views: the divider is
 * one of them, and is dragged exactly like a tab.
 */
export type SwitcherItem =
  | { kind: 'view'; id: string; label: string; view: ViewMeta }
  | { kind: 'divider'; id: 'divider'; label: 'Divider' }

export function useSwitcherItems(): SwitcherItem[] {
  const visible = useVisibleViews()
  const dividerAfter = useSettingsStore((state) => state.viewDividerAfter)

  return useMemo(() => {
    const items: SwitcherItem[] = []
    // `null` means the divider leads the strip. If it names a view that is
    // currently switched off, it simply never matches and the divider ends
    // up trailing — which is the honest rendering of "after a view you
    // can't see".
    if (dividerAfter === null) items.push({ kind: 'divider', id: 'divider', label: 'Divider' })
    for (const view of visible) {
      items.push({ kind: 'view', id: view.value, label: view.label, view })
      if (view.value === dividerAfter) {
        items.push({ kind: 'divider', id: 'divider', label: 'Divider' })
      }
    }
    if (dividerAfter !== null && !items.some((i) => i.kind === 'divider')) {
      items.push({ kind: 'divider', id: 'divider', label: 'Divider' })
    }
    return items
  }, [visible, dividerAfter])
}

/**
 * Move any item — tab or divider — to a new index in the strip. Both end up
 * as a single settings write, since moving a tab past the divider changes
 * the divider's anchor too.
 */
export function useReorderSwitcher(): (from: number, to: number) => void {
  return useCallback((from: number, to: number) => {
    if (from === to) return
    const { ordered, visible } = currentArrangement()
    const dividerAfter = useSettingsStore.getState().viewDividerAfter

    // Rebuild the item list from fresh state — same reason as above.
    const items: { id: string; view: boolean }[] = []
    if (dividerAfter === null) items.push({ id: 'divider', view: false })
    for (const value of visible) {
      items.push({ id: value, view: true })
      if (value === dividerAfter) items.push({ id: 'divider', view: false })
    }
    if (dividerAfter !== null && !items.some((i) => !i.view)) {
      items.push({ id: 'divider', view: false })
    }
    if (from < 0 || to < 0 || from >= items.length || to >= items.length) return

    const next = moveItem(items, from, to)
    const nextVisible = next.filter((i) => i.view).map((i) => i.id as ViewType)

    // The divider is anchored to whatever view now precedes it.
    const dividerAt = next.findIndex((i) => !i.view)
    const preceding = next.slice(0, dividerAt).filter((i) => i.view)

    useSettingsStore.getState().updateSettings({
      viewOrder: applyVisibleOrder(ordered, visible, nextVisible),
      viewDividerAfter:
        preceding.length > 0 ? (preceding[preceding.length - 1].id as ViewType) : null,
    })
  }, [])
}
