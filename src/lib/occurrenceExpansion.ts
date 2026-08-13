import { parseISO } from 'date-fns'
import { RRule } from 'rrule'
import { buildRRuleString } from './recurrence'
import type { CalendarEvent } from '@/types'

/**
 * R2.7 — Shared per-occurrence math for recurring VEVENTs and VTODOs.
 *
 * Extracted from `getEventsForDateRange` so the event and task expansion paths
 * cannot drift on the two things that are easy to get subtly wrong: the
 * floating-midnight arithmetic that keeps all-day occurrences on the right
 * local day across a DST transition, and the exception-before-EXDATE ordering
 * (RFC 5545 §3.8.5.1 — a detached instance supersedes the recurrence set, so an
 * override wins even when its date is also EXDATE'd).
 */

export interface OccurrenceShape {
  /** ISO start of this occurrence — floating for all-day, UTC otherwise. */
  occStartStr: string
  /** ISO end, preserving the master's DTSTART→DUE/DTEND duration. */
  occEndStr: string
  /** `yyyy-MM-dd` of the occurrence start. */
  occDateStr: string
  /** Identity suffix: the date for all-day, the full instant otherwise. */
  occKey: string
}

const MS_PER_DAY = 86400000

const formatUTCDate = (dt: Date): string =>
  `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate()
  ).padStart(2, '0')}`

/**
 * Place one rrule-produced occurrence, given the master's own start/end.
 */
export function shapeOccurrence(
  occ: Date,
  eventStart: Date,
  eventEnd: Date,
  isAllDay: boolean | undefined
): OccurrenceShape {
  if (isAllDay) {
    const durationDays = Math.max(
      0,
      Math.round((eventEnd.getTime() - eventStart.getTime()) / MS_PER_DAY)
    )
    // All-day occurrences are produced from the UTC anchor built by
    // `rruleAnchor`, so read them back in UTC too and rebuild floating
    // midnights, adding days via UTC date arithmetic (immune to DST shifts).
    const startDay = new Date(Date.UTC(occ.getUTCFullYear(), occ.getUTCMonth(), occ.getUTCDate()))
    const endDay = new Date(startDay)
    endDay.setUTCDate(endDay.getUTCDate() + durationDays)
    const occDateStr = formatUTCDate(startDay)
    return {
      occDateStr,
      occStartStr: `${occDateStr}T00:00:00`,
      occEndStr: `${formatUTCDate(endDay)}T00:00:00`,
      occKey: occDateStr,
    }
  }

  const occEnd = new Date(occ.getTime() + (eventEnd.getTime() - eventStart.getTime()))
  return {
    occStartStr: occ.toISOString(),
    occEndStr: occEnd.toISOString(),
    occDateStr: occ.toISOString().split('T')[0],
    occKey: occ.toISOString(),
  }
}

/**
 * The DTSTART to hand `rrule` for this event.
 *
 * `rrule` evaluates BYDAY/BYMONTHDAY against the UTC fields of its dtstart. An
 * all-day date is timezone-less (RFC 5545 §3.3.4), but parsing it with
 * `parseISO` yields *local* midnight — which is the previous UTC day anywhere
 * east of UTC. A weekly "every Tuesday" rule then sees a Monday anchor and
 * generates Wednesdays. Anchoring at UTC midnight of the literal date keeps
 * rrule's weekday arithmetic on the day the user actually picked.
 *
 * Timed events are genuine instants and are passed through unchanged.
 */
export function rruleAnchor(event: CalendarEvent, parsedStart: Date): Date {
  if (!event.isAllDay) return parsedStart
  return utcMidnight(event.start)
}

/**
 * Translate a query window into the frame {@link rruleAnchor} generates in.
 *
 * All-day occurrences come back at UTC midnight, but callers ask in local-day
 * terms. Without this, a range starting at local midnight would miss its own
 * first all-day occurrence anywhere west of UTC (00:00Z is the previous
 * evening locally) and pick up a spurious trailing one east of it. Mapping the
 * window's local calendar dates onto the same UTC dates keeps both ends exact.
 */
export function rruleWindow(
  isAllDay: boolean | undefined,
  startDate: Date,
  endDate: Date
): [Date, Date] {
  if (!isAllDay) return [startDate, endDate]
  const from = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate())
  const to = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate())
  // Inclusive of the whole final day.
  return [new Date(from), new Date(to + MS_PER_DAY - 1)]
}

