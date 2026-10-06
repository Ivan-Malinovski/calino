import type { JSCalendarObject, JsonObject } from '../types'
import { alarms, content } from './jscalToIcsContent'
import { people } from './jscalToIcsPeople'
import {
  exclusions,
  generatedOccurrences,
  recurrenceDate,
  recurrenceRule,
  rules,
} from './jscalToIcsRecurrence'
import {
  applyPatch,
  dateProperty,
  duration,
  endTime,
  entries,
  fold,
  object,
  string,
  text,
  utc,
} from './jscalToIcsValues'

function component(event: JsonObject, recurrenceId?: string, master = event): string[] {
  const task = event['@type'] === 'Task'
  const name = task ? 'VTODO' : 'VEVENT'
  const uid = string(master.uid)
  if (!uid) throw new Error('JSCalendar uid is required')
  const lines = [`BEGIN:${name}`, `UID:${text(uid)}`]
  const updated = string(event.updated)
  const created = string(event.created)
  // A missing timestamp must not make otherwise identical reads differ.
  lines.push(`DTSTAMP:${utc(updated ?? created ?? '1970-01-01T00:00:00Z')}`)
  if (created) lines.push(`CREATED:${utc(created)}`)
  if (updated) lines.push(`LAST-MODIFIED:${utc(updated)}`)
  if (typeof event.sequence === 'number') lines.push(`SEQUENCE:${event.sequence}`)
  const start = string(event.start)
  const tzid = string(event.timeZone)
  const allDay = event.showWithoutTime === true
  if (start) lines.push(dateProperty('DTSTART', start, tzid, allDay))
  else if (!task) throw new Error('JSCalendar Event start is required')
  if (!task && start) {
    const endLocation = entries(event.locations)
      .map(([, v]) => object(v))
      .find((v) => v.rel === 'end' || v.relativeTo === 'end')
    const endZone = string(event.endTimeZone) ?? string(endLocation?.timeZone) ?? tzid
    const length = string(event.duration) ?? 'PT0S'
    const parsedDuration = duration(length)
    if (!allDay && parsedDuration.days === 0 && Math.trunc(parsedDuration.seconds) === 0) {
      // RFC 5545 requires DTEND to be later than DTSTART. A zero-duration
      // event is valid with DURATION, and Calino preserves its equal times.
      lines.push('DURATION:PT0S')
    } else {
      const end = endTime(start, length, tzid, endZone, allDay)
      lines.push(dateProperty('DTEND', end, endZone, allDay))
    }
  }
  if (task) {
    if (typeof event.due === 'string') lines.push(dateProperty('DUE', event.due, tzid, allDay))
    if (typeof event.estimatedDuration === 'string') {
      duration(event.estimatedDuration)
      lines.push(`ESTIMATED-DURATION:${event.estimatedDuration}`)
    }
    if (typeof event.percentComplete === 'number')
      lines.push(`PERCENT-COMPLETE:${event.percentComplete}`)
    const progress = string(event.progress)
    const status = progress === 'failed' ? 'CANCELLED' : progress?.toUpperCase()
    if (status && ['NEEDS-ACTION', 'IN-PROCESS', 'COMPLETED', 'CANCELLED'].includes(status))
      lines.push(`STATUS:${status}`)
    if (progress === 'completed' && typeof event.progressUpdated === 'string')
      lines.push(`COMPLETED:${utc(event.progressUpdated)}`)
  } else {
    const status = string(event.status)?.toUpperCase()
    if (status && ['CONFIRMED', 'CANCELLED', 'TENTATIVE'].includes(status))
      lines.push(`STATUS:${status}`)
  }
  if (typeof event.priority === 'number') lines.push(`PRIORITY:${event.priority}`)
  if (event.freeBusyStatus === 'free' || event.freeBusyStatus === 'busy')
    lines.push(`TRANSP:${event.freeBusyStatus === 'free' ? 'TRANSPARENT' : 'OPAQUE'}`)
  const privacy = string(event.privacy)?.toUpperCase()
  if (privacy && ['PUBLIC', 'PRIVATE', 'SECRET', 'CONFIDENTIAL'].includes(privacy))
    lines.push(`CLASS:${privacy === 'SECRET' ? 'CONFIDENTIAL' : privacy}`)
  if (recurrenceId) lines.push(recurrenceDate('RECURRENCE-ID', recurrenceId, master))
  else {
    for (const rule of rules(event)) lines.push(`RRULE:${recurrenceRule(rule, event)}`)
    lines.push(...exclusions(event))
    const overrides = entries(event.recurrenceOverrides)
    const additions = generatedOccurrences(
      event,
      overrides.filter(([, patch]) => object(patch).excluded !== true).map(([id]) => id)
    )
    for (const [id, patch] of overrides) {
      if (object(patch).excluded === true) lines.push(recurrenceDate('EXDATE', id, event))
      else if (!additions.has(id)) lines.push(recurrenceDate('RDATE', id, event))
    }
  }
  lines.push(...content(event), ...people(event), ...alarms(event), `END:${name}`)
  return lines
}

/** Translate JSCalendar at the backend boundary; callers continue to consume iCalendar. */
export function jscalendarToIcs(
  event: JSCalendarObject,
  opts?: { prodId?: string; calendarName?: string }
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${text(opts?.prodId ?? '-//Calino//JMAP Calendar//EN')}`,
    'CALSCALE:GREGORIAN',
  ]
  if (opts?.calendarName !== undefined) lines.push(`X-WR-CALNAME:${text(opts.calendarName)}`)
  lines.push(...component(event))
  for (const [id, value] of entries(event.recurrenceOverrides)) {
    const patch = object(value)
    if (patch.excluded === true) continue
    const effective = entries(patch).filter(([key]) => key !== 'excluded')
    // An empty patch only adds an RDATE; it does not modify the occurrence.
    if (!effective.length) continue
    const occurrence = applyPatch({ ...event, start: id }, Object.fromEntries(effective))
    lines.push(...component(occurrence, id, event))
  }
  lines.push('END:VCALENDAR')
  return `${lines.map(fold).join('\r\n')}\r\n`
}
