import { RRule } from 'rrule'
import type { CalendarEvent, RecurrenceRule } from '@/types'
import { toICalUTC, toLocalDateString } from './datetime'

// byWeekday numbers stored in RecurrenceRule → BYDAY codes
export const DAY_NUM_TO_CODE: Record<number, string> = {
  0: 'SU',
  1: 'MO',
  2: 'TU',
  3: 'WE',
  4: 'TH',
  5: 'FR',
  6: 'SA',
}

export const FREQ_MAP: Record<string, string> = {
  secondly: 'SECONDLY',
  minutely: 'MINUTELY',
  hourly: 'HOURLY',
  daily: 'DAILY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
  yearly: 'YEARLY',
}

/**
 * `rule.endDate` arrives in three shapes, and only the string itself says which:
 *
 *  - `'2025-12-30'`            floating date  — CalDAV all-day UNTIL, and
 *                              buildMasterTruncation's all-day branch
 *  - `'2025-12-31T23:59:59'`   floating local — the "repeat until" picker
 *                              (EventModal), and floating CalDAV UNTIL
 *  - `'2025-12-31T04:59:59Z'`  true instant   — timed CalDAV UNTIL, and
 *                              buildMasterTruncation's timed branch
 *
 * Returns the calendar day to write as a VALUE=DATE UNTIL. A trailing Z means a
 * genuine instant, so its UTC day is the answer; anything else is floating and
 * the day is simply the one written in the string — passing it through a Date
 * would invent a zone and shift it (that is exactly how an all-day series
 * created west of UTC ended up running a day long).
 */
function untilDateOnly(endDate: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(endDate) && !/Z$/i.test(endDate)) {
    return endDate.slice(0, 10).replaceAll('-', '')
  }
  const d = new Date(endDate)
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
}

/** Parse an iCal UNTIL value (`YYYYMMDD`, `YYYYMMDDTHHMMSS`, or `…Z`). */
function parseUntilValue(value: string): Date | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/i)
  if (!m) return null
  const [, y, mo, d, h = '0', mi = '0', s = '0', z] = m
  const n = (v: string): number => parseInt(v, 10)
  return z
    ? new Date(Date.UTC(n(y), n(mo) - 1, n(d), n(h), n(mi), n(s)))
    : new Date(n(y), n(mo) - 1, n(d), n(h), n(mi), n(s))
}

/**
 * Rewrite a timed UNTIL to its local calendar day, in VALUE=DATE form. A
 * date-only UNTIL is already floating and is left alone — converting it would
 * shift it a day backwards west of UTC.
 */
function rewriteUntilToLocalDate(rruleString: string): string {
  return rruleString.replace(/UNTIL=([^;]+)/i, (whole, value: string) => {
    if (/^\d{8}$/.test(value)) return whole
    const d = parseUntilValue(value)
    if (!d || isNaN(d.getTime())) return whole
    return `UNTIL=${toLocalDateString(d).replaceAll('-', '')}`
  })
}

/**
 * The same rewrite, for descriptions only — RRule.toText() renders UNTIL with
 * UTC getters (see rrule's nlp/totext.js), so west of UTC a series the user
 * ended on Dec 31 23:59 local is described as running "until January 1, 2026".
 * toText() only prints the date portion, so nothing else in the sentence moves.
 *
 * The RRULE that gets stored and synced comes from buildRRuleString and never
 * passes through here.
 */
function localiseUntilForDisplay(rruleString: string): string {
  return rewriteUntilToLocalDate(rruleString)
}

/**
 * Repair an all-day series whose stored RRULE carries a timed UNTIL.
 *
 * RFC 5545 §3.3.10 requires UNTIL to match DTSTART's value type, so an all-day
 * series must end on a date, not an instant. Calino wrote instants here until
 * the fix that added `isAllDay` to EventModal's rule, and those series are
 * still out there — on servers, and in local storage. Left alone they run one
 * day long west of UTC, because that instant falls on the following UTC day.
 *
 * Applied where such a string is *used* rather than migrated in place: the
 * server copy can't be assumed corrected, so a sync would keep reintroducing
 * it. Correcting it at the two choke points — expansion and serialization —
 * means the grid stops drawing the extra day immediately, and the next save
 * writes a conformant rule.
 *
 * The day is resolved in the viewer's zone, which is the best available guess:
 * the original picker date is not recoverable from the instant alone if the
 * series was created in a different zone.
 */
export function normaliseAllDayUntil(rruleString: string, isAllDay: boolean | undefined): string {
  if (!isAllDay) return rruleString
  return rewriteUntilToLocalDate(rruleString)
}

