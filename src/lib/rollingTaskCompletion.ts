import { parseISO } from 'date-fns'
import {
  isOccurrenceExcluded,
  materializeOccurrence,
  materializeOccurrenceAt,
  occurrenceInstant,
  occurrencesAfter,
  parseOccurrenceInstant,
  resolveRRuleString,
  shapeOccurrence,
  type OccurrenceShape,
} from '@/lib/occurrenceExpansion'
import type { CalendarEvent, RollingTaskCompletionPlan } from '@/types'

/**
 * R2.8 — Pure planning for the opt-in "rolling" recurring-task completion mode.
 *
 * Unlike the default override shape (master untouched + RECURRENCE-ID
 * components in the same resource), rolling mode keeps every calendar object
 * resource to a single VTODO, which is the only recurring-task shape
 * DAVx⁵/OpenTasks, Tasks.org's built-in CalDAV, and Apple Reminders understand:
 *
 *  1. Completing the earliest open occurrence re-anchors the master's
 *     DTSTART/DUE onto the next occurrence (COUNT decremented by the number of
 *     generated slots consumed) and records the finished one as a standalone
 *     COMPLETED VTODO under a new UID.
 *  2. Completing a later occurrence while an earlier one is still open cannot
 *     move the anchor without losing the earlier one, so that date goes onto
 *     the master's EXDATE and only the standalone copy is written.
 *  3. Completing the last occurrence (COUNT exhausted, or past UNTIL) marks the
 *     master itself COMPLETED — there is nothing left to roll to.
 *
 * Serialisation owns the PID/UID and never writes an X- property, so a copy
 * written here reads back as an ordinary finished task in every client.
 */

/**
 * Hard cap on the occurrence walk. A rule that is both infinite and entirely
 * EXDATE'd would otherwise spin forever; 500 generated slots covers well over a
 * year of daily recurrence, far past any series a rolling-mode completion can
 * reach before its COUNT or UNTIL ends it.
 */
const MAX_ROLL_SCAN = 500

export interface RollingCompletionOptions {
  /** Stamp for the copy's COMPLETED/CREATED. */
  now: Date
  /**
   * UID for the standalone copy. Caller-supplied so the plan is deterministic:
   * the same call must always describe the same resource write.
   */
  newUid: string
}

/**
 * Plan the rolling-mode write for completing `occurrenceStart` of `master`.
 *
 * `overrides` is the master's RECURRENCE-ID overrides, keyed by occurrence
 * (both the full start and the date-only form, as elsewhere in the expansion
 * path). They are residue from the default mode: an override covering this
 * occurrence is folded into the standalone copy and dropped from the resource,
 * because leaving it behind would keep the master's resource multi-component —
 * exactly what rolling mode exists to avoid.
 *
 * Returns null when the master cannot roll at all (not a task, no RRULE, no
 * due date to anchor it), `kind: 'fallback'` when this occurrence must keep the
 * override shape (an override living in its own Nextcloud resource must not be
 * folded, and a date the current rule no longer generates is described by an
 * override rather than a copy), and `kind: 'noop'` for a click naming an
 * occurrence the series has already moved past.
 */
