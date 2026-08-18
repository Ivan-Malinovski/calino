import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { safeLocalStorage } from '@/lib/storage'
import { format, parseISO, isWithinInterval, startOfDay, endOfDay } from 'date-fns'
import { RRule } from 'rrule'
import type {
  CalendarStore,
  CalendarEvent,
  Calendar,
  ViewType,
  EventType,
  DuplicateUidIssue,
  TaskOccurrencePlan,
} from '@/types'
import type { Category, AutoCategoryRule } from '@/types/categories'
import type { ExtractedEventFields } from '@/features/aiVision/types'
import { DEFAULT_CALENDAR_COLOR } from '@/config'
import {
  shapeOccurrence,
  occurrenceRecurrenceValue,
  isOccurrenceExcluded,
  resolveRRuleString,
  materializeOccurrence,
  materializeOccurrenceAt,
  rruleAnchor,
  rruleWindow,
  expandZonedOccurrences,
  parseOccurrenceInstant,
} from '@/lib/occurrenceExpansion'
import { deleteAttachments } from '@/lib/attachmentStore'
import { deleteRawIcs, deleteRawIcsForCalendar } from '@/lib/rawIcsStore'
import { useSettingsStore } from '@/store/settingsStore'
import { toZoneWallClock } from '@/lib/datetime'

// Memo cache for getEventsForDateRange. Keyed by the range; a cached result is
// reused only when its stored `version` matches the current
// `rangeExpansionVersion` AND the relevant visibility filters are still
// reference-identical (calendars / categories / selectedCategoryIds). This
// avoids re-expanding recurrences when multiple components request the same
// range or a component re-renders without any relevant state change.
//
// Why a version counter rather than reference-equality on `events`:
// The naive check (`cached.events === state.events`) is correct but couples
// the cache lifetime to a single field. Any store action that doesn't touch
// the events array (e.g. toggleCalendarVisibility) would silently miss the
// invalidation. With a counter bumped by every mutation that affects the
// query result, the invalidation contract is in one place.
//
// IMPORTANT: bumpRangeExpansionVersion must keep BOTH the module-level
// counter (for the cache check below) and the store property
// `state.rangeExpansionVersion` (for component subscriptions and
// useMemo deps in WeekView/CalendarGrid) in sync. Calling only one of
// them would either leave the cache stale or leave component memo
// invalidation dead. R4.1/R4.3 code review fix.
let rangeExpansionVersion = 0
interface RangeCacheEntry {
  version: number
  calendars: Calendar[]
  categories: Category[]
  selectedCategoryIds: string[]
  result: CalendarEvent[]
}
const rangeExpansionCache = new Map<string, RangeCacheEntry>()
const bumpRangeExpansionVersion = (): void => {
  rangeExpansionVersion++
  // Keep the store property in sync so subscribers and memo deps see
  // the bump. The action setter is inlined to avoid an import cycle
  // (the setter is defined inside the create() call below).
  useCalendarStore.setState({ rangeExpansionVersion })
}

// ---------------------------------------------------------------------------
// Derived event index
// ---------------------------------------------------------------------------
// getEventsForDateRange used to do four full passes over `state.events` on
// every cache miss — and a miss happens on every view switch, every month
// navigation and every mutation. Three of those passes (parsing every event's
// start AND end, building the recurring-master map, building the exception
// maps) depend only on `events`, not on the requested range, so they were
// being recomputed identically for every distinct range. On a large synced
// calendar that is the dominant cost of a view transition, and it scales with
// total stored events rather than with what's actually on screen — which is
// exactly the symptom reported in #73 (smooth on fast silicon, choppy on a
// Pixel 8 Pro).
//
// So: build it once per `rangeExpansionVersion` and let every range query
// reuse it.
interface IndexedEvent {
  event: CalendarEvent
  /** Position in `state.events`, used to restore the original output order. */
  order: number
  start: Date
  end: Date
  /**
   * min(start, end) and max(start, end) in ms — the event's interval with its
   * endpoints normalized. Used only for range candidacy, never as output.
   *
   * Both bounds have to be normalized, not just the end. A malformed event
   * whose end precedes its start would otherwise be sorted and binary-searched
   * on a `start` that sits outside its own interval, so a range containing the
   * (earlier) end but not the (later) start would never even consider it — the
   * pre-index full scan matched that case on the raw end and returned it.
   * `addEvent`/`updateEvent` divert `start > end` into `brokenEvents`, but the
   * `isAllDay` bypass and already-persisted data can still reach here.
   */
  spanStartMs: number
  spanEndMs: number
}

interface EventIndex {
  /**
   * The exact `events` array this index was built from. Everything below
   * derives purely from it, so reference equality is the whole invalidation
   * contract — deliberately NOT tied to `rangeExpansionVersion`, which also
   * bumps for calendar-visibility changes that cannot affect the index.
   */
  events: CalendarEvent[]
  /** Non-recurring events sorted by start time. */
  plain: IndexedEvent[]
  /**
   * prefixMaxEnd[i] = max(plain[0..i].spanEndMs). Lets a range query walk back from
   * the last event that starts before the range end and stop as soon as no
   * earlier event can possibly still be running — so the scan is proportional
   * to the events near the window, not to the whole store.
   */
  prefixMaxEnd: number[]
  /** Events carrying an rrule; always candidates, since occurrences can land anywhere. */
  recurring: IndexedEvent[]
  /** Every event without a recurrenceId, by id — the category source for detached instances. */
  masters: Map<string, CalendarEvent>
  exceptions: Map<string, CalendarEvent>
  legacyExceptions: Map<string, CalendarEvent>
  /**
   * Non-recurring tasks bucketed by their dueDate day key (`yyyy-MM-dd`).
   * R2.7 — recurring masters are deliberately excluded: they have no single
   * due day, and bucketing them by their anchor would show the whole series
   * on its first date only. They live in `recurringTasks` and are expanded
   * per day by `getTasksForDay`.
   */
  tasksByDueDate: Map<string, CalendarEvent[]>
  /** R2.7 — task masters carrying an RRULE, in stored order. */
  recurringTasks: IndexedEvent[]
}

let eventIndex: EventIndex | null = null

// RRule construction is expensive and the rules themselves are immutable, so
// this cache lives at module scope and survives across queries (it used to be
// rebuilt per call, which meant it only ever helped within a single range).
const rruleCache = new Map<string, RRule>()
const MAX_RRULE_CACHE = 512

function getOrCreateRRule(rruleStr: string, eventStart: Date): RRule {
  const key = `${rruleStr}|${eventStart.getTime()}`
  let rule = rruleCache.get(key)
  if (!rule) {
    const options = RRule.parseString(rruleStr)
    rule = new RRule({ ...options, dtstart: eventStart })
    if (rruleCache.size > MAX_RRULE_CACHE) rruleCache.clear()
    rruleCache.set(key, rule)
  }
  return rule
}

