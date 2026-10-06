import ICAL from 'ical.js'
import type { JsonObject, JSCalendarObject, JmapPatch } from '../types'
import { alerts, links, locations, participants, relatedTo, setMap, text } from './icsToJscalFields'
import {
  elapsedDuration,
  epochSeconds,
  mappedTime,
  recurrenceTime,
  utcTime,
} from './icsToJscalTime'
import type { IcsZoneContext } from './icsToJscalTime'
import { diffObjects } from './jscalendarDiff'

export { applyJmapPatch, diffJscalendar } from './jscalendarDiff'

export interface IcsToJscalendarOptions {
  vocabulary?: 'draft' | 'rfc8984'
  calendarIds?: Record<string, boolean>
}

function recurrenceRule(
  rule: ICAL.Recur,
  zone: string | null,
  context: IcsZoneContext
): JsonObject {
  const result: JsonObject = {
    '@type': 'RecurrenceRule',
    frequency: rule.freq.toLowerCase(),
    interval: rule.interval,
    firstDayOfWeek: ICAL.Recur.numericDayToIcalDay(rule.wkst).toLowerCase(),
  }
  if (rule.count !== null) result.count = rule.count
  if (rule.until) result.until = recurrenceTime(rule.until, null, zone, context)
  if (rule.parts.BYDAY)
    result.byDay = rule.parts.BYDAY.map((day) => {
      const match = /^([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)$/i.exec(day)
      if (!match) throw new Error(`Invalid RRULE BYDAY: ${day}`)
      return {
        '@type': 'NDay',
        day: match[2].toLowerCase(),
        ...(match[1] ? { nthOfPeriod: Number(match[1]) } : {}),
      }
    })
  const parts = {
    BYSECOND: 'bySecond',
    BYMINUTE: 'byMinute',
    BYHOUR: 'byHour',
    BYMONTHDAY: 'byMonthDay',
    BYYEARDAY: 'byYearDay',
    BYWEEKNO: 'byWeekNo',
    BYSETPOS: 'bySetPosition',
  } as const
  for (const [part, field] of Object.entries(parts)) {
    const values = rule.parts[part as keyof typeof parts]
    if (values) result[field] = [...values]
  }
  if (rule.parts.BYMONTH) result.byMonth = rule.parts.BYMONTH.map(String)
  const raw = rule.toJSON() as Record<string, unknown>
  if (typeof raw.rscale === 'string') result.rscale = raw.rscale.toLowerCase()
  if (typeof raw.skip === 'string') result.skip = raw.skip.toLowerCase()
  return result
}

function componentToObject(
  component: ICAL.Component,
  opts: IcsToJscalendarOptions,
  context: IcsZoneContext
): JSCalendarObject {
  const task = component.name === 'vtodo'
  const uid = text(component, 'uid')
  if (!uid) throw new Error('Calendar component requires UID')
  const event: JSCalendarObject = { '@type': task ? 'Task' : 'Event', uid }
  const vocabulary = opts.vocabulary ?? 'draft'
  const startProperty = component.getFirstProperty('dtstart')
  const start = startProperty?.getFirstValue()
  if (start instanceof ICAL.Time) {
    const mapped = mappedTime(start, startProperty ?? null, context)
    event.start = mapped.local
    event.timeZone = mapped.zone
    if (start.isDate) event.showWithoutTime = true
    if (!task) {
      const endProperty = component.getFirstProperty('dtend')
      const end = endProperty?.getFirstValue()
      const duration = component.getFirstPropertyValue('duration')
      if (end instanceof ICAL.Time) {
        if (end.isDate !== start.isDate) throw new Error('DTSTART and DTEND value types differ')
        event.duration = elapsedDuration(
          epochSeconds(end, endProperty ?? null, context) -
            epochSeconds(start, startProperty ?? null, context),
          start.isDate
        )
      } else if (duration instanceof ICAL.Duration) {
        if (duration.toSeconds() < 0) throw new Error('Negative event duration')
        event.duration = start.isDate
          ? elapsedDuration(duration.toSeconds(), true)
          : duration.toString()
      } else event.duration = start.isDate ? 'P1D' : 'PT0S'
    }
  } else if (!task) throw new Error('VEVENT requires DTSTART')

  if (task) {
    const dueProperty = component.getFirstProperty('due')
    const due = dueProperty?.getFirstValue()
    if (due instanceof ICAL.Time) {
      const mapped = mappedTime(due, dueProperty ?? null, context)
      event.due = mapped.local
      if (event.timeZone === undefined) event.timeZone = mapped.zone
      else if (event.timeZone !== mapped.zone)
        event.due = recurrenceTime(
          due,
          dueProperty ?? null,
          event.timeZone as string | null,
          context
        )
      if (due.isDate) event.showWithoutTime = true
    }
    const duration = component.getFirstPropertyValue('duration')
    if (duration instanceof ICAL.Duration) event.estimatedDuration = duration.toString()
    const percent = component.getFirstPropertyValue('percent-complete') as unknown
    if (typeof percent === 'number') event.percentComplete = percent
    const status = text(component, 'status')?.toLowerCase()
    if (status) event.progress = status === 'needs-action' ? 'needs-action' : status
    const completedProperty = component.getFirstProperty('completed')
    const completed = completedProperty?.getFirstValue()
    if (completed instanceof ICAL.Time)
      event.progressUpdated = utcTime(completed, completedProperty ?? null, context)
  } else {
    const status = text(component, 'status')?.toLowerCase()
    if (status) event.status = status
  }

  for (const [property, field] of [
    ['summary', 'title'],
    ['description', 'description'],
    ['color', 'color'],
  ]) {
    const value = text(component, property)
    if (value !== undefined) event[field] = value
  }
  // text/plain is the default; sending it makes Stalwart write STYLED-DESCRIPTION over CalDAV.
  if (event.description === undefined) delete event.descriptionContentType
  for (const name of ['priority', 'sequence']) {
    const value: unknown = component.getFirstPropertyValue(name)
    if (typeof value === 'number') event[name] = value
  }
  const transp = text(component, 'transp')
  if (transp) event.freeBusyStatus = transp.toUpperCase() === 'TRANSPARENT' ? 'free' : 'busy'
  const privacy = text(component, 'class')?.toUpperCase()
  if (privacy) event.privacy = privacy === 'CONFIDENTIAL' ? 'secret' : privacy.toLowerCase()
  for (const [field, property] of [
    ['created', 'created'],
    ['updated', component.hasProperty('dtstamp') ? 'dtstamp' : 'last-modified'],
  ]) {
    const prop = component.getFirstProperty(property)
    const time = prop?.getFirstValue()
    if (time instanceof ICAL.Time) event[field] = utcTime(time, prop ?? null, context)
  }
  const maps = {
    keywords: setMap(component, 'categories'),
    categories: setMap(component, 'concept'),
    locations: locations(component),
    links: links(component),
    participants: participants(component, vocabulary),
    alerts: alerts(component, context),
    relatedTo: relatedTo(component),
  }
  for (const [field, value] of Object.entries(maps)) if (value) event[field] = value
  const organizer = text(component, 'organizer')
  if (organizer) {
    const address = organizer.replace(/^MAILTO:/i, 'mailto:')
    if (vocabulary === 'draft') event.organizerCalendarAddress = address
    else event.replyTo = { imip: address }
  }
  const rules = component
    .getAllProperties('rrule')
    .map((property) => property.getFirstValue())
    .filter((value): value is ICAL.Recur => value instanceof ICAL.Recur)
  if (rules.length) {
    const converted = rules.map((rule) =>
      recurrenceRule(rule, (event.timeZone as string | null) ?? null, context)
    )
    if (vocabulary === 'draft') {
      if (converted.length > 1) throw new Error('Draft JSCalendar supports one RRULE')
      event.recurrenceRule = converted[0]
    } else event.recurrenceRules = converted
  }
  return event
}

const overrideIgnored = new Set([
  '@type',
  'uid',
  'id',
  'calendarIds',
  'created',
  'updated',
  'isDraft',
  'isOrigin',
  'recurrenceRule',
  'recurrenceRules',
  'recurrenceOverrides',
  'recurrenceId',
  'recurrenceIdTimeZone',
  'privacy',
  'relatedTo',
  'replyTo',
  'organizerCalendarAddress',
  'method',
  'prodId',
  'sentBy',
  'timeZones',
  'excludedRecurrenceRules',
])

/** Convert one iCalendar resource, collecting detached occurrences into the master. */
export function icsToJscalendar(
  ics: string,
  opts: IcsToJscalendarOptions = {}
): { uid: string; event: JSCalendarObject } {
  const calendar = new ICAL.Component(ICAL.parse(ics))
  if (calendar.name !== 'vcalendar') throw new Error('Expected VCALENDAR')
  const components = calendar
    .getAllSubcomponents()
    .filter((component) => component.name === 'vevent' || component.name === 'vtodo')
  const masters = components.filter((component) => !component.hasProperty('recurrence-id'))
  if (masters.length !== 1) throw new Error('Expected exactly one master VEVENT or VTODO')
  const master = masters[0]
  const context = { calendar }
  const event = componentToObject(master, opts, context)
  const uid = event.uid as string
  if (
    components.some((component) => text(component, 'uid') !== uid || component.name !== master.name)
  )
    throw new Error('Detached components must share the master UID and type')
  if (opts.calendarIds) event.calendarIds = { ...opts.calendarIds }
  const zone = (event.timeZone as string | null) ?? null
  const overrides: JsonObject = {}
  for (const property of master.getAllProperties('rdate')) {
    for (const value of property.getValues() as unknown[]) {
      if (value instanceof ICAL.Time) overrides[recurrenceTime(value, property, zone, context)] = {}
      else if (value instanceof ICAL.Period) {
        const key = recurrenceTime(value.start, property, zone, context)
        // `start` repeats the key (a no-op). Without it Stalwart writes a detached
        // VEVENT that has a DURATION but no DTSTART, which is invalid iCalendar.
        overrides[key] = {
          start: key,
          duration: value.duration
            ? value.duration.toString()
            : elapsedDuration(
                epochSeconds(value.end, property, context) -
                  epochSeconds(value.start, property, context)
              ),
        }
      }
    }
  }
  for (const component of components.filter((component) => component !== master)) {
    const property = component.getFirstProperty('recurrence-id')
    const recurrenceId = property?.getFirstValue()
    if (!(recurrenceId instanceof ICAL.Time)) throw new Error('Invalid RECURRENCE-ID')
    if (property?.getFirstParameter('range')?.toUpperCase() === 'THISANDFUTURE')
      throw new Error('RECURRENCE-ID RANGE=THISANDFUTURE requires splitting the series')
    const key = recurrenceTime(recurrenceId, property, zone, context)
    if (text(component, 'status')?.toUpperCase() === 'CANCELLED')
      overrides[key] = { excluded: true }
    else {
      const detached = componentToObject(component, opts, context)
      // Recurrence start is implicit at its key, not at the master's initial start.
      const occurrence = { ...event, start: key }
      const patch: JmapPatch = diffObjects(occurrence, detached, overrideIgnored)
      overrides[key] = patch
    }
  }
  // EXDATE takes precedence over an RDATE or a detached instance at the same instant.
  for (const property of master.getAllProperties('exdate')) {
    for (const value of property.getValues() as unknown[]) {
      if (value instanceof ICAL.Time)
        overrides[recurrenceTime(value, property, zone, context)] = {
          excluded: true,
        }
    }
  }
  if (Object.keys(overrides).length) event.recurrenceOverrides = overrides
  return { uid, event }
}
