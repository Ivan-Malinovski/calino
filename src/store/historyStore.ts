import { create } from 'zustand'
import type { CalendarEvent, Calendar } from '@/types'
import { useCalendarStore } from './calendarStore'

// Snapshot-based undo/redo for events and calendars. Because the calendar store
// replaces `events` and `calendars` with new arrays on every mutation, we can
// keep cheap reference snapshots in a past/future stack and swap them back in
// on undo/redo. This covers add / update / delete / duplicate uniformly
// without per-command inverse logic. Note: it restores the *local* state only
// — CalDAV reconciliation of an undone change is out of scope and left to the
// next sync.

const HISTORY_LIMIT = 50

interface Snapshot {
  events: CalendarEvent[]
  calendars: Calendar[]
}

interface HistoryState {
  past: Snapshot[]
  future: Snapshot[]
  /** Guards the store subscription while we're applying an undo/redo. */
  isApplying: boolean
  canUndo: () => boolean
  canRedo: () => boolean
  undo: () => boolean
  redo: () => boolean
  clear: () => void
}

function takeSnapshot(): Snapshot {
  const { events, calendars } = useCalendarStore.getState()
  return { events, calendars }
}

function restoreSnapshot(snapshot: Snapshot): void {
  useCalendarStore.setState({
    events: snapshot.events,
    calendars: snapshot.calendars,
  })
  // R4.1/R4.3: undo/redo bypasses the calendar store's per-action
  // `bumpRangeExpansionVersion()` calls. Bump the counter explicitly so
  // the range-expansion cache and per-view useMemos (WeekView,
  // CalendarGrid) invalidate and re-read the restored snapshot.
  useCalendarStore.getState().bumpVersion()
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  isApplying: false,

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  undo: (): boolean => {
    const { past, future } = get()
    if (past.length === 0) return false
    const previous = past[past.length - 1]
    const current = takeSnapshot()
    set({ isApplying: true })
    restoreSnapshot(previous)
    set({
      past: past.slice(0, -1),
      future: [...future, current],
      isApplying: false,
    })
    return true
  },

  redo: (): boolean => {
    const { past, future } = get()
    if (future.length === 0) return false
    const next = future[future.length - 1]
    const current = takeSnapshot()
    set({ isApplying: true })
    restoreSnapshot(next)
    set({
      past: [...past, current],
      future: future.slice(0, -1),
      isApplying: false,
    })
    return true
  },

  clear: (): void => {
    set({ past: [], future: [] })
  },
}))

// Record a snapshot whenever events or calendars change through a normal
// mutation (i.e. not our own undo/redo swap). We track both arrays because
// calendar CRUD (add/rename/delete/toggle visibility) is a user action that
// should be undoable. Guarded so that test suites which mock the calendar
// store (without a `subscribe`) don't blow up.
if (typeof useCalendarStore.subscribe === 'function') {
  useCalendarStore.subscribe((state, prevState) => {
    if (useHistoryStore.getState().isApplying) return
    const eventsChanged = state.events !== prevState.events
    const calendarsChanged = state.calendars !== prevState.calendars
    if (!eventsChanged && !calendarsChanged) return
    useHistoryStore.setState((h) => ({
      past: [...h.past, { events: prevState.events, calendars: prevState.calendars }].slice(
        -HISTORY_LIMIT
      ),
      future: [],
    }))
  })
}