/**
 * The `yyyy-MM-dd` a task belongs to.
 *
 * An all-day task's due date is stored as a floating midnight serialized with a
 * `Z` (`2026-08-04T00:00:00.000Z`), so running it through the local-timezone
 * `format(parseISO(...))` files it under the *previous* day anywhere west of
 * UTC. All-day dates have no timezone by definition (RFC 5545 §3.3.4), so read
 * the date part literally and only convert for timed tasks.
 */
function taskDayKey(task: CalendarEvent): string {
  const due = task.dueDate as string
  if (task.isAllDay) return due.split('T')[0]
  return format(parseISO(due), 'yyyy-MM-dd')
}

/**
 * R2.7 — Does this override carry edits beyond "completed", or is it purely a
 * completion marker? Only the latter is safe to delete when un-completing.
 */
function overrideHasUserEdits(override: CalendarEvent, master: CalendarEvent): boolean {
  return (
    override.title !== master.title ||
    override.description !== master.description ||
    override.location !== master.location ||
    override.priority !== master.priority ||
    // The override was dragged to a different day/time than the rule produced.
    // Compared on the resolved instant rather than the raw strings: an all-day
    // RECURRENCE-ID can legitimately be written as a bare date or a floating
    // midnight, and a string compare would call those two a user edit — which
    // permanently pins the occurrence, because un-completing then keeps the
    // override instead of removing it and the series skips past it forever.
    !sameOccurrenceInstant(override, override.recurrenceId)
  )
}

/** Does this component start at the instant its own RECURRENCE-ID names? */
function sameOccurrenceInstant(event: CalendarEvent, recurrenceId: string | undefined): boolean {
  if (!recurrenceId) return true
  if (event.isAllDay) return event.start.split('T')[0] === recurrenceId.split('T')[0]
  // TZID events store both as naive wall clocks in the series' zone.
  return (
    parseOccurrenceInstant(event.start, event.timezone).getTime() ===
    parseOccurrenceInstant(recurrenceId, event.timezone).getTime()
  )
}

function getEventIndex(events: CalendarEvent[]): EventIndex {
  if (eventIndex && eventIndex.events === events) {
    return eventIndex
  }

  const plain: IndexedEvent[] = []
  const recurring: IndexedEvent[] = []
  const masters = new Map<string, CalendarEvent>()
  const exceptions = new Map<string, CalendarEvent>()
  const legacyExceptions = new Map<string, CalendarEvent>()
  const tasksByDueDate = new Map<string, CalendarEvent[]>()
  const recurringTasks: IndexedEvent[] = []
  const pendingExceptions: { event: CalendarEvent; masterId: string }[] = []

  for (let order = 0; order < events.length; order++) {
    const event = events[order]
    const start = parseISO(event.start)
    const end = parseISO(event.end)
    const indexed: IndexedEvent = {
      event,
      order,
      start,
      end,
      spanStartMs: Math.min(start.getTime(), end.getTime()),
      spanEndMs: Math.max(start.getTime(), end.getTime()),
    }

    if (event.rruleString || event.recurrence) {
      recurring.push(indexed)
    } else {
      plain.push(indexed)
    }

    if (!event.recurrenceId) {
      masters.set(event.id, event)
    } else {
      // Built without a calendar-visibility filter (it used to be filtered at
      // build time). Equivalent, because the key is scoped by calendarId and
      // lookups only happen while walking an event that is already known to be
      // on a visible calendar.
      const inferredMasterId = event.id.endsWith(`-${event.recurrenceId}`)
        ? event.id.slice(0, -(event.recurrenceId.length + 1))
        : undefined
      const masterId = event.recurrenceMasterId || inferredMasterId
      if (masterId) {
        // Keyed in a second pass — the key's shape depends on the *master's*
        // all-day flag, and the master may not be indexed yet.
        pendingExceptions.push({ event, masterId })
      } else {
        legacyExceptions.set(`${event.calendarId}-${event.recurrenceId.split('T')[0]}`, event)
      }
    }

    if (event.type === 'task' && (event.rruleString || event.recurrence) && !event.recurrenceId) {
      recurringTasks.push(indexed)
    } else if (event.type === 'task' && event.taskStatus === 'CANCELLED') {
      // R2.7 — A cancelled override is how RFC 5545 removes a single
      // occurrence: it exists solely to suppress the master's slot for that
      // date (which the exception map already does). Emitting it as a task in
      // its own right would put the cancelled occurrence back on screen.
      // Cancelled non-recurring tasks are dropped at sync, so this is the
      // override case in practice.
    } else if (event.type === 'task' && event.dueDate) {
      const dayKey = taskDayKey(event)
      let bucket = tasksByDueDate.get(dayKey)
      if (!bucket) {
        bucket = []
        tasksByDueDate.set(dayKey, bucket)
      }
      bucket.push(event)
    }
  }

  // A RECURRENCE-ID names a slot in the master's recurrence set, so its key has
  // to be read in the master's frame: whole dates for an all-day series, exact
  // instants otherwise. Reading it in the *override's* frame breaks the moment
  // an occurrence is edited into a shape the master doesn't share — flipping
  // one occurrence of an all-day task to a timed due date filed it under a
  // timestamp while every lookup asked for the date, so the master's own slot
  // was never suppressed and the occurrence rendered twice (#96).
  for (const { event, masterId } of pendingExceptions) {
    const recurrenceId = event.recurrenceId as string
    const master = masters.get(masterId)
    const isAllDay = master?.isAllDay ?? event.isAllDay
    // A RECURRENCE-ID names a slot in the master's recurrence set, so it must
    // be read in the master's zone frame — TZID series store naive wall clocks.
    const recurrenceKey = isAllDay
      ? recurrenceId.split('T')[0]
      : parseOccurrenceInstant(recurrenceId, master?.timezone).getTime()
    exceptions.set(`${event.calendarId}-${masterId}-${recurrenceKey}`, event)
  }

  plain.sort((a, b) => a.spanStartMs - b.spanStartMs)
  const prefixMaxEnd = new Array<number>(plain.length)
  let runningMax = -Infinity
  for (let i = 0; i < plain.length; i++) {
    if (plain[i].spanEndMs > runningMax) runningMax = plain[i].spanEndMs
    prefixMaxEnd[i] = runningMax
  }

  eventIndex = {
    events,
    plain,
    prefixMaxEnd,
    recurring,
    masters,
    exceptions,
    legacyExceptions,
    tasksByDueDate,
    recurringTasks,
  }
  return eventIndex
}

/**
 * Index of the last entry in `plain` whose spanStartMs is <= `ms`, or -1.
 */
