import { format, parseISO } from 'date-fns'
import type { CalendarEvent, RecurrenceRule } from '@/types'

/**
 * Deciding whether the user actually changed an event's recurrence.
 *
 * Extracted from `EventModal`'s `hasChanges` memo, which gates the whole save:
 * when it reports "nothing changed", `saveEvent` closes the modal without
 * writing. That made this comparison load-bearing rather than cosmetic — a
 * false negative silently discards the edit — and it was worth having under
 * direct test rather than reachable only through a 15-dependency memo.
 *
 * The comparison is deliberately NOT a deep equality check on the rule object:
 * the form and the stored rule use different shapes for the same meaning (an
 * absent `count` vs. an inactive "after N times" field), so both sides are
 * normalised onto one key first.
 */

export type RecurrenceEndCondition = 'never' | 'on' | 'after'

/** The recurrence half of the event form's state. */
export interface RecurrenceFormState {
  recurring: boolean
  frequency: string
  interval: number
  byWeekday: number[]
  byMonthDay: number[]
  byMonth: number[]
  byDayOrdinals: number[]
  endCondition: RecurrenceEndCondition
  endOnDate: string
  endAfterCount: number
}

function buildKey(
  recurring: boolean,
  frequency: string,
  interval: number,
  byWeekday: number[],
  byMonthDay: number[],
  byMonth: number[],
  byDayOrdinals: number[],
  endCondition: string,
  endOnDate: string,
  endAfterCount: number
): string | null {
  if (!recurring) return null
  return JSON.stringify({
    frequency,
    interval,
    byWeekday,
    byMonthDay,
    byMonth,
    byDayOrdinals,
    // Only the field belonging to the active end condition participates.
    // "Ends after 10 times" and "never ends" both leave a 10 sitting in the
    // count input, and comparing it unconditionally would report a change
    // that the user cannot see and did not make.
    ...(endCondition === 'on' ? { endOnDate } : endCondition === 'after' ? { endAfterCount } : {}),
  })
}

/** Normalised key for the form's current recurrence, or null if not recurring. */
export function recurrenceFormKey(form: RecurrenceFormState): string | null {
  return buildKey(
    form.recurring,
    form.frequency,
    form.interval,
    form.byWeekday,
    form.byMonthDay,
    form.byMonth,
    form.byDayOrdinals,
    form.endCondition,
    form.endOnDate,
    form.endAfterCount
  )
}

/**
 * R2.4 — Per-BYDAY ordinals: prefer `byDayOrdinals`, falling back to
 * `bySetPos` for rules persisted before R2.4, which stored per-BYDAY ordinals
 * there whenever `byWeekday` was also present.
 */
function storedDayOrdinals(rule: RecurrenceRule): number[] {
  if (rule.byDayOrdinals && rule.byDayOrdinals.length > 0) return rule.byDayOrdinals
  if (rule.bySetPos && rule.bySetPos.length > 0 && rule.byWeekday && rule.byWeekday.length > 0) {
    return rule.bySetPos
  }
  return []
}

/** Normalised key for a stored rule, in the same shape as the form's. */
export function recurrenceRuleKey(rule: RecurrenceRule | undefined): string | null {
  if (!rule) return null
  const endCondition: RecurrenceEndCondition = rule.endDate ? 'on' : rule.count ? 'after' : 'never'
  return buildKey(
    true,
    rule.frequency,
    rule.interval ?? 1,
    rule.byWeekday ?? [],
    rule.byMonthDay ?? [],
    rule.byMonth ?? [],
    storedDayOrdinals(rule),
    endCondition,
    rule.endDate ? format(parseISO(rule.endDate), 'yyyy-MM-dd') : '',
    rule.count ?? 10
  )
}

/**
 * True when the form's recurrence differs from what the event currently has.
 *
 * `rruleString` is consulted for the recurring/not-recurring question because a
 * component parsed from CalDAV can carry a raw RRULE whose structured form
 * failed to parse. Treating that as "not recurring" would let switching the
 * toggle off read as no change at all.
 */
export function hasRecurrenceChanged(form: RecurrenceFormState, event: CalendarEvent): boolean {
  const wasRecurring = Boolean(event.recurrence || event.rruleString)
  if (form.recurring !== wasRecurring) return true
  return recurrenceFormKey(form) !== recurrenceRuleKey(event.recurrence)
}