function capitaliseFirst(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * RRule.toText() doesn't support secondly. Provide a fallback that uses the
 * same wording style (every N seconds / every second).
 */
function describeSecondly(interval: number): string {
  if (interval === 1) return 'Every second'
  if (interval === 2) return 'Every other second'
  return `Every ${interval} seconds`
}

/**
 * Build an RFC 5545 RRULE string from a RecurrenceRule object.
 *
 * Handles: FREQ, INTERVAL, BYDAY (with positional prefix, e.g. 2TU for
 * second Tuesday), BYMONTHDAY, BYMONTH, BYWEEKNO, BYYEARDAY, BYHOUR,
 * BYMINUTE, BYSECOND, WKST, BYSETPOS (only when byWeekday is empty),
 * UNTIL (with Z suffix), and COUNT. UNTIL takes precedence over
 * COUNT per RFC 5545.
 *
 * R2.1 — For all-day events (rule.isAllDay === true), UNTIL is emitted
 * as VALUE=DATE (YYYYMMDD) per RFC 5545 §3.3.10. The caller must set
 * isAllDay on the recurrence object before calling this function.
 *
 * R2.4 — Per-BYDAY ordinals (e.g. 2MO, -1FR) come from rule.byDayOrdinals,
 * NOT rule.bySetPos. rule.bySetPos is reserved for the standalone
 * BYSETPOS rule part (e.g. "last weekday" = BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1).
 *
 * Used by:
 *  - recurrence.ts (human-readable descriptions via rrule.toText())
 *  - calendarStore.ts (event expansion)
 *  - icalTypeMapping.ts (CalDAV serialization)
 */
export function buildRRuleString(rule: RecurrenceRule): string {
  const parts: string[] = []
  parts.push(`FREQ=${FREQ_MAP[rule.frequency] ?? 'WEEKLY'}`)

  if (rule.interval && rule.interval > 1) {
    parts.push(`INTERVAL=${rule.interval}`)
  }

  if (rule.byWeekday && rule.byWeekday.length > 0) {
    const bydayParts: string[] = []
    for (let i = 0; i < rule.byWeekday.length; i++) {
      const dayCode = DAY_NUM_TO_CODE[rule.byWeekday[i]]
      if (dayCode) {
        // R2.4 — Read per-BYDAY ordinals from byDayOrdinals, not bySetPos.
        const pos = rule.byDayOrdinals?.[i]
        if (pos !== undefined && pos !== 0) {
          bydayParts.push(`${pos}${dayCode}`)
        } else {
          bydayParts.push(dayCode)
        }
      }
    }
    if (bydayParts.length > 0) {
      parts.push(`BYDAY=${bydayParts.join(',')}`)
    }
  }

  if (rule.byMonthDay && rule.byMonthDay.length > 0) {
    parts.push(`BYMONTHDAY=${rule.byMonthDay.join(',')}`)
  }

  if (rule.byMonth && rule.byMonth.length > 0) {
    parts.push(`BYMONTH=${rule.byMonth.join(',')}`)
  }

  // R2.4 — Standalone BYSETPOS: only emit when neither BYDAY nor per-BYDAY
  // ordinals are present. If byWeekday is set, bySetPos is treated as
  // legacy per-BYDAY positional data (deprecated) and folded into the
  // BYDAY emission above. True standalone BYSETPOS is the rare "last
  // weekday of month" case (BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1) where
  // byWeekday is also set — handled by the per-BYDAY ordinals path.
  if (
    rule.bySetPos &&
    rule.bySetPos.length > 0 &&
    (!rule.byWeekday || rule.byWeekday.length === 0) &&
    (!rule.byDayOrdinals || rule.byDayOrdinals.length === 0)
  ) {
    parts.push(`BYSETPOS=${rule.bySetPos.join(',')}`)
  }

  // R2.4 — New RRULE parts per RFC 5545 §3.3.10.
  if (rule.byWeekNo && rule.byWeekNo.length > 0) {
    parts.push(`BYWEEKNO=${rule.byWeekNo.join(',')}`)
  }
  if (rule.byYearDay && rule.byYearDay.length > 0) {
    parts.push(`BYYEARDAY=${rule.byYearDay.join(',')}`)
  }
  if (rule.byHour && rule.byHour.length > 0) {
    parts.push(`BYHOUR=${rule.byHour.join(',')}`)
  }
  if (rule.byMinute && rule.byMinute.length > 0) {
    parts.push(`BYMINUTE=${rule.byMinute.join(',')}`)
  }
  if (rule.bySecond && rule.bySecond.length > 0) {
    parts.push(`BYSECOND=${rule.bySecond.join(',')}`)
  }
  if (rule.wkst) {
    parts.push(`WKST=${rule.wkst}`)
  }

  if (rule.endDate) {
    if (rule.isAllDay) {
      // R2.1 — VALUE=DATE form for all-day events per RFC 5545 §3.3.10: emit
      // YYYYMMDD with no time component and no Z suffix. Which day that is
      // depends on the shape endDate arrived in — see untilDateOnly.
      parts.push(`UNTIL=${untilDateOnly(rule.endDate)}`)
    } else {
      parts.push(`UNTIL=${toICalUTC(new Date(rule.endDate))}`)
    }
  } else if (rule.count) {
    parts.push(`COUNT=${rule.count}`)
  }

  return parts.join(';')
}

function describeFromRruleString(rruleString: string): string {
  if (/^FREQ=SECONDLY/i.test(rruleString) || /;FREQ=SECONDLY/i.test(rruleString)) {
    const intervalMatch = rruleString.match(/INTERVAL=(\d+)/i)
    const interval = intervalMatch ? parseInt(intervalMatch[1], 10) : 1
    return describeSecondly(interval)
  }
  try {
    const rrule = RRule.fromString(
      `RRULE:${localiseUntilForDisplay(rruleString.replace(/^RRULE:/i, ''))}`
    )
    return capitaliseFirst(rrule.toText())
  } catch {
    return 'Recurring'
  }
}

/**
 * Human-readable text for a bare rule ("Every 2 days"), for callers that have
 * a `RecurrenceRule` but no event yet — the command palette's quick-add row
 * describes what it is about to create before the event exists.
 */
export function describeRecurrenceRule(rule: RecurrenceRule): string {
  if (rule.frequency === 'secondly') {
    return describeSecondly(rule.interval ?? 1)
  }
  try {
    const rruleString = localiseUntilForDisplay(buildRRuleString(rule))
    const rrule = RRule.fromString(`RRULE:${rruleString}`)
    return capitaliseFirst(rrule.toText())
  } catch {
    return 'Recurring'
  }
}

export function describeRecurrence(event: CalendarEvent): string {
  if (event.rruleString) return describeFromRruleString(event.rruleString)
  if (event.recurrence) return describeRecurrenceRule(event.recurrence)
  return 'Recurring'
}