function lastStartingAtOrBefore(plain: IndexedEvent[], ms: number): number {
  let lo = 0
  let hi = plain.length - 1
  let result = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (plain[mid].spanStartMs <= ms) {
      result = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return result
}

/**
 * R2.7 — Every task shown on `dayKey`: the non-recurring bucket above, plus one
 * expanded occurrence per recurring master that falls on that day.
 *
 * Per-day expansion rather than per-range keeps the three day-grid call sites
 * on the same simple `(events, dayKey)` signature they already use. Each
 * recurring master costs one `between()` over a single day, and the result is
 * memoised on the day key.
 */
const tasksForDayCache = new Map<string, CalendarEvent[]>()
let tasksForDayCacheEvents: CalendarEvent[] | null = null
// Panning across months adds an entry per visited day; bound it the way
// `rangeExpansionCache` is bounded, since entries are cheap to recompute.
const MAX_TASKS_FOR_DAY_CACHE = 400

export function getTasksForDay(events: CalendarEvent[], dayKey: string): CalendarEvent[] {
  const index = getEventIndex(events)
  if (tasksForDayCacheEvents !== events) {
    tasksForDayCache.clear()
    tasksForDayCacheEvents = events
  }
  const cached = tasksForDayCache.get(dayKey)
  if (cached) return cached
  if (tasksForDayCache.size > MAX_TASKS_FOR_DAY_CACHE) tasksForDayCache.clear()

  const plain = index.tasksByDueDate.get(dayKey) ?? []
  if (index.recurringTasks.length === 0) {
    tasksForDayCache.set(dayKey, plain)
    return plain
  }

  // The rule generates occurrence STARTS, but a task is filed under its DUE
  // day — and those are not always the same local day. A task starting 09:00Z
  // and due 17:00Z is due the next local day in UTC+13, so a window covering
  // only the target day would never produce the occurrence that belongs to it.
  // Over-scan by a day on each side and let the exact day-key check below
  // decide; the alternative is threading each master's start→due offset
  // through the window, which is the same thing with more arithmetic.
  const [y, m, d] = dayKey.split('-').map(Number)
  const dayStart = new Date(y, m - 1, d - 1, 0, 0, 0, 0)
  const dayEnd = new Date(y, m - 1, d + 1, 23, 59, 59, 999)

  const expanded: CalendarEvent[] = []
  for (const indexed of index.recurringTasks) {
    const master = indexed.event
    const rruleString = resolveRRuleString(master)
    if (!rruleString) continue
    let occurrences: Date[]
    try {
      // TZID timed series expand in their own zone (wall clock held across DST).
      occurrences =
        expandZonedOccurrences(master, dayStart, dayEnd) ??
        getOrCreateRRule(rruleString, rruleAnchor(master, indexed.start)).between(
          ...rruleWindow(master.isAllDay, dayStart, dayEnd),
          true
        )
    } catch {
      continue
    }
    for (const occ of occurrences) {
      const shape = shapeOccurrence(occ, indexed.start, indexed.end, master.isAllDay)
      // A detached override supersedes the master's slot even when the date is
      // also EXDATE'd (RFC 5545 §3.8.5.1) — it is already in the store in its
      // own right, so here it only suppresses.
      const recurrenceValue = occurrenceRecurrenceValue(occ, shape.occDateStr, master.isAllDay)
      if (index.exceptions.has(`${master.calendarId}-${master.id}-${recurrenceValue}`)) continue
      if (isOccurrenceExcluded(occ, shape.occDateStr, master.isAllDay, master.excludedDates, master.timezone)) {
        continue
      }
      const occurrence = materializeOccurrence(master, shape)
      // The authoritative check: does this occurrence's own due date land on
      // the requested day? Also what discards the over-scanned neighbours.
      if (occurrence.dueDate && taskDayKey(occurrence) === dayKey) expanded.push(occurrence)
    }
  }

  // Overrides live in `tasksByDueDate` (they carry a concrete dueDate and no
  // RRULE), so a completed or moved occurrence already arrives via `plain`.
  const result = expanded.length > 0 ? [...plain, ...expanded] : plain
  tasksForDayCache.set(dayKey, result)
  return result
}

export const selectOpenModal = (state: CalendarStore) => state.openModal
export const selectOpenJournalModal = (state: CalendarStore) => state.openJournalModal
export const selectAddEvent = (state: CalendarStore) => state.addEvent
export const selectUpdateEvent = (state: CalendarStore) => state.updateEvent

export const selectDeleteEvent = (state: CalendarStore) => state.deleteEvent
export const selectAddCalendar = (state: CalendarStore) => state.addCalendar
export const selectDeleteCalendar = (state: CalendarStore) => state.deleteCalendar
export const selectUpdateCalendar = (state: CalendarStore) => state.updateCalendar
export const selectCalendars = (state: CalendarStore) => state.calendars
export const selectEvents = (state: CalendarStore) => state.events
export const selectAddCategory = (state: CalendarStore) => state.addCategory
export const selectCategories = (state: CalendarStore) => state.categories
export const selectSetCurrentView = (state: CalendarStore) => state.setCurrentView
export const selectSetCurrentDate = (state: CalendarStore) => state.setCurrentDate

/**
 * True for calendars backed by a webcal subscription — user-initiated
 * mutation UI (save/delete/drag/quick-add/complete-toggle) should check this
 * and disable itself. Store actions themselves stay unguarded because sync
 * code (webcal refresh, CalDAV pull) legitimately writes to these calendars.
 */
export function isCalendarReadOnly(calendarId: string): boolean {
  const calendar = useCalendarStore.getState().calendars.find((c) => c.id === calendarId)
  return calendar?.readOnly === true
}

const DEFAULT_CALENDAR: Calendar = {
  id: 'default',
  name: 'Offline calendar',
  color: DEFAULT_CALENDAR_COLOR,
  isVisible: true,
  isDefault: true,
  showTasksInViews: true,
}

export const useCalendarStore = create<CalendarStore>()(
  persist(
    (set, get) => ({
      events: [],
      brokenEvents: [],
      duplicateUidIssues: [],
      calendars: [DEFAULT_CALENDAR],
      categories: [],
      autoCategoryRules: [],
      selectedCategoryIds: [],
      currentDate: format(new Date(), 'yyyy-MM-dd'),
      currentView: useSettingsStore.getState().defaultView,
      // Bumped by every mutation that affects getEventsForDateRange results.
      // Excluded from persistence (see partialize below) so it stays in sync
      // with the module-level rangeExpansionCache, which is also non-persistent.
      rangeExpansionVersion: 0,
      selectedEventId: null,
      isModalOpen: false,
      selectedDate: null,
      selectedEndDate: null,
      initialTitle: null,
      initialCalendarId: null,
      subtaskParentId: null,
      pendingEventPrefill: null,
      importQueue: [],
      selectedEventType: 'event',
      showAddCalendar: false,
      isOverlayOpen: false,
      previewEventId: null,
      previewPosition: null,
      isJournalModalOpen: false,
      journalModalDate: null,
      journalStartInCompose: false,

      addEvent: (event: CalendarEvent): void => {
        // Capture events with invalid date ranges as broken instead of dropping them
        if (event.start > event.end && !event.isAllDay) {
          const reason = `start (${event.start}) > end (${event.end})`
          console.warn(
            `[Calendar] Broken event detected:\n` +
              `  id: ${event.id}\n` +
              `  title: ${event.title}\n` +
              `  calendar: ${event.calendarId}\n` +
              `  start: ${event.start}\n` +
              `  end: ${event.end}`
          )
          // Store as broken event (deduplicate by id)
          const existingBroken = get().brokenEvents.find((be) => be.event.id === event.id)
          if (!existingBroken) {
            set((state) => ({
              brokenEvents: [
                ...state.brokenEvents,
                { event, reason, detectedAt: new Date().toISOString() },
              ],
            }))
          }
          return
        }
        const state = get()
        const autoCategoryNames = applyAutoCategories(
          event.title,
          state.autoCategoryRules,
          state.categories
        )
        const existingCategories = event.categories || []
        const finalEvent = {
          ...event,
          categories: [...new Set([...existingCategories, ...autoCategoryNames])],
          // #112 — CREATED is written from this. Locally created records get
          // their real creation time here rather than waiting for a sync
          // round-trip; synced ones arrive with `created` already parsed off
          // the server's CREATED, so `??` leaves them alone.
          created: event.created ?? new Date().toISOString(),
        }
        set((state) => {
          // Same id can arrive twice in one sync pass (e.g. the same UID
          // mirrored into two CalDAV collections on the server). Replace
          // rather than append, so the event never renders twice.
          const existingIndex = state.events.findIndex((e) => e.id === finalEvent.id)
          if (existingIndex !== -1) {
            const events = [...state.events]
            events[existingIndex] = finalEvent
            return { events }
          }
          return { events: [...state.events, finalEvent] }
        })
        bumpRangeExpansionVersion()
      },

      updateEvent: (id: string, updates: Partial<CalendarEvent>): void => {
        const safeUpdates = { ...updates }
        // #112 — `created` is write-once. Sync hands whole parsed events to
        // this action, and a server copy carrying no CREATED parses to
        // `created: undefined` — an explicit key, so the spread below would
        // wipe the stamp `addEvent` made. Dropping the key keeps the first
        // creation time we ever knew about.
        if (safeUpdates.created === undefined) delete safeUpdates.created
        // Phase 2 (C3) — keep the TZID storage invariant: TZID events store
        // naive wall clocks in the event zone, but a drag/save/resize can
        // write a Z instant. Normalize it back to the zone's wall clock so
        // expansion and serialization never see a mixed frame. Skipped when
        // the update explicitly clears the timezone.
        const existingForNormalization = get().events.find((e) => e.id === id)
        const effectiveTimezone = 'timezone' in safeUpdates ? safeUpdates.timezone : existingForNormalization?.timezone
        if (effectiveTimezone) {
          // R1 — dueDate carries the same invariant for timed TZID tasks: the
          // adapter stores a naive wall clock in the event zone, but the
          // preview popup (and any save path) can write a device-frame Z
          // instant. Normalize it back like start/end so display and
          // serialization never see a mixed frame. A floating (all-day)
          // dueDate is naive, so toZoneWallClock passes it through untouched.
          if (
            safeUpdates.dueDate !== undefined &&
            safeUpdates.dueDate !== existingForNormalization?.dueDate
          ) {
            safeUpdates.dueDate = toZoneWallClock(safeUpdates.dueDate, effectiveTimezone)
          }
          if (safeUpdates.start !== undefined && safeUpdates.start !== existingForNormalization?.start) {
            safeUpdates.start = toZoneWallClock(safeUpdates.start, effectiveTimezone)
          }
          if (safeUpdates.end !== undefined && safeUpdates.end !== existingForNormalization?.end) {
            safeUpdates.end = toZoneWallClock(safeUpdates.end, effectiveTimezone)
          }
        }
        if (safeUpdates.start !== undefined && safeUpdates.end !== undefined) {
          if (safeUpdates.start > safeUpdates.end && !safeUpdates.isAllDay) {
            const reason = `start (${safeUpdates.start}) > end (${safeUpdates.end})`
            console.warn('[Calendar] Broken event update:', id)
            const existingEvent = get().events.find((e) => e.id === id)
            if (existingEvent) {
              const mergedEvent = { ...existingEvent, ...safeUpdates }
              const existingBroken = get().brokenEvents.find((be) => be.event.id === id)
              if (!existingBroken) {
                set((state) => ({
                  events: state.events.filter((e) => e.id !== id),
                  brokenEvents: [
                    ...state.brokenEvents,
                    { event: mergedEvent, reason, detectedAt: new Date().toISOString() },
                  ],
                }))
              }
            }
            return
          }
        } else if (safeUpdates.start !== undefined || safeUpdates.end !== undefined) {
          const existingEvent = get().events.find((e) => e.id === id)
          if (existingEvent) {
            const start = safeUpdates.start ?? existingEvent.start
            const end = safeUpdates.end ?? existingEvent.end
            if (start > end && !existingEvent.isAllDay) {
              const reason = `start (${start}) > end (${end})`
              console.warn('[Calendar] Broken event update:', id)
              const mergedEvent = { ...existingEvent, ...safeUpdates }
              const existingBroken = get().brokenEvents.find((be) => be.event.id === id)
              if (!existingBroken) {
                set((state) => ({
                  events: state.events.filter((e) => e.id !== id),
                  brokenEvents: [
                    ...state.brokenEvents,
                    { event: mergedEvent, reason, detectedAt: new Date().toISOString() },
                  ],
                }))
              }
              return
            }
          }
        }
        const state = get()
        if (safeUpdates.title) {
          const existingEvent = state.events.find((e) => e.id === id)
          if (existingEvent) {
            const autoCategoryNames = applyAutoCategories(
              safeUpdates.title,
              state.autoCategoryRules,
              state.categories
            )
            const existingCategories = safeUpdates.categories || existingEvent.categories || []
            safeUpdates.categories = [...new Set([...existingCategories, ...autoCategoryNames])]
          }
        }
        set((state) => ({
          events: state.events.map((e) => (e.id === id ? { ...e, ...safeUpdates } : e)),
        }))
        bumpRangeExpansionVersion()
      },

      completeTask: (id: string, completed: boolean): CalendarEvent[] => {
        const events = get().events
        const selectedTask = events.find((event) => event.id === id && event.type === 'task')
        if (!selectedTask) return []

        const affectedIds = new Set([id])
        if (completed) {
          // Walk the full task tree so nested descendants are completed too.
          let foundDescendant = true
          while (foundDescendant) {
            foundDescendant = false
            for (const event of events) {
              if (
                event.type === 'task' &&
                event.parentTaskId &&
                affectedIds.has(event.parentTaskId) &&
                !affectedIds.has(event.id)
              ) {
                affectedIds.add(event.id)
                foundDescendant = true
              }
            }
          }
        }

        const completedAt = completed ? new Date().toISOString() : undefined
        const updatedTasks: CalendarEvent[] = events
          .filter((event) => affectedIds.has(event.id))
          .map((event): CalendarEvent => ({
            ...event,
            completed,
            taskStatus: completed ? 'COMPLETED' : 'NEEDS-ACTION',
            percentComplete: completed ? 100 : 0,
            completedAt,
          }))

        const updatedTasksById = new Map(updatedTasks.map((task) => [task.id, task]))
        set({
          events: events.map((event) => updatedTasksById.get(event.id) ?? event),
        })
        bumpRangeExpansionVersion()

        return updatedTasks
      },

      // R2.7 — Completing ONE occurrence of a recurring task, per RFC 5545
      // §3.6.2. The master is never mutated: its RRULE keeps generating the
      // series, and the completion is recorded as a detached override VTODO
      // sharing the master's UID with a RECURRENCE-ID naming the occurrence.
      // This is what Thunderbird writes and what makes the series survive a
      // round-trip through other clients.
      //
      // Returns the write plan rather than performing it — the caller feeds it
      // straight to `saveRecurrenceOverride`, which owns both the CalDAV group
      // PUT and the resulting store writes, so master and override can never
      // land in the store without also reaching the server as one resource.
      completeTaskOccurrence: (
        masterId: string,
        occurrenceStart: string,
        completed: boolean
      ): TaskOccurrencePlan | null => {
        const events = get().events
        const master = events.find((event) => event.id === masterId && event.type === 'task')
        if (!master) return null

        const uid = master.uid || master.id
        const existing = events.find(
          (event) =>
            event.recurrenceId === occurrenceStart &&
            (event.uid === uid || event.recurrenceMasterId === masterId)
        )

        if (!completed) {
          if (!existing) return { master, override: null, removedOverrideIds: [] }
          // Absence of an override means "this occurrence is exactly what the
          // master says", so dropping it is the correct way to un-complete —
          // unless the user also edited the occurrence, in which case those
          // edits must survive and only the status flips back.
          if (overrideHasUserEdits(existing, master)) {
            return {
              master,
              override: {
                ...existing,
                completed: false,
                taskStatus: 'NEEDS-ACTION',
                percentComplete: 0,
                completedAt: undefined,
              },
              removedOverrideIds: [],
            }
          }
          return { master, override: null, removedOverrideIds: [existing.id] }
        }

        // Build the occurrence through the shared helper, never by hand: it
        // owns both the all-day UTC-frame resolution and the DTSTART→DUE offset
        // that a naive `dueDate = end` gets wrong for Calino's 23:59:59 ends.
        const occurrence = materializeOccurrenceAt(master, occurrenceStart)
        const base = existing ?? {
          ...occurrence,
          id: `${uid}-${occurrenceStart}`,
          // An override describes a single instance and must not carry the
          // series definition (RFC 5545 §3.8.5.3).
          rruleString: undefined,
          recurrence: undefined,
          excludedDates: undefined,
        }

        return {
          master,
          override: {
            ...base,
            uid,
            recurrenceId: occurrenceStart,
            recurrenceMasterId: masterId,
            completed: true,
            taskStatus: 'COMPLETED',
            percentComplete: 100,
            completedAt: new Date().toISOString(),
          },
          removedOverrideIds: [],
        }
      },

      deleteEvent: (id: string): void => {
        // Clean up attachments from IndexedDB (fire and forget)
        deleteAttachments(id).catch(() => {})
        // The raw ICS is keyed by resource href, not event id — a local-only
        // event has none, and there is nothing stored for it either.
        const href = get().events.find((e) => e.id === id)?.resourceHref
        if (href) deleteRawIcs(href).catch(() => {})
        set((state) => ({
          events: state.events.filter((e) => e.id !== id),
        }))
        bumpRangeExpansionVersion()
      },

      addBrokenEvent: (event: CalendarEvent, reason: string): void => {
        const existing = get().brokenEvents.find((be) => be.event.id === event.id)
        if (!existing) {
          set((state) => ({
            brokenEvents: [
              ...state.brokenEvents,
              { event, reason, detectedAt: new Date().toISOString() },
            ],
          }))
        }
      },

      removeBrokenEvent: (eventId: string): void => {
        set((state) => ({
          brokenEvents: state.brokenEvents.filter((be) => be.event.id !== eventId),
        }))
      },

      addDuplicateUidIssue: (issue: DuplicateUidIssue): void => {
        set((state) => ({
          // Replace any existing issue for the same (uid, calendarId) so a
          // re-sync refreshes rather than duplicates the record.
          duplicateUidIssues: [
            ...state.duplicateUidIssues.filter(
              (i) => !(i.uid === issue.uid && i.calendarId === issue.calendarId)
            ),
            issue,
          ],
        }))
      },

      clearDuplicateUidIssues: (): void => {
        set({ duplicateUidIssues: [] })
      },

      removeDuplicateUidResource: (uid: string, calendarId: string, href: string): void => {
        set((state) => ({
          duplicateUidIssues: state.duplicateUidIssues.flatMap((issue) => {
            if (issue.uid !== uid || issue.calendarId !== calendarId) return [issue]
            const resources = issue.resources.filter((r) => r.href !== href)
            // Fewer than two resources left means the collision is resolved.
            if (resources.length < 2) return []
            return [{ ...issue, resources }]
          }),
        }))
      },

      /**
       * Bump the range-expansion version counter without mutating events.
       *
       * Public for the history store (and any other code that calls
       * `useCalendarStore.setState(...)` directly, bypassing the
       * per-action `bumpRangeExpansionVersion()` calls). Callers that
       * mutate `events`, `calendars`, or `categories` via setState
       * must invoke this afterwards so the range-expansion cache and
       * any `useMemo` consumers see the new state. R4.1/R4.3.
       */
      bumpVersion: (): void => {
        bumpRangeExpansionVersion()
      },

      fixBrokenEvent: (eventId: string): void => {
        const brokenEvent = get().brokenEvents.find((be) => be.event.id === eventId)
        if (!brokenEvent) return

        const { event } = brokenEvent
        const fixedEvent: CalendarEvent = {
          ...event,
          start: event.end,
          end: event.start,
        }

        // Remove from broken events
        set((state) => ({
          brokenEvents: state.brokenEvents.filter((be) => be.event.id !== eventId),
        }))

        // Add to normal events
        get().addEvent(fixedEvent)
      },

      duplicateEvent: (id: string, addCopySuffix = true): string | null => {
        const state = get()
        const eventToDuplicate = state.events.find((e) => e.id === id)
        if (!eventToDuplicate) return null

        const newEvent: CalendarEvent = {
          ...eventToDuplicate,
          id: crypto.randomUUID(),
          uid: undefined,
          title: addCopySuffix ? `${eventToDuplicate.title} (copy)` : eventToDuplicate.title,
          recurrenceId: undefined,
          recurrenceMasterId: undefined,
          isFragment: undefined,
          isFirstFragment: undefined,
          isLastFragment: undefined,
          laneIndex: undefined,
          originalStart: undefined,
          originalEnd: undefined,
          syncStatus: undefined,
          etag: undefined,
          resourceHref: undefined,
          sequence: undefined,
          // #112 — a copy is a new record. Inheriting the original's CREATED
          // would tell the server this task was created years ago. This path
          // writes straight to `events` rather than going through `addEvent`,
          // so it stamps its own creation time.
          created: new Date().toISOString(),
          lastModified: undefined,
        }

        set((state) => ({
          events: [...state.events, newEvent],
        }))
        bumpRangeExpansionVersion()

        return newEvent.id
      },

      addCalendar: (calendar: Calendar): void => {
        set((state) => {
          const exists = state.calendars.some((c) => c.id === calendar.id)
          if (exists) {
            // Update existing calendar instead of duplicating
            return {
              calendars: state.calendars.map((c) =>
                c.id === calendar.id ? { ...c, ...calendar } : c
              ),
            }
          }
          return { calendars: [...state.calendars, calendar] }
        })
        bumpRangeExpansionVersion()
      },

      updateCalendar: (id: string, updates: Partial<Calendar>): void => {
        set((state) => ({
          calendars: state.calendars.map((c) => (c.id === id ? { ...c, ...updates } : c)),
        }))
        bumpRangeExpansionVersion()
      },

      deleteCalendar: (id: string): void => {
        // Raw ICS blobs carry the calendar id, so they go in one query rather
        // than per event — which also catches resources no local event maps to.
        deleteRawIcsForCalendar(id).catch(() => {})
        set((state) => {
          // Clean up attachments for all events in this calendar
          for (const event of state.events) {
            if (event.calendarId === id) {
              deleteAttachments(event.id).catch(() => {})
            }
          }
          return {
            calendars: state.calendars.filter((c) => c.id !== id),
            events: state.events.filter((e) => e.calendarId !== id),
          }
        })
        bumpRangeExpansionVersion()
      },

      toggleCalendarVisibility: (id: string): void => {
        set((state) => ({
          calendars: state.calendars.map((c) =>
            c.id === id ? { ...c, isVisible: !c.isVisible } : c
          ),
        }))
        bumpRangeExpansionVersion()
      },

      setDefaultCalendar: (id: string): void => {
        const exists = get().calendars.some((c) => c.id === id)
        if (!exists) return
        set((state) => ({
          calendars: state.calendars.map((c) => ({
            ...c,
            isDefault: c.id === id,
          })),
        }))
        bumpRangeExpansionVersion()
      },

      addCategory: (category: Category): void => {
        // Dedupe by name. Sync auto-creates categories per calendar from a
        // snapshot taken before the loop, so two calendars sharing a category
        // name would otherwise each create their own "Work" with a different
        // UUID and a random colour.
        const existing = get().categories.find((c) => c.name === category.name)
        if (existing) return
        set((state) => ({
          categories: [...state.categories, category],
        }))
        bumpRangeExpansionVersion()
      },

      updateCategory: (id: string, updates: Partial<Category>): void => {
        const state = get()
        const existingCategory = state.categories.find((c) => c.id === id)
        const oldName = existingCategory?.name
        const newName = updates.name

        if (newName && oldName !== newName) {
          const nameCollision = state.categories.some(
            (c) => c.id !== id && c.name.toLowerCase() === newName.toLowerCase()
          )
          if (nameCollision) {
            console.warn(`[Calendar] Category name '${newName}' already exists. Rename rejected.`)
            return
          }
        }

        set((state) => {
          if (!oldName || !newName || oldName === newName) {
            return {
              categories: state.categories.map((c) => (c.id === id ? { ...c, ...updates } : c)),
            }
          }

          return {
            categories: state.categories.map((c) => (c.id === id ? { ...c, ...updates } : c)),
            events: state.events.map((e) => ({
              ...e,
              categories: e.categories?.map((cat) => (cat === oldName ? newName : cat)),
            })),
          }
        })
        bumpRangeExpansionVersion()
      },

      deleteCategory: (id: string): void => {
        set((state) => {
          const category = state.categories.find((c) => c.id === id)
          const categoryName = category?.name
          return {
            categories: state.categories.filter((c) => c.id !== id),
            events: state.events.map((e) => ({
              ...e,
              categories: categoryName
                ? e.categories?.filter((cat) => cat !== categoryName)
                : e.categories,
            })),
          }
        })
        bumpRangeExpansionVersion()
      },

      addAutoCategoryRule: (rule: AutoCategoryRule): void => {
        set((state) => ({
          autoCategoryRules: [...state.autoCategoryRules, rule],
        }))
      },

      updateAutoCategoryRule: (id: string, updates: Partial<AutoCategoryRule>): void => {
        set((state) => ({
          autoCategoryRules: state.autoCategoryRules.map((r) =>
            r.id === id ? { ...r, ...updates } : r
          ),
        }))
      },

      deleteAutoCategoryRule: (id: string): void => {
        set((state) => ({
          autoCategoryRules: state.autoCategoryRules.filter((r) => r.id !== id),
        }))
      },

      toggleCategoryFilter: (categoryId: string): void => {
        const current = get().selectedCategoryIds
        const index = current.indexOf(categoryId)
        const newValue =
          index === -1 ? [...current, categoryId] : current.filter((id) => id !== categoryId)
        set({ selectedCategoryIds: newValue })
        bumpRangeExpansionVersion()
      },

      setCurrentDate: (date: string): void => {
        set({ currentDate: date })
      },

      setCurrentView: (view: ViewType): void => {
        set({ currentView: view })
      },

      setSelectedEventId: (id: string | null): void => {
        set({ selectedEventId: id })
      },

      openModal: (
        date?: string,
        endDate?: string,
        eventId?: string,
        mode?: EventType,
        initialTitle?: string,
        parentTaskId?: string,
        initialCalendarId?: string
      ): void => {
        set({
          isModalOpen: true,
          selectedEventId: eventId ?? null,
          selectedDate: date ?? null,
          selectedEndDate: endDate ?? null,
          selectedEventType: mode ?? 'event',
          initialTitle: initialTitle ?? null,
          initialCalendarId: initialCalendarId ?? null,
          subtaskParentId: parentTaskId ?? null,
        })
      },

      closeModal: (): void => {
        // "Add all" from the AI-photo-import review picker queues the
        // remaining candidates here. Instead of fully closing, pop the next
        // one and re-seed the still-open form — EventModal's seeding effect
        // re-fires because selectedDate/selectedEndDate change, so this
        // works whether the previous candidate was saved or cancelled.
        const nextQueue = get().importQueue
        if (nextQueue.length > 0) {
          const [next, ...rest] = nextQueue
          set({
            importQueue: rest,
            pendingEventPrefill: next,
            isModalOpen: true,
            selectedEventId: null,
            selectedDate: next.start ?? null,
            selectedEndDate: next.end ?? null,
            // Per candidate, not per batch — one photo can yield a mix of
            // events and tasks, and each opens its own form in its own mode.
            selectedEventType: next.kind ?? 'event',
            initialTitle: null,
            initialCalendarId: null,
            subtaskParentId: null,
          })
          return
        }
        set({
          isModalOpen: false,
          selectedEventId: null,
          selectedDate: null,
          selectedEndDate: null,
          initialTitle: null,
          initialCalendarId: null,
          subtaskParentId: null,
          selectedEventType: 'event',
        })
      },

      // One-shot value: set right before openModal() by the AI-photo-import
      // flow, consumed and cleared by EventModal's seeding effect. Not reset
      // by closeModal — it must survive the brief moment between
      // setPendingEventPrefill and the modal's openModal() call reading it.
      setPendingEventPrefill: (fields: ExtractedEventFields | null): void => {
        set({ pendingEventPrefill: fields })
      },

      // Entry point for "Add all N events" in the AI-photo-import review
      // picker: opens the form for the first candidate and stashes the rest
      // in importQueue, which closeModal drains one at a time.
      startImportQueue: (candidates: ExtractedEventFields[]): void => {
        if (candidates.length === 0) return
        const [first, ...rest] = candidates
        set({
          importQueue: rest,
          pendingEventPrefill: first,
          isModalOpen: true,
          selectedEventId: null,
          selectedDate: first.start ?? null,
          selectedEndDate: first.end ?? null,
          selectedEventType: first.kind ?? 'event',
          initialTitle: null,
          initialCalendarId: null,
          subtaskParentId: null,
        })
      },

      setOverlayOpen: (isOpen: boolean): void => {
        set({ isOverlayOpen: isOpen })
      },

      setShowAddCalendar: (show: boolean): void => {
        set({ showAddCalendar: show })
      },

      openPreview: (eventId: string, position: { x: number; y: number }): void => {
        set({ previewEventId: eventId, previewPosition: position })
      },

      closePreview: (): void => {
        set({ previewEventId: null, previewPosition: null })
      },

      openJournalModal: (date: string, startInCompose: boolean = false): void => {
        set({
          isJournalModalOpen: true,
          journalModalDate: date,
          journalStartInCompose: startInCompose,
        })
      },

      closeJournalModal: (): void => {
        set({ isJournalModalOpen: false, journalModalDate: null, journalStartInCompose: false })
      },

      getEventsForDateRange: (start: string, end: string): CalendarEvent[] => {
        const state = get()

        const cacheKey = `${start}|${end}`
        const cached = rangeExpansionCache.get(cacheKey)
        if (
          cached &&
          cached.version === rangeExpansionVersion &&
          cached.calendars === state.calendars &&
          cached.categories === state.categories &&
          cached.selectedCategoryIds === state.selectedCategoryIds
        ) {
          return cached.result
        }

        const visibleCalendarIds = state.calendars.filter((c) => c.isVisible).map((c) => c.id)
        const selectedCategoryIds = state.selectedCategoryIds
        const selectedCategoryNames =
          selectedCategoryIds.length > 0
            ? state.categories.filter((c) => selectedCategoryIds.includes(c.id)).map((c) => c.name)
            : []

        const parseDate = parseISO(start)
        const parseDateEnd = parseISO(end)

        // Date-only strings (no time component) need startOfDay/endOfDay.
        // Z-suffixed date-only strings use UTC boundaries; plain date-only use local.
        // Strings with an explicit time component are used as-is.
        const hasTimeStart = /\dT\d/.test(start)
        const hasTimeEnd = /\dT\d/.test(end)
        const isDateOnlyStart = !hasTimeStart
        const isDateOnlyEnd = !hasTimeEnd

        let startDate: Date
        let endDate: Date
        if (isDateOnlyStart && start.endsWith('Z')) {
          // UTC date-only: use UTC start of day
          startDate = new Date(
            Date.UTC(
              parseDate.getUTCFullYear(),
              parseDate.getUTCMonth(),
              parseDate.getUTCDate(),
              0,
              0,
              0,
              0
            )
          )
        } else if (isDateOnlyStart) {
          startDate = startOfDay(parseDate)
        } else {
          // Has explicit time component — use as-is
          startDate = parseDate
        }

        if (isDateOnlyEnd && end.endsWith('Z')) {
          // UTC date-only: use UTC end of day
          endDate = new Date(
            Date.UTC(
              parseDateEnd.getUTCFullYear(),
              parseDateEnd.getUTCMonth(),
              parseDateEnd.getUTCDate(),
              23,
              59,
              59,
              999
            )
          )
        } else if (isDateOnlyEnd) {
          endDate = endOfDay(parseDateEnd)
        } else {
          // Has explicit time component — use as-is
          endDate = parseDateEnd
        }
        const index = getEventIndex(state.events)
        const {
          masters: recurringMasters,
          exceptions: exceptionMap,
          legacyExceptions: legacyExceptionMap,
        } = index

        // Collected with the event's position in `state.events` so the final
        // result keeps the original ordering, even though we no longer visit
        // events in array order.
        const collected: { order: number; event: CalendarEvent }[] = []
        const seenIds = new Set<string>()

        const startMs = startDate.getTime()
        const endMs = endDate.getTime()

        // Candidates: every recurring event (an occurrence can land anywhere),
        // plus the window of non-recurring events that can overlap the range.
        const candidates: IndexedEvent[] = index.recurring.slice()
        const upper = lastStartingAtOrBefore(index.plain, endMs)
        for (let i = upper; i >= 0; i--) {
          // Nothing at or before i can still be running when the range opens,
          // so the rest of the array is irrelevant.
          if (index.prefixMaxEnd[i] < startMs) break
          if (index.plain[i].spanEndMs >= startMs) candidates.push(index.plain[i])
        }

        for (const indexed of candidates) {
          const event = indexed.event
          if (!visibleCalendarIds.includes(event.calendarId)) {
            continue
          }
          if (event.eventStatus === 'CANCELLED') {
            continue
          }
          // R2.7 — the VTODO equivalent: a CANCELLED override cancels its one
          // occurrence, and it has already suppressed the master's slot for
          // that date via the exception map, so simply not emitting it here is
          // what makes the occurrence disappear.
          if (event.type === 'task' && event.taskStatus === 'CANCELLED') {
            continue
          }
          const categorySource = event.recurrenceId
            ? recurringMasters.get(event.recurrenceMasterId || event.uid || '')
            : event
          if (
            selectedCategoryNames.length > 0 &&
            categorySource &&
            !categorySource.categories?.some((category) => selectedCategoryNames.includes(category))
          ) {
            continue
          }

          const hasRecurrence = event.rruleString || event.recurrence

          if (hasRecurrence) {
            const rruleString = resolveRRuleString(event)

            try {
              if (!rruleString) {
                throw new Error('No rrule string')
              }
              const eventStart = indexed.start
              const eventEnd = indexed.end

              const rule = getOrCreateRRule(rruleString, rruleAnchor(event, eventStart))

              // TZID timed series expand in their own zone (wall clock held
              // across DST); the rrule path stays for all-day/UTC/floating.
              const occurrences =
                expandZonedOccurrences(event, startDate, endDate) ??
                rule.between(
                  ...rruleWindow(event.isAllDay, startDate, endDate),
                  true
                )
              const excludedDates = event.excludedDates || []

              for (const occ of occurrences) {
                // For all-day events we work in whole-day, floating-time terms so
                // that DST transitions can't shift an occurrence onto the wrong
                // calendar day. Timed events keep exact millisecond duration.
                const shape = shapeOccurrence(occ, eventStart, eventEnd, event.isAllDay)
                const { occDateStr } = shape

                // Check for exception first — if one exists for this date, use it
                // regardless of whether the date is also in excludedDates.
                const recurrenceValue = occurrenceRecurrenceValue(occ, occDateStr, event.isAllDay)
                const exception =
                  exceptionMap.get(`${event.calendarId}-${event.id}-${recurrenceValue}`) ||
                  legacyExceptionMap.get(`${event.calendarId}-${occDateStr}`)
                if (exception) {
                  // The detached instance is rendered independently at its
                  // actual start below. Here it only suppresses the master slot.
                  continue
                }

                // No exception — honour EXDATE exclusions
                if (isOccurrenceExcluded(occ, occDateStr, event.isAllDay, excludedDates, event.timezone)) {
                  continue
                }

                const occurrence = materializeOccurrence(event, shape)
                seenIds.add(occurrence.id)
                collected.push({ order: indexed.order, event: occurrence })
              }
            } catch {
              const eventStart = indexed.start
              const eventEnd = indexed.end
              if (
                isWithinInterval(eventStart, { start: startDate, end: endDate }) ||
                isWithinInterval(eventEnd, { start: startDate, end: endDate }) ||
                (eventStart <= startDate && eventEnd >= endDate)
              ) {
                if (!seenIds.has(event.id)) {
                  seenIds.add(event.id)
                  collected.push({ order: indexed.order, event })
                }
              }
            }
          } else {
            const eventStart = indexed.start
            const eventEnd = indexed.end

            if (
              isWithinInterval(eventStart, { start: startDate, end: endDate }) ||
              isWithinInterval(eventEnd, { start: startDate, end: endDate }) ||
              (eventStart <= startDate && eventEnd >= endDate)
            ) {
              if (!seenIds.has(event.id)) {
                seenIds.add(event.id)
                collected.push({ order: indexed.order, event })
              }
            }
          }
        }

        // Restore `state.events` ordering. The scan above visits recurring
        // events first and then walks the non-recurring window backwards, so
        // without this the result order would depend on the index layout
        // rather than on the stored order that callers have always seen.
        // Array.prototype.sort is stable, so an event's own occurrences keep
        // the order rrule produced them in.
        collected.sort((a, b) => a.order - b.order)
        const expandedEvents = collected.map((entry) => entry.event)

        // Cap the cache so a session that pans across many ranges can't grow it
        // unbounded; entries are cheap to recompute.
        if (rangeExpansionCache.size > 64) {
          rangeExpansionCache.clear()
        }
        rangeExpansionCache.set(cacheKey, {
          version: rangeExpansionVersion,
          calendars: state.calendars,
          categories: state.categories,
          selectedCategoryIds: state.selectedCategoryIds,
          result: expandedEvents,
        })

        return expandedEvents
      },

      getVisibleEvents: (): CalendarEvent[] => {
        const state = get()
        const visibleCalendarIds = state.calendars.filter((c) => c.isVisible).map((c) => c.id)

        return state.events.filter((event) => visibleCalendarIds.includes(event.calendarId))
      },
    }),
    {
      name: 'calino-storage',
      storage: createJSONStorage(() => safeLocalStorage),
      version: 2,
      migrate: (persistedState: unknown, fromVersion: number) => {
        const state = (persistedState ?? {}) as Partial<CalendarStore>
        let calendars = state.calendars ?? []

        // A prior bug could leave every calendar (including a real CalDAV
        // one) with isDefault: false while the offline calendar stayed
        // isDefault: true, or leave no calendar marked default at all. Heal
        // installs carrying that state forward: if a real (accountId-owned)
        // calendar exists, it should be the default, not the offline one.
        if (fromVersion < 2) {
          const realCalendar = calendars.find((c) => c.accountId)
          if (realCalendar && !realCalendar.isDefault) {
            calendars = calendars.map((c) => ({ ...c, isDefault: c.id === realCalendar.id }))
          }
        }

        return {
          events: state.events ?? [],
          calendars,
          categories: state.categories ?? [],
          autoCategoryRules: state.autoCategoryRules ?? [],
          brokenEvents: state.brokenEvents ?? [],
          duplicateUidIssues: state.duplicateUidIssues ?? [],
          // Deliberately today's date, not the persisted one: opening the app
          // should show the current month, not wherever the last session was
          // browsing. Same reasoning as currentView below.
          currentDate: format(new Date(), 'yyyy-MM-dd'),
          currentView: useSettingsStore.getState().defaultView,
          selectedCategoryIds: state.selectedCategoryIds ?? [],
        }
      },
      partialize: (state) => ({
        // Strip base64 data from attachments — actual data lives in IndexedDB
        events: state.events.map((event) => {
          if (!event.attachments || event.attachments.length === 0) return event
          return {
            ...event,
            attachments: event.attachments.map((att) => ({
              ...att,
              // Keep href for external URLs, clear for inline (data is in IndexedDB)
              href: att.href.startsWith('data:') ? '' : att.href,
            })),
          }
        }),
        brokenEvents: state.brokenEvents,
        duplicateUidIssues: state.duplicateUidIssues,
        calendars: state.calendars,
        categories: state.categories,
        autoCategoryRules: state.autoCategoryRules,
        // currentDate is NOT persisted: every fresh load starts on today.
      }),
    }
  )
)

function applyAutoCategories(
  title: string,
  rules: AutoCategoryRule[],
  categories: Category[]
): string[] {
  if (rules.length === 0 || categories.length === 0) return []

  const lowerTitle = title.toLowerCase()
  const matchingCategoryNames: string[] = []

  // Pre-build keyword → category name map for O(1) lookups
  const keywordMap = new Map<string, string>()
  for (const rule of rules) {
    const category = categories.find((c) => c.id === rule.categoryId)
    if (!category) continue
    for (const keyword of rule.keywords) {
      keywordMap.set(keyword.toLowerCase(), category.name)
    }
  }

  // Check if any keyword matches the title
  for (const [keyword, categoryName] of keywordMap) {
    if (lowerTitle.includes(keyword) && !matchingCategoryNames.includes(categoryName)) {
      matchingCategoryNames.push(categoryName)
    }
  }

  return matchingCategoryNames
}

// ── Journal helpers ─────────────────────────────────────────────────────

/**
 * True when a journal entry should be shown for the given calendar selection.
 * `visibleCalendarIds` is optional so existing callers that have no calendar
 * context (tests, exports) keep seeing every entry; pass it from any view that
 * honours the sidebar checkboxes, which is all of them.
 */
export function isJournalEntryVisible(
  event: CalendarEvent,
  visibleCalendarIds?: Set<string>
): boolean {
  if (event.type !== 'journal') return false
  return !visibleCalendarIds || visibleCalendarIds.has(event.calendarId)
}

export function getJournalEntriesForDate(
  events: CalendarEvent[],
  date: string,
  visibleCalendarIds?: Set<string>
): CalendarEvent[] {
  return events.filter((e) => isJournalEntryVisible(e, visibleCalendarIds) && e.start === date)
}

export function getJournalEntriesForMonth(
  events: CalendarEvent[],
  year: number,
  month: number,
  visibleCalendarIds?: Set<string>
): CalendarEvent[] {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`
  return events
    .filter((e) => isJournalEntryVisible(e, visibleCalendarIds) && e.start.startsWith(prefix))
    .sort((a, b) => b.start.localeCompare(a.start))
}

export function getJournalDates(
  events: CalendarEvent[],
  visibleCalendarIds?: Set<string>
): Set<string> {
  const dates = new Set<string>()
  for (const e of events) {
    if (isJournalEntryVisible(e, visibleCalendarIds)) dates.add(e.start)
  }
  return dates
}