export function planRollingTaskCompletion(
  master: CalendarEvent,
  occurrenceStart: string,
  overrides: Map<string, CalendarEvent>,
  { now, newUid }: RollingCompletionOptions
): RollingTaskCompletionPlan | null {
  if (master.type !== 'task') return null
  if (!resolveRRuleString(master)) return null
  // Without a due date there is no DTSTART to anchor a rule to (see
  // docs/RECURRING_TASKS.md), so there is nothing to roll.
  if (!master.dueDate) return null

  const anchor = occurrenceInstant(master, master.start)
  const target = occurrenceInstant(master, occurrenceStart)
  if (Number.isNaN(anchor.getTime()) || Number.isNaN(target.getTime())) return null

  // The walk's duration endpoints, resolved in the same frame as
  // `nextOpenOccurrence` so occurrences land on the instants the views show.
  const shapeStart =
    !master.isAllDay && master.timezone
      ? parseOccurrenceInstant(master.start, master.timezone)
      : parseISO(master.start)
  const shapeEnd =
    !master.isAllDay && master.timezone
      ? parseOccurrenceInstant(master.end, master.timezone)
      : parseISO(master.end)
  const shapeOf = (occ: Date): OccurrenceShape =>
    shapeOccurrence(occ, shapeStart, shapeEnd, master.isAllDay, master.timezone)

  const targetShape = shapeOf(target)
  const existingOverride =
    overrides.get(targetShape.occStartStr) ?? overrides.get(targetShape.occDateStr)
  // Nextcloud Tasks writes an exception to its OWN resource. Folding it here
  // would leave the original behind on the server as a duplicate, so leave that
  // shape to the override path.
  if (
    existingOverride?.resourceHref &&
    master.resourceHref &&
    existingOverride.resourceHref !== master.resourceHref
  ) {
    return { kind: 'fallback' }
  }

  // Before the anchor the current rule generates nothing: this click names an
  // occurrence the series has already moved past (a stale row during the
  // animation of an earlier completion, say). Completing it again would write a
  // duplicate finished task, so there is nothing to do.
  if (target.getTime() < anchor.getTime()) {
    return { kind: 'noop' }
  }

  // One pass over the generated slots: whether anything earlier is still open,
  // and the first open occurrence after this one together with its position in
  // the rule (COUNT counts slots from DTSTART, so that position is how many the
  // rolled master has to skip).
  let consumed = 0
  let openBefore = false
  let reachedTarget = false
  let nextOpen: OccurrenceShape | null = null
  let scanned = 0
  for (const occ of occurrencesAfter(master, new Date(anchor.getTime() - 1))) {
    if (scanned++ >= MAX_ROLL_SCAN) break
    const shape = shapeOf(occ)
    const open = isOpenSlot(master, overrides, occ, shape)
    if (occ.getTime() === target.getTime()) {
      reachedTarget = true
      continue
    }
    if (!reachedTarget) {
      // Defensive: the rule yielded past the target without naming it (an
      // override for a date the current rule does not generate).
      if (occ.getTime() > target.getTime()) break
      if (open) openBefore = true
      continue
    }
    if (open) {
      nextOpen = shape
      // Slots before the new anchor are gone from the rule: the target itself
      // plus anything between it and this occurrence that was already closed.
      consumed = scanned - 1
      break
    }
  }

  if (!reachedTarget) {
    // Not an occurrence of the current rule — most likely an override left
    // behind by a rule edit. The override path describes that one instance
    // correctly, so let it, rather than inventing a copy for a date the series
    // no longer generates.
    return { kind: 'fallback' }
  }

  // The copy inherits the override's content when one exists, so edits made to
  // that occurrence before the mode was switched on survive the conversion.
  const occurrence = existingOverride ?? materializeOccurrenceAt(master, occurrenceStart)
  const completedCopy: CalendarEvent = {
    ...occurrence,
    id: newUid,
    uid: newUid,
    // A standalone completed task describes one finished date, not a series
    // (RFC 5545 §3.8.5.3) — and carries none of the master's series identity.
    rruleString: undefined,
    recurrence: undefined,
    excludedDates: undefined,
    recurrenceId: undefined,
    recurrenceMasterId: undefined,
    occurrenceMasterId: undefined,
    completed: true,
    taskStatus: 'COMPLETED',
    percentComplete: 100,
    completedAt: now.toISOString(),
    sequence: 0,
    etag: undefined,
    resourceHref: undefined,
    syncStatus: undefined,
    created: now.toISOString(),
    lastModified: undefined,
  }
  const removedOverrideIds = existingOverride ? [existingOverride.id] : []

  if (openBefore) {
    // Completing a future occurrence out of order: rolling the anchor forward
    // would silently drop the earlier open ones, so exclude just this date.
    return {
      kind: 'roll',
      master: withExdate(master, targetShape, target),
      completedCopy,
      removedOverrideIds,
    }
  }

  if (!nextOpen) {
    // The series' last occurrence. The master itself becomes the finished task,
    // at this occurrence's dates, so no separate copy is written.
    const finalOccurrence = materializeOccurrenceAt(master, occurrenceStart)
    return {
      kind: 'final',
      master: {
        ...master,
        start: finalOccurrence.start,
        end: finalOccurrence.end,
        dueDate: finalOccurrence.dueDate,
        completed: true,
        taskStatus: 'COMPLETED',
        percentComplete: 100,
        completedAt: now.toISOString(),
      },
      removedOverrideIds,
    }
  }

  const next = materializeOccurrence(master, nextOpen)
  return {
    kind: 'roll',
    master: {
      ...master,
      start: next.start,
      end: next.end,
      dueDate: next.dueDate,
      completed: false,
      taskStatus: 'NEEDS-ACTION',
      percentComplete: 0,
      completedAt: undefined,
      ...consumeGeneratedSlots(master, consumed),
    },
    completedCopy,
    removedOverrideIds,
  }
}

/** True when this generated slot is neither EXDATE'd nor already overridden. */
function isOpenSlot(
  master: CalendarEvent,
  overrides: Map<string, CalendarEvent>,
  occ: Date,
  shape: OccurrenceShape
): boolean {
  if (overrides.has(shape.occStartStr) || overrides.has(shape.occDateStr)) return false
  return !isOccurrenceExcluded(
    occ,
    shape.occDateStr,
    master.isAllDay,
    master.excludedDates,
    master.timezone
  )
}

/** The master with one occurrence excluded, in the form EXDATE is stored in. */
function withExdate(master: CalendarEvent, shape: OccurrenceShape, occ: Date): CalendarEvent {
  const value = master.isAllDay ? shape.occDateStr : shape.occStartStr
  const excludedDates = master.excludedDates ?? []
  const already = master.isAllDay
    ? excludedDates.some((date) => date.split('T')[0] === shape.occDateStr)
    : excludedDates.some(
        (date) => parseOccurrenceInstant(date, master.timezone).getTime() === occ.getTime()
      )
  if (already) return master
  return { ...master, excludedDates: [...excludedDates, value] }
}

/**
 * Drop the first `count` slots from the rule, which is what moving DTSTART
 * forward over them means: COUNT always counts from DTSTART, so leaving it
 * alone would extend the series by that many extra occurrences.
 *
 * UNTIL is deliberately untouched (it names an absolute instant, not a length).
 * Rules without COUNT — infinite, or bounded by UNTIL — have nothing to adjust.
 */
function consumeGeneratedSlots(
  master: CalendarEvent,
  count: number
): Pick<CalendarEvent, 'rruleString' | 'recurrence'> {
  if (count <= 0) return {}
  const patch: Pick<CalendarEvent, 'rruleString' | 'recurrence'> = {}

  const rruleString = master.rruleString
  if (rruleString) {
    const match = /(^|;)COUNT=(\d+)(;|$)/i.exec(rruleString)
    if (match) {
      const remaining = Number(match[2]) - count
      if (remaining > 0) {
        patch.rruleString = rruleString.replace(
          /(^|;)COUNT=\d+(;|$)/i,
          (_whole, before: string, after: string) => `${before}COUNT=${remaining}${after}`
        )
      }
    }
  }

  const rule = master.recurrence
  if (rule?.count !== undefined) {
    const remaining = rule.count - count
    if (remaining > 0) patch.recurrence = { ...rule, count: remaining }
  }

  return patch
}