/** UTC midnight of an ISO string's date part, ignoring any time or offset. */
function utcMidnight(iso: string): Date {
  const [y, m, d] = iso.split('T')[0].split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** The key an override's RECURRENCE-ID is indexed under for this occurrence. */
export function occurrenceRecurrenceValue(
  occ: Date,
  occDateStr: string,
  isAllDay: boolean | undefined
): string | number {
  return isAllDay ? occDateStr : occ.getTime()
}

/** True when EXDATE excludes this occurrence. */
export function isOccurrenceExcluded(
  occ: Date,
  occDateStr: string,
  isAllDay: boolean | undefined,
  excludedDates: string[] | undefined
): boolean {
  if (!excludedDates || excludedDates.length === 0) return false
  return isAllDay
    ? excludedDates.some((date) => date.split('T')[0] === occDateStr)
    : excludedDates.some((date) => parseISO(date).getTime() === occ.getTime())
}

/** The event's RRULE as a string, whether stored raw or structured. */
export function resolveRRuleString(event: CalendarEvent): string | undefined {
  if (event.rruleString) return event.rruleString
  // isAllDay decides whether UNTIL is emitted as a floating date or a UTC
  // instant, and an instant one day past the intended end adds a spurious final
  // occurrence west of UTC. Every other caller injects the flag the same way
  // (icalTypeMapping's writeRRule, calendarMirror) — do it here too rather than
  // rely on whoever built `recurrence` having set it.
  if (event.recurrence) return buildRRuleString({ ...event.recurrence, isAllDay: event.isAllDay })
  return undefined
}

/**
 * Hard cap on the next-occurrence walk. An RRULE with no UNTIL/COUNT is
 * infinite, so the search must be able to give up: a daily task untouched for
 * years, or a rule whose every occurrence is EXDATE'd, would otherwise spin
 * forever. 500 steps covers well over a year of daily recurrence.
 */
const MAX_OCCURRENCE_SCAN = 500

/**
 * R2.7 — The earliest occurrence of a recurring task that is still open.
 *
 * Anchored at the later of the master's own start and the most recent completed
 * override, so a long completion history costs one `after()` call rather than a
 * walk from the series' beginning. Occurrences that already have an override
 * (completed, cancelled, or merely edited) or an EXDATE are skipped.
 *
 * Returns null when the series is exhausted — a finite rule whose occurrences
 * are all done. The caller shows the last completed occurrence instead.
 */
export function nextOpenOccurrence(
  master: CalendarEvent,
  overridesByRecurrenceId: Map<string, CalendarEvent>
): OccurrenceShape | null {
  const rruleString = resolveRRuleString(master)
  if (!rruleString) return null

  const masterStart = parseISO(master.start)
  const anchor = rruleAnchor(master, masterStart)
  let rule: RRule
  try {
    rule = new RRule({ ...RRule.parseString(rruleString), dtstart: anchor })
  } catch {
    return null
  }

  // Start the walk just before the anchor so the anchor itself is a candidate.
  let cursor = new Date(anchor.getTime() - 1)
  for (const override of overridesByRecurrenceId.values()) {
    if (!override.completed) continue
    // Compare in the same frame the rule generates in, or an all-day
    // RECURRENCE-ID parsed as local midnight sorts before its own occurrence.
    const at = master.isAllDay
      ? utcMidnight(override.recurrenceId as string)
      : parseISO(override.recurrenceId as string)
    if (at.getTime() > cursor.getTime()) cursor = at
  }

  for (let i = 0; i < MAX_OCCURRENCE_SCAN; i++) {
    const occ = rule.after(cursor, false)
    if (!occ) return null
    const shape = shapeOccurrence(occ, masterStart, parseISO(master.end), master.isAllDay)
    const hasOverride =
      overridesByRecurrenceId.has(shape.occStartStr) ||
      overridesByRecurrenceId.has(shape.occDateStr)
    if (
      !hasOverride &&
      !isOccurrenceExcluded(occ, shape.occDateStr, master.isAllDay, master.excludedDates)
    ) {
      return shape
    }
    cursor = occ
  }
  return null
}

/**
 * The occurrence of a series that best represents it *now*: the next one due,
 * or — for a series that has finished — the most recent past one.
 *
 * Unlike {@link nextOpenOccurrence}, which walks from the master's own start
 * looking for unfinished work, this is anchored on the current instant. Callers
 * that show a series as a single row (search results, deep links) want the
 * occurrence a user would recognise, not the one the series began with, which
 * for a long-running weekly is years stale.
 *
 * EXDATE'd occurrences are skipped in both directions. Overrides are not: a
 * detached instance is a real occurrence of the series and still the right
 * thing to point at. Returns null for a non-recurring or unparseable master.
 */
export function displayOccurrence(master: CalendarEvent, now: Date): OccurrenceShape | null {
  const rruleString = resolveRRuleString(master)
  if (!rruleString) return null

  const masterStart = parseISO(master.start)
  const masterEnd = parseISO(master.end)
  let rule: RRule
  try {
    rule = new RRule({
      ...RRule.parseString(rruleString),
      dtstart: rruleAnchor(master, masterStart),
    })
  } catch {
    return null
  }

  // `now` has to be mapped into the frame the rule generates in for the same
  // reason `rruleWindow` exists: an all-day series produces UTC midnights, so
  // comparing them against a local instant is off by up to a day.
  const [from] = rruleWindow(master.isAllDay, now, now)

  const shapeOf = (occ: Date): OccurrenceShape =>
    shapeOccurrence(occ, masterStart, masterEnd, master.isAllDay)
  const excluded = (occ: Date, shape: OccurrenceShape): boolean =>
    isOccurrenceExcluded(occ, shape.occDateStr, master.isAllDay, master.excludedDates)

  // Forward from just before `from`, so an occurrence happening right now counts.
  let cursor = new Date(from.getTime() - 1)
  for (let i = 0; i < MAX_OCCURRENCE_SCAN; i++) {
    const occ = rule.after(cursor, false)
    if (!occ) break
    const shape = shapeOf(occ)
    if (!excluded(occ, shape)) return shape
    cursor = occ
  }

  // Series exhausted — fall back to the last occurrence that did happen.
  cursor = from
  for (let i = 0; i < MAX_OCCURRENCE_SCAN; i++) {
    const occ = rule.before(cursor, true)
    if (!occ) return null
    const shape = shapeOf(occ)
    if (!excluded(occ, shape)) return shape
    cursor = new Date(occ.getTime() - 1)
  }
  return null
}

/**
 * The instant a RECURRENCE-ID names, read in the frame the rule generates in.
 *
 * All-day recurrence ids are floating dates and must be resolved to the same
 * UTC midnight {@link rruleAnchor} uses; parsing them with `parseISO` yields
 * local midnight, which is the previous UTC day east of UTC.
 */
export function occurrenceInstant(master: CalendarEvent, occurrenceStart: string): Date {
  return master.isAllDay ? utcMidnight(occurrenceStart) : parseISO(occurrenceStart)
}

/**
 * Materialize one named occurrence without walking the rule to find it.
 *
 * Callers that already know which occurrence they mean (a RECURRENCE-ID in
 * hand) must build it through here rather than shaping it themselves, or they
 * reintroduce exactly the two bugs {@link occurrenceDueDate} and
 * {@link occurrenceInstant} exist to prevent.
 */
export function materializeOccurrenceAt(
  master: CalendarEvent,
  occurrenceStart: string
): CalendarEvent {
  const shape = shapeOccurrence(
    occurrenceInstant(master, occurrenceStart),
    parseISO(master.start),
    parseISO(master.end),
    master.isAllDay
  )
  return materializeOccurrence(master, shape)
}

/**
 * Build the occurrence event itself. Tasks additionally get a per-occurrence
 * `dueDate`: it is the field every task view buckets by, and leaving the
 * master's value on a spread copy would file every occurrence under the
 * series' first due date.
 */
export function materializeOccurrence(event: CalendarEvent, shape: OccurrenceShape): CalendarEvent {
  const occurrence: CalendarEvent = {
    ...event,
    id: `${event.id}-${shape.occKey}`,
    start: shape.occStartStr,
    end: shape.occEndStr,
  }
  if (event.type === 'task') {
    occurrence.dueDate = occurrenceDueDate(event, shape)
    // Lets an interactive card complete THIS occurrence without reverse
    // engineering the master's id out of the synthetic occurrence id.
    occurrence.occurrenceMasterId = event.id
  }
  return occurrence
}

/**
 * The DUE value for one occurrence, preserving the master's DTSTART→DUE offset
 * (RFC 5545 §3.6.2: that offset is a duration applying identically to every
 * occurrence) *and* the master's serialization shape.
 *
 * Both halves matter. Deriving it from the occurrence's `end` instead looks
 * right but isn't: Calino stores an all-day task's `end` as the same day at
 * 23:59:59, which rounds to a one-day duration and pushes every occurrence's
 * due date onto the following day — which then fails the day-key check and
 * makes the task vanish from the grid entirely. And an all-day `dueDate` is a
 * bare `yyyy-MM-dd`, so returning a full timestamp would break the day
 * bucketing that reads it literally.
 */
function occurrenceDueDate(master: CalendarEvent, shape: OccurrenceShape): string | undefined {
  if (!master.dueDate) return undefined
  if (master.isAllDay || !master.dueDate.includes('T')) return shape.occDateStr

  const offsetMs = parseISO(master.dueDate).getTime() - parseISO(master.start).getTime()
  return new Date(parseISO(shape.occStartStr).getTime() + offsetMs).toISOString()
}
