import ICAL from 'ical.js'
import type { JsonObject } from '../types'
import { dateProperty, localInstant, object, string, time, utc } from './jscalToIcsValues'

const frequencies = new Set([
  'yearly',
  'monthly',
  'weekly',
  'daily',
  'hourly',
  'minutely',
  'secondly',
])
const days = new Set(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'])

export function rules(event: JsonObject): JsonObject[] {
  // Prefer the newer spelling when both are provided; never duplicate rules.
  if (
    event.recurrenceRule &&
    typeof event.recurrenceRule === 'object' &&
    !Array.isArray(event.recurrenceRule)
  ) {
    return [object(event.recurrenceRule)]
  }
  return Array.isArray(event.recurrenceRules) ? event.recurrenceRules.map(object) : []
}

export function recurrenceRule(rule: JsonObject, event: JsonObject): string {
  const frequency = string(rule.frequency)?.toLowerCase()
  if (!frequency || !frequencies.has(frequency))
    throw new Error('Invalid JSCalendar recurrence frequency')
  if (rule.rscale && rule.rscale !== 'gregorian')
    throw new Error('Non-Gregorian JSCalendar recurrence is unsupported')
  const parts = [`FREQ=${frequency.toUpperCase()}`]
  if (typeof rule.interval === 'number' && rule.interval > 0)
    parts.push(`INTERVAL=${rule.interval}`)
  if (typeof rule.count === 'number') parts.push(`COUNT=${rule.count}`)
  else if (typeof rule.until === 'string') {
    const allDay = event.showWithoutTime === true
    const tzid = string(event.timeZone)
    const until = time(rule.until, tzid, allDay)
    const value =
      !allDay && tzid ? utc(localInstant(until, tzid).toISOString()) : until.toICALString()
    parts.push(`UNTIL=${value}`)
  }
  if (Array.isArray(rule.byDay)) {
    const values = rule.byDay.map((value) => {
      const item = object(value)
      const day = (string(item.day) ?? string(value) ?? '').toUpperCase()
      if (!days.has(day)) throw new Error('Invalid JSCalendar recurrence weekday')
      return `${typeof item.nthOfPeriod === 'number' && item.nthOfPeriod !== 0 ? item.nthOfPeriod : ''}${day}`
    })
    if (values.length) parts.push(`BYDAY=${values.join(',')}`)
  }
  for (const [key, name] of [
    ['byMonthDay', 'BYMONTHDAY'],
    ['byMonth', 'BYMONTH'],
    ['bySetPosition', 'BYSETPOS'],
    ['byYearDay', 'BYYEARDAY'],
    ['byWeekNo', 'BYWEEKNO'],
    ['byHour', 'BYHOUR'],
    ['byMinute', 'BYMINUTE'],
    ['bySecond', 'BYSECOND'],
  ]) {
    const values = rule[key]
    if (Array.isArray(values) && values.length) {
      const numbers = values.map((v) => (typeof v === 'string' ? Number(v) : v))
      if (!numbers.every((v) => typeof v === 'number' && Number.isInteger(v))) {
        throw new Error(`Unsupported JSCalendar recurrence ${key}`)
      }
      parts.push(`${name}=${numbers.join(',')}`)
    }
  }
  const wkst = string(rule.firstDayOfWeek)?.toUpperCase()
  if (wkst && days.has(wkst)) parts.push(`WKST=${wkst}`)
  return parts.join(';')
}

/** Classify override keys against the unmodified recurrence set, not moved DTSTARTs. */
export function generatedOccurrences(event: JsonObject, recurrenceIds: string[]): Set<string> {
  const generated = new Set<string>()
  const start = string(event.start)
  if (!start || !recurrenceIds.length) return generated
  const allDay = event.showWithoutTime === true
  // Membership is a comparison of LocalDateTimes. Expanding in a floating
  // calendar avoids ical.js choosing a different side of an ambiguous DST
  // fold when it compares a zoned occurrence with a UTC UNTIL.
  const startTime = time(start.replace(/Z$/, ''), undefined, allDay)
  const targets = recurrenceIds.map((id) => ({
    id,
    time: time(id.replace(/Z$/, ''), undefined, allDay),
  }))
  for (const target of targets) if (startTime.compare(target.time) === 0) generated.add(target.id)
  const latest = targets.reduce((a, b) => (a.time.compare(b.time) > 0 ? a : b)).time
  const wanted = new Map(targets.map((target) => [target.time.toICALString(), target.id]))
  for (const rule of rules(event)) {
    const iterator = ICAL.Recur.fromString(
      recurrenceRule(rule, { ...event, timeZone: null })
    ).iterator(startTime)
    // Prevent hostile/unbounded subsecond series from freezing the sync thread.
    let steps = 0
    for (;;) {
      const occurrence = iterator.next()
      if (!occurrence || occurrence.compare(latest) > 0) break
      const key = wanted.get(occurrence.toICALString())
      if (key) generated.add(key)
      if (++steps > 100_000)
        throw new Error('JSCalendar recurrence membership exceeds 100000 occurrences')
    }
  }
  return generated
}

export function recurrenceDate(name: string, id: string, master: JsonObject): string {
  return dateProperty(name, id, string(master.timeZone), master.showWithoutTime === true)
}

export function exclusions(event: JsonObject): string[] {
  if (!Array.isArray(event.excludedRecurrenceRules)) return []
  const start = string(event.start)
  const output = new Set<string>()
  for (const value of event.excludedRecurrenceRules) {
    const rule = object(value)
    const serialized = recurrenceRule(rule, event)
    if (!start || (!rule.count && !rule.until)) {
      // An infinite set cannot be represented as a finite EXDATE list.
      output.add(`EXRULE:${serialized}`)
      continue
    }
    const iterator = ICAL.Recur.fromString(
      recurrenceRule(rule, { ...event, timeZone: null })
    ).iterator(time(start.replace(/Z$/, ''), undefined, event.showWithoutTime === true))
    const dates: string[] = []
    let occurrence: ICAL.Time | null
    while ((occurrence = iterator.next()) && dates.length < 100_000) {
      dates.push(recurrenceDate('EXDATE', occurrence.toString(), event))
    }
    if (occurrence) output.add(`EXRULE:${serialized}`)
    else for (const date of dates) output.add(date)
  }
  return [...output]
}
