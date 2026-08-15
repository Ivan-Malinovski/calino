import ICAL from 'ical.js'
import { v4 as uuidv4 } from 'uuid'
import type {
  CalendarEvent,
  CalendarAttachment,
  CalendarAttendee,
  CalendarOrganizer,
  AttendeePartstat,
  RecurrenceRule,
  Reminder,
  TaskPriority,
} from '@/types'
import { addDays } from 'date-fns'
import { buildRRuleString, normaliseAllDayUntil } from '@/lib/recurrence'
import { toLocalDateString } from '@/lib/datetime'

const VALID_PARTSTATS: AttendeePartstat[] = [
  'ACCEPTED',
  'DECLINED',
  'TENTATIVE',
  'NEEDS-ACTION',
  'DELEGATED',
]

/** Strip the `mailto:` scheme RFC 5545 requires on CAL-ADDRESS values. */
function calAddressToEmail(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/^mailto:/i, '').trim()
}

function paramString(prop: ICAL.Property, name: string): string | undefined {
  const raw = prop.getParameter(name)
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * RFC 5545 §3.8.1.2 — read every CATEGORIES value off a component.
 *
 * CATEGORIES is a multi-value property and a component may carry more than one
 * CATEGORIES line. `getFirstProperty(...).getFirstValue()` returns only the
 * first value of the first line, which silently discarded every category but
 * one — `CATEGORIES:Work,Personal,Urgent` parsed as `['Work']` and the other
 * two were destroyed on the next save.
 *
 * ical.js splits a multi-value TEXT property for us, but whether it does so
 * depends on how the jCal was produced, so still split string values on commas
 * as a belt-and-braces measure.
 */
function readCategories(component: ICAL.Component): string[] {
  const categories: string[] = []
  for (const prop of component.getAllProperties('categories')) {
    for (const value of prop.getValues()) {
      if (typeof value !== 'string') continue
      for (const name of value.split(',')) {
        const trimmed = name.trim()
        // Preserve first-seen order; a category repeated across lines is one tag.
        if (trimmed.length > 0 && !categories.includes(trimmed)) categories.push(trimmed)
      }
    }
  }
  return categories
}

/**
 * RFC 5545 §3.8.1.2 — write CATEGORIES as a genuine multi-value property.
 *
 * Joining into one string and handing that to `updatePropertyWithValue` makes
 * ical.js treat the commas as literal TEXT and escape them, emitting
 * `CATEGORIES:Work\,Personal\,Urgent` — a *single* category whose name happens
 * to contain commas. `setValues` emits the separate values servers and other
 * clients expect.
 */
function writeCategories(component: ICAL.Component, categories: string[]): void {
  component.removeAllProperties('categories')
  if (categories.length === 0) return
  const prop = new ICAL.Property('categories', component)
  prop.setValues(categories)
  component.addProperty(prop)
}

/** RFC 5545 §3.8.4.1 — read every ATTENDEE off a component. */
export function parseAttendees(component: ICAL.Component): CalendarAttendee[] {
  const attendees: CalendarAttendee[] = []

  for (const prop of component.getAllProperties('attendee')) {
    const email = calAddressToEmail(prop.getFirstValue())
    if (!email) continue

    const partstatRaw = paramString(prop, 'partstat')?.toUpperCase()
    const partstat = VALID_PARTSTATS.find((p) => p === partstatRaw)
    const rsvp = paramString(prop, 'rsvp')?.toUpperCase()

    attendees.push({
      email,
      name: paramString(prop, 'cn'),
      role: paramString(prop, 'role'),
      partstat,
      // RFC 5545 defaults RSVP to FALSE when the parameter is absent.
      rsvp: rsvp === undefined ? undefined : rsvp === 'TRUE',
    })
  }

  return attendees
}

/** RFC 5545 §3.8.4.3 — read the ORGANIZER off a component. */
export function parseOrganizer(component: ICAL.Component): CalendarOrganizer | undefined {
  const prop = component.getFirstProperty('organizer')
  if (!prop) return undefined

  const email = calAddressToEmail(prop.getFirstValue())
  if (!email) return undefined

  return { email, name: paramString(prop, 'cn') }
}

/**
 * Write ORGANIZER and ATTENDEE back out. Existing properties are cleared
 * first: these are multi-valued, so updatePropertyWithValue can't be used and
 * appending would double them on every save.
 */
export function writeAttendees(component: ICAL.Component, event: CalendarEvent): void {
  // Existing properties are matched by address and mutated in place rather than
  // cleared and rebuilt. Calino only models CN/ROLE/PARTSTAT/RSVP, so a rebuild
  // silently destroyed DELEGATED-TO/FROM, MEMBER, CUTYPE, DIR, SENT-BY and
  // LANGUAGE — scheduling data belonging to whoever organised the meeting.
  const existingOrganizer = component.getFirstProperty('organizer')
  if (event.organizer?.email) {
    const prop = existingOrganizer ?? new ICAL.Property('organizer', component)
    prop.setValue(`mailto:${event.organizer.email}`)
    if (event.organizer.name) prop.setParameter('cn', event.organizer.name)
    else prop.removeParameter('cn')
    if (!existingOrganizer) component.addProperty(prop)
  } else if (existingOrganizer) {
    component.removeProperty(existingOrganizer)
  }

  const byEmail = new Map<string, ICAL.Property>()
  for (const prop of component.getAllProperties('attendee')) {
    const email = calAddressToEmail(prop.getFirstValue()).toLowerCase()
    // A duplicate address is malformed; keep the first and let the rest be
    // treated as surplus below.
    if (email && !byEmail.has(email)) byEmail.set(email, prop)
  }

  const kept = new Set<ICAL.Property>()
  for (const attendee of event.attendees ?? []) {
    if (!attendee.email) continue
    const existing = byEmail.get(attendee.email.toLowerCase())
    const prop = existing ?? new ICAL.Property('attendee', component)
    prop.setValue(`mailto:${attendee.email}`)

    // Only the four parameters Calino owns are written; a cleared field removes
    // its parameter rather than leaving a stale value behind.
    const params: Array<[string, string | undefined]> = [
      ['cn', attendee.name],
      ['role', attendee.role],
      ['partstat', attendee.partstat],
      ['rsvp', attendee.rsvp === undefined ? undefined : attendee.rsvp ? 'TRUE' : 'FALSE'],
    ]
    for (const [name, value] of params) {
      if (value) prop.setParameter(name, value)
      else prop.removeParameter(name)
    }

    if (!existing) component.addProperty(prop)
    kept.add(prop)
  }

  for (const prop of component.getAllProperties('attendee')) {
    if (!kept.has(prop)) component.removeProperty(prop)
  }
}

/**
 * Read one VALARM into the subset Calino models, or `null` when it carries a
 * trigger this app can't represent.
 *
 * Shared by the read path and by the patch-mode reconciler in
 * {@link calendarEventToIcalComponent}: the reconciler decides whether an alarm
 * still matches what the user has, so it must classify alarms exactly as the
 * read path did or it would rewrite alarms nobody touched — destroying
 * `RELATED=END`, REPEAT/DURATION and EMAIL alarm bodies in the process.
 *
 * A `null` result means "invisible to Calino": such an alarm is never counted
 * and never modified.
 */
function readAlarmReminder(
  valarm: ICAL.Component,
  dtstart?: ICAL.Time | null
): { minutesBefore: number; method: 'popup' | 'email' | 'audio' } | null {
  const triggerProp = valarm.getFirstProperty('trigger')
  if (!triggerProp) return null

  const triggerValue = triggerProp.getFirstValue()
  let minutes: number | null = null

  if (typeof triggerValue === 'string') {
    minutes = parseTriggerDuration(triggerValue)
  } else if (triggerValue instanceof ICAL.Duration) {
    // Duration triggers (e.g. -PT30M, +P2D) are parsed by ical.js as
    // ICAL.Duration. The sign of the duration tells us pre/post: negative is
    // "before", positive is "after" (per RFC 5545 §3.8.6.3). R2.6 — for
    // post-event reminders (positive), we emit `Math.abs` so the value is
    // non-negative; the UI doesn't currently distinguish but the option is there.
    minutes = Math.round(Math.abs(triggerValue.toSeconds()) / 60)
  } else if (triggerValue instanceof ICAL.Time) {
    // Bug 26 fix: calculate minutes from event DTSTART, not Date.now()
    const isoStr = icalTimeToISO(triggerValue).iso
    if (isoStr && dtstart) {
      const triggerDate = new Date(isoStr)
      const startDate = new Date(icalTimeToISO(dtstart).iso)
      if (!isNaN(triggerDate.getTime()) && !isNaN(startDate.getTime())) {
        minutes = Math.abs(Math.round((startDate.getTime() - triggerDate.getTime()) / 60000))
      }
    }
  }

  // `>= 0`: zero is "at the time of the event", a real reminder option.
  if (minutes === null || minutes < 0) return null

  // R2.6 — Read the VALARM ACTION property (DISPLAY/EMAIL/AUDIO) and map to the
  // Reminder.method union. Default to 'popup' for compatibility with existing
  // reminders and for any non-recognised ACTION values (x-name / iana-token)
  // which we still want to preserve as DISPLAY-ish.
  let method: 'popup' | 'email' | 'audio' = 'popup'
  const actionProp = valarm.getFirstProperty('action')
  if (actionProp) {
    const actionValue = actionProp.getFirstValue() as string
    if (actionValue === 'EMAIL') method = 'email'
    else if (actionValue === 'AUDIO') method = 'audio'
  }

  return { minutesBefore: minutes, method }
}

export function parseAppleTravelDuration(vevent: ICAL.Component): number | undefined {
  const prop = vevent.getFirstProperty('x-apple-travel-duration')
  if (prop) {
    const value = prop.getFirstValue() as string
    return parseTravelDuration(value) ?? undefined
  }
  return undefined
}

export function addAppleTravelDuration(vevent: ICAL.Component, minutes: number): void {
  vevent.removeAllProperties('x-apple-travel-duration')
  vevent.addPropertyWithValue('x-apple-travel-duration', formatMinutesToDuration(minutes))
}

function parseTravelDuration(duration: string): number | null {
  const match = duration.match(/P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/)
  if (!match) return null

  const weeks = parseInt(match[1] || '0', 10)
  const days = parseInt(match[2] || '0', 10)
  const hours = parseInt(match[3] || '0', 10)
  const minutes = parseInt(match[4] || '0', 10)
  const seconds = parseInt(match[5] || '0', 10)

  const totalMinutes =
    weeks * 7 * 24 * 60 + days * 24 * 60 + hours * 60 + minutes + Math.ceil(seconds / 60)
  return totalMinutes > 0 ? totalMinutes : null
}

function formatMinutesToDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60

  if (hours > 0 && mins > 0) {
    return `PT${hours}H${mins}M`
  } else if (hours > 0) {
    return `PT${hours}H`
  } else {
    return `PT${mins}M`
  }
}

/**
 * R2.6 — Format a reminder's minutesBefore as the most idiomatic
 * RFC 5545 §3.3.6 duration string, choosing the largest non-zero unit
 * so other clients can read it back correctly. Pre-event triggers
 * are emitted with a leading `-`; the iCal spec also accepts `+` for
 * post-event, but we always emit `-` for now.
 *
 * Examples: 15 → "-PT15M", 60 → "-PT1H", 1440 → "-P1D", 10080 → "-P1W"
 */
function formatReminderTrigger(minutesBefore: number): string {
  if (minutesBefore <= 0) return '-PT0M'
  if (minutesBefore % 10080 === 0) return `-P${minutesBefore / 10080}W`
  if (minutesBefore % 1440 === 0) return `-P${minutesBefore / 1440}D`
  const hours = Math.floor(minutesBefore / 60)
  const mins = minutesBefore % 60
  if (hours > 0 && mins === 0) return `-PT${hours}H`
  if (hours > 0) return `-PT${hours}H${mins}M`
  return `-PT${minutesBefore}M`
}

function parseRRule(rruleString: string): RecurrenceRule | undefined {
  const parts = rruleString.split(';')
  let frequency: RecurrenceRule['frequency'] = 'weekly'
  let interval = 1
  let endDate: string | undefined
  let count: number | undefined
  let byWeekday: number[] | undefined
  let byDayOrdinals: number[] | undefined
  let bySetPos: number[] | undefined
  let byMonthDay: number[] | undefined
  let byMonth: number[] | undefined
  let wkst: RecurrenceRule['wkst']
  let byHour: number[] | undefined
  let byMinute: number[] | undefined
  let bySecond: number[] | undefined
  let byWeekNo: number[] | undefined
  let byYearDay: number[] | undefined

  for (const part of parts) {
    const [key, value] = part.split('=')

    switch (key) {
      case 'FREQ':
        switch (value) {
          case 'SECONDLY':
            frequency = 'secondly'
            break
          case 'MINUTELY':
            frequency = 'minutely'
            break
          case 'HOURLY':
            frequency = 'hourly'
            break
          case 'DAILY':
            frequency = 'daily'
            break
          case 'WEEKLY':
            frequency = 'weekly'
            break
          case 'MONTHLY':
            frequency = 'monthly'
            break
          case 'YEARLY':
            frequency = 'yearly'
            break
        }
        break
      case 'INTERVAL':
        interval = parseInt(value, 10)
        break
      case 'UNTIL': {
        const parsed = parseICalDateTime(value)
        endDate = parsed.date
        break
      }
      case 'COUNT':
        count = parseInt(value, 10)
        break
      case 'BYDAY': {
        // R2.4 — Deconflate per-BYDAY ordinals from standalone BYSETPOS.
        // Each BYDAY element may carry an ordinal (e.g. 2MO = second Monday).
        // The ordinal is part of BYDAY, NOT a separate BYSETPOS rule part.
        const ordinalsList: number[] = []
        byWeekday = value.split(',').map((day) => {
          const dayMap: Record<string, number> = {
            SU: 0,
            MO: 1,
            TU: 2,
            WE: 3,
            TH: 4,
            FR: 5,
            SA: 6,
          }
          // RFC 5545: weekdaynum = [plus / minus] ordwk weekday
          // ordwk range 1..53 (RFC §3.3.10). Allow multi-digit ordinals.
          const match = day.match(/^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/)
          if (match) {
            const posStr = match[1]
            // 0 = "no ordinal" (plain BYDAY=MO)
            ordinalsList.push(posStr ? parseInt(posStr, 10) : 0)
            const dayCode = match[2]
            return dayMap[dayCode] ?? 1
          }
          return dayMap[day] ?? 1
        })
        // Only store byDayOrdinals if at least one element had a non-zero
        // ordinal. Otherwise leave it undefined to keep the output clean.
        if (ordinalsList.some((p) => p !== 0)) {
          byDayOrdinals = ordinalsList
        }
        break
      }
      case 'BYMONTHDAY': {
        const days = value
          .split(',')
          .map((d) => parseInt(d.trim(), 10))
          .filter((n) => !isNaN(n))
        if (days.length > 0) byMonthDay = days
        break
      }
      case 'BYMONTH': {
        const months = value
          .split(',')
          .map((m) => parseInt(m.trim(), 10))
          .filter((n) => !isNaN(n))
        if (months.length > 0) byMonth = months
        break
      }
      case 'BYSETPOS': {
        // Standalone BYSETPOS is a distinct rule part from per-BYDAY
        // ordinals. The two do NOT share storage after R2.4.
        const positions = value
          .split(',')
          .map((p) => parseInt(p.trim(), 10))
          .filter((n) => !isNaN(n))
        if (positions.length > 0) bySetPos = positions
        break
      }
      // R2.4 — Missing RRULE parts per RFC 5545 §3.3.10.
      case 'WKST': {
        if (
          value === 'MO' ||
          value === 'TU' ||
          value === 'WE' ||
          value === 'TH' ||
          value === 'FR' ||
          value === 'SA' ||
          value === 'SU'
        ) {
          wkst = value
        }
        break
      }
      case 'BYHOUR': {
        const hours = value
          .split(',')
          .map((h) => parseInt(h.trim(), 10))
          .filter((n) => !isNaN(n))
        if (hours.length > 0) byHour = hours
        break
      }
      case 'BYMINUTE': {
        const minutes = value
          .split(',')
          .map((m) => parseInt(m.trim(), 10))
          .filter((n) => !isNaN(n))
        if (minutes.length > 0) byMinute = minutes
        break
      }
      case 'BYSECOND': {
        const seconds = value
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n))
        if (seconds.length > 0) bySecond = seconds
        break
      }
      case 'BYWEEKNO': {
        const weeks = value
          .split(',')
          .map((w) => parseInt(w.trim(), 10))
          .filter((n) => !isNaN(n))
        if (weeks.length > 0) byWeekNo = weeks
        break
      }
      case 'BYYEARDAY': {
        const days = value
          .split(',')
          .map((d) => parseInt(d.trim(), 10))
          .filter((n) => !isNaN(n))
        if (days.length > 0) byYearDay = days
        break
      }
    }
  }

  return {
    frequency,
    interval,
    endDate,
    count,
    byWeekday,
    byDayOrdinals,
    bySetPos,
    byMonthDay,
    byMonth,
    wkst,
    byHour,
    byMinute,
    bySecond,
    byWeekNo,
    byYearDay,
  }
}

function parseICalDateTime(value: string): { date: string; isAllDay: boolean } {
  const isAllDay = value.length === 8

  if (isAllDay) {
    const year = value.substring(0, 4)
    const month = value.substring(4, 6)
    const day = value.substring(6, 8)
    return { date: `${year}-${month}-${day}`, isAllDay: true }
  }

  const hasTime = value.includes('T')
  const hasZ = value.endsWith('Z')
  const dateTimeValue = hasZ ? value.slice(0, -1) : value

  if (hasTime && dateTimeValue.length >= 15) {
    const year = dateTimeValue.substring(0, 4)
    const month = dateTimeValue.substring(4, 6)
    const day = dateTimeValue.substring(6, 8)
    const hour = dateTimeValue.substring(9, 11)
    const minute = dateTimeValue.substring(11, 13)
    const second = dateTimeValue.substring(13, 15)

    if (hasZ) {
      return {
        date: `${year}-${month}-${day}T${hour}:${minute}:${second}Z`,
        isAllDay: false,
      }
    }

    // Bug 25 fix: floating times (no Z, no TZID) must be preserved as-is per iCal spec.
    // Do NOT convert through the browser's local timezone.
    return {
      date: `${year}-${month}-${day}T${hour}:${minute}:${second}`,
      isAllDay: false,
    }
  }

  return { date: '', isAllDay: false }
}

function createIcalDateTime(isoString: string, tzid?: string): ICAL.Time {
  // R2.2 — When a TZID is provided, construct from the wall-clock ISO
  // string with the named zone. ical.js v2.2.1's `fromDateTimeString`
  // requires a Property (not a string) to read TZID from, so we use
  // the constructor directly with the `timezone` field. ical.js's
  // TypeScript declaration marks the constructor as taking 2 args
  // (data, zone) even though the runtime accepts 1 — pass
  // `utcTimezone` as a safe fallback for arithmetic purposes. The
  // TZID is carried via the property's TZID parameter (set by the
  // caller), not via the resolved zone.
  if (tzid) {
    const wall = isoString.replace(/Z$/, '').replace(/[+-]\d{2}:?\d{2}$/, '')
    // Parse the wall-clock ISO into components.
    const m = wall.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/)
    if (m) {
      return new ICAL.Time(
        {
          year: parseInt(m[1], 10),
          month: parseInt(m[2], 10),
          day: parseInt(m[3], 10),
          hour: parseInt(m[4], 10),
          minute: parseInt(m[5], 10),
          second: m[6] ? parseInt(m[6], 10) : 0,
          timezone: tzid,
        },
        ICAL.Timezone.utcTimezone
      )
    }
  }
  return ICAL.Time.fromJSDate(new Date(isoString), true)
}

interface IcalTimeToISOResult {
  iso: string
  tzid?: string
}

function icalTimeToISO(icalTime: ICAL.Time, prop?: ICAL.Property): IcalTimeToISOResult {
  if (!icalTime || !icalTime.year) {
    throw new Error('Invalid ICAL.Time')
  }

  if (icalTime.isDate) {
    return { iso: icalTime.toString() }
  }

  // R2.2 — Read TZID from the source property FIRST, before checking
  // the resolved zone. ical.js resolves an unknown TZID (one without
  // a registered VTIMEZONE) to 'floating' — so the zone check below
  // would short-circuit and lose the original IANA name.
  //
  // The Property's jCal is `[name, paramsObject, valueType, value]`
  // (per ical.js design). Read the tzid directly from jCal[1] — the
  // getParameter() API is not reliable in vitest's jsdom environment
  // for some reason, but the jCal structure is.
  const tzidFromProp =
    prop && prop.jCal && typeof prop.jCal[1] === 'object'
      ? (prop.jCal[1] as Record<string, string>).tzid
      : undefined
  if (tzidFromProp) {
    const year = String(icalTime.year).padStart(4, '0')
    const month = String(icalTime.month).padStart(2, '0')
    const day = String(icalTime.day).padStart(2, '0')
    const hour = String(icalTime.hour).padStart(2, '0')
    const minute = String(icalTime.minute).padStart(2, '0')
    const second = String(icalTime.second).padStart(2, '0')
    return { iso: `${year}-${month}-${day}T${hour}:${minute}:${second}`, tzid: tzidFromProp }
  }

  // Bug 25 fix: floating times (timezone 'floating') should be preserved as-is.
  // The iCal spec says floating times represent wall-clock time with no timezone.
  const tz = icalTime.zone
  if (tz && tz.tzid === 'floating') {
    const year = String(icalTime.year).padStart(4, '0')
    const month = String(icalTime.month).padStart(2, '0')
    const day = String(icalTime.day).padStart(2, '0')
    const hour = String(icalTime.hour).padStart(2, '0')
    const minute = String(icalTime.minute).padStart(2, '0')
    const second = String(icalTime.second).padStart(2, '0')
    return { iso: `${year}-${month}-${day}T${hour}:${minute}:${second}` }
  }

  // R2.2 — Fall back to the resolved zone's tzid if a VTIMEZONE was
  // registered (rare; usually the prop path above is enough).
  if (tz && tz.tzid && tz.tzid !== 'UTC') {
    const year = String(icalTime.year).padStart(4, '0')
    const month = String(icalTime.month).padStart(2, '0')
    const day = String(icalTime.day).padStart(2, '0')
    const hour = String(icalTime.hour).padStart(2, '0')
    const minute = String(icalTime.minute).padStart(2, '0')
    const second = String(icalTime.second).padStart(2, '0')
    return { iso: `${year}-${month}-${day}T${hour}:${minute}:${second}`, tzid: tz.tzid }
  }

  const jsDate = icalTime.toJSDate()
  if (!jsDate || isNaN(jsDate.getTime())) {
    throw new Error('Invalid JS Date')
  }
  return { iso: jsDate.toISOString() }
}

/**
 * Read one UTC audit stamp (CREATED / LAST-MODIFIED) off a component.
 * Returns undefined when the property is absent or unparseable — callers
 * must not invent a value, because a fabricated CREATED would overwrite the
 * real one the store already holds.
 */
function readAuditStamp(
  comp: ICAL.Component,
  name: 'created' | 'last-modified'
): string | undefined {
  const prop = comp.getFirstProperty(name)
  if (!prop) return undefined
  try {
    const value = prop.getFirstValue()
    if (value instanceof ICAL.Time) return icalTimeToISO(value).iso
  } catch {
    /* malformed stamp — treat as absent */
  }
  return undefined
}

/**
 * Write CREATED and LAST-MODIFIED (RFC 5545 §3.8.7.1 / §3.8.7.3). Both must be
 * UTC, hence the `true` on fromJSDate.
 *
 * We rebuild every component from scratch on save, so CREATED only survives
 * because the parsers read it back into `event.created`. When it is missing —
 * a record written before this existed, or one whose stored value is junk — we
 * stamp `now` rather than omitting the property: the whole point of issue #112
 * is that clients in the wild break when CREATED is absent. That stamp is then
 * parsed back on the next sync, so it moves once and then holds.
 *
 * `now` is passed in so LAST-MODIFIED cannot disagree with the caller's
 * DTSTAMP by a millisecond.
 */
function writeAuditStamps(comp: ICAL.Component, event: CalendarEvent, now: Date): void {
  const stored = event.created ? new Date(event.created) : undefined
  const created = stored && !isNaN(stored.getTime()) ? stored : now
  comp.updatePropertyWithValue('created', ICAL.Time.fromJSDate(created, true))
  comp.updatePropertyWithValue('last-modified', ICAL.Time.fromJSDate(now, true))
}

export function icalEventToCalendarEvent(
  vevent: ICAL.Component,
  calendarId: string
): CalendarEvent {
  const event = new ICAL.Event(vevent)

  const dtstart = event.startDate
  const dtend = event.endDate

  const isAllDay = dtstart ? dtstart.isDate : false

  let start = ''
  let end = ''
  let timezone: string | undefined

  if (dtstart) {
    // R2.2 — Capture TZID from the DTSTART property (not just the
    // resolved zone) so we re-emit the original wall-clock + TZID.
    const dtstartProp = vevent.getFirstProperty('dtstart')
    const startResult = icalTimeToISO(dtstart, dtstartProp ?? undefined)
    start = startResult.iso
    if (startResult.tzid) timezone = startResult.tzid
  }

  if (dtend) {
    if (isAllDay) {
      const endDateStr = dtend.toString()
      const endDate = new Date(endDateStr + 'T00:00:00Z')
      endDate.setUTCDate(endDate.getUTCDate() - 1)
      const year = endDate.getUTCFullYear()
      const month = String(endDate.getUTCMonth() + 1).padStart(2, '0')
      const day = String(endDate.getUTCDate()).padStart(2, '0')
      end = `${year}-${month}-${day}`
    } else {
      const dtendProp = vevent.getFirstProperty('dtend')
      const endResult = icalTimeToISO(dtend, dtendProp ?? undefined)
      end = endResult.iso
      // DTEND's TZID should match DTSTART's; only set if DTSTART
      // didn't have one (defensive).
      if (endResult.tzid && !timezone) timezone = endResult.tzid
    }
  }

  const { rruleString, recurrence } = readRRule(vevent)
  const excludedDates = readExdates(vevent)

  const reminders: Reminder[] = []
  for (const valarm of vevent.getAllSubcomponents('valarm')) {
    const parsed = readAlarmReminder(valarm, dtstart)
    if (parsed) reminders.push({ id: uuidv4(), ...parsed })
  }

  const travelDuration = parseAppleTravelDuration(vevent)

  const transpProp = vevent.getFirstProperty('transp')
  let transparency: 'transparent' | 'opaque' = 'opaque'
  if (transpProp) {
    const transpValue = transpProp.getFirstValue() as string
    transparency = transpValue === 'TRANSPARENT' ? 'transparent' : 'opaque'
  }

  const { recurrenceId } = readRecurrenceId(vevent)

  const categories = readCategories(vevent)

  // URL round-trips like it already does for VJOURNAL. Birthday/anniversary
  // events created from a contact carry their `calino:contact:<id>` marker
  // here; dropping it on parse made them look un-added after every sync.
  const urlProp = vevent.getFirstProperty('url')
  const url = urlProp ? (urlProp.getFirstValue() as string) : undefined

  const sequenceProp = vevent.getFirstProperty('sequence')
  const sequence = sequenceProp ? parseInt(sequenceProp.getFirstValue() as string, 10) : undefined

  // Parse attachments
  const attachments: CalendarAttachment[] = []
  const attachProps = vevent.getAllProperties('attach')
  for (const attachProp of attachProps) {
    const attachValue = attachProp.getFirstValue()

    // RFC 5545 §3.3.1: VALUE=BINARY with ENCODING=BASE64 → ical.js returns ICAL.Binary
    if (attachValue instanceof ICAL.Binary) {
      const base64Data = attachValue.decodeValue()
      const rawFmtType = attachProp.getParameter('fmttype')
      const contentType =
        (typeof rawFmtType === 'string' ? rawFmtType : undefined) || 'application/octet-stream'
      const filename = attachProp.getParameter('filename')
      attachments.push({
        href: `data:${contentType};base64,${base64Data}`,
        contentType,
        size: Math.round((base64Data.length * 3) / 4),
        filename: typeof filename === 'string' ? filename : 'attachment',
      })
    } else if (typeof attachValue === 'string') {
      // URI value type: could be a data: URI (legacy) or external URL
      if (attachValue.startsWith('data:')) {
        // Legacy data: URI format (backward compat)
        const match = attachValue.match(/^data:([^;]+);base64,(.+)$/)
        if (match) {
          const filename = attachProp.getParameter('filename')
          attachments.push({
            href: attachValue,
            contentType: match[1],
            size: Math.round((match[2].length * 3) / 4),
            filename: typeof filename === 'string' ? filename : 'attachment',
          })
        }
      } else {
        // External URL attachment
        const fmttype = attachProp.getParameter('fmttype')
        const filename = attachProp.getParameter('filename')
        attachments.push({
          href: attachValue,
          contentType: typeof fmttype === 'string' ? fmttype : 'application/octet-stream',
          filename:
            typeof filename === 'string' ? filename : attachValue.split('/').pop() || 'attachment',
        })
      }
    }
  }

  const attendees = parseAttendees(vevent)
  const uid = event.uid || uuidv4()
  const statusValue = vevent.getFirstPropertyValue('status')
  const eventStatus = typeof statusValue === 'string' ? statusValue.toUpperCase() : undefined

  return {
    id: recurrenceId ? `${uid}-${recurrenceId}` : uid,
    uid,
    calendarId,
    title: event.summary || 'Untitled',
    description: event.description,
    location: event.location,
    start,
    end,
    isAllDay,
    // R2.2 — Store the IANA TZID (e.g. 'America/New_York') so the
    // serializer can re-emit the TZID form on the wall-clock time.
    timezone,
    categories: categories.length > 0 ? categories : undefined,
    url,
    recurrence,
    reminders: reminders.length > 0 ? reminders : undefined,
    rruleString,
    travelDuration,
    transparency,
    sequence,
    excludedDates: excludedDates.length > 0 ? excludedDates : undefined,
    recurrenceId,
    recurrenceMasterId: recurrenceId ? uid : undefined,
    eventStatus,
    attachments: attachments.length > 0 ? attachments : undefined,
    created: readAuditStamp(vevent, 'created'),
    lastModified: readAuditStamp(vevent, 'last-modified'),
    attendees: attendees.length > 0 ? attendees : undefined,
    organizer: parseOrganizer(vevent),
  }
}

/**
 * Minutes before the event for a duration TRIGGER, or null when the string
 * carries no duration at all.
 *
 * Zero is a real value, not an absence: "-PT0M" is "at the time of the event",
 * which is one of the reminder options the UI offers. Returning null for it
 * meant such an alarm was dropped on read, so a reminder set to "At time of
 * event" survived until the next sync and then vanished. The `matched` flag
 * keeps that case apart from a malformed trigger like "-PTxyz", which really
 * does have nothing to read.
 */
function parseTriggerDuration(trigger: string): number | null {
  const prefix = trigger.startsWith('-PT') ? 3 : trigger.startsWith('PT') ? 2 : null
  if (prefix === null) return null

  const duration = trigger.substring(prefix)
  const hourMatch = duration.match(/(\d+)H/)
  const minMatch = duration.match(/(\d+)M/)
  const secMatch = duration.match(/(\d+)S/)
  if (!hourMatch && !minMatch && !secMatch) return null

  let minutes = 0
  if (hourMatch) minutes += parseInt(hourMatch[1], 10) * 60
  if (minMatch) minutes += parseInt(minMatch[1], 10)
  if (secMatch) minutes += Math.ceil(parseInt(secMatch[1], 10) / 60)

  return minutes
}

function createAllDayDate(year: number, month: number, day: number): ICAL.Time {
  const time = new ICAL.Time(
    {
      year,
      month,
      day,
      hour: 0,
      minute: 0,
      second: 0,
      isDate: true,
      timezone: 'UTC',
    },
    ICAL.Timezone.utcTimezone
  )
  return time
}

type OriginalAlarm = {
  comp: ICAL.Component
  parsed: { minutesBefore: number; method: 'popup' | 'email' | 'audio' } | null
}

/**
 * Bring a component's VALARMs in line with the user's reminders while
 * preserving everything Calino doesn't model.
 *
 * `Reminder.id` is regenerated on every parse, so reminders cannot be matched
 * to alarms by identity — the reconciliation is positional against the alarms
 * the original itself parsed to.
 *
 * The load-bearing rule is the "unchanged" case: when a reminder still matches
 * the alarm at its position, the VALARM is left completely untouched. That is
 * what preserves `TRIGGER;RELATED=END` (rewriting it start-relative would move
 * the alarm), REPEAT/DURATION snooze cycles, and the DESCRIPTION/SUMMARY/
 * ATTENDEE an EMAIL alarm is invalid without.
 *
 * Alarms that didn't parse are invisible to `event.reminders`; they are neither
 * counted nor touched, so exotic triggers survive a save untouched.
 */
function reconcileAlarms(
  comp: ICAL.Component,
  reminders: Reminder[],
  original: OriginalAlarm[]
): void {
  const modeled = original.filter((a) => a.parsed !== null)

  reminders.forEach((reminder, i) => {
    const existing = modeled[i]
    if (existing) {
      const same =
        existing.parsed!.minutesBefore === reminder.minutesBefore &&
        existing.parsed!.method === reminder.method
      if (same) return
      // Changed: rewrite only what Calino owns. The trigger it emits is
      // start-relative, so a stale RELATED=END would now mean the wrong instant.
      existing.comp.updatePropertyWithValue('action', alarmAction(reminder.method))
      existing.comp.updatePropertyWithValue(
        'trigger',
        formatReminderTrigger(reminder.minutesBefore)
      )
      existing.comp.getFirstProperty('trigger')?.removeParameter('related')
      return
    }

    const valarm = new ICAL.Component('valarm')
    // R2.6 — Map the Reminder.method back to the iCal ACTION token and use the
    // longest-fit trigger form (D > H > M) per RFC 5545 §3.3.6. Always emit a
    // negative (pre-event) trigger; the UI doesn't currently distinguish
    // post-event reminders, and emitting `+PT...` would require a Reminder
    // field refactor.
    valarm.updatePropertyWithValue('action', alarmAction(reminder.method))
    valarm.updatePropertyWithValue('trigger', formatReminderTrigger(reminder.minutesBefore))
    comp.addSubcomponent(valarm)
  })

  // Surplus modeled alarms are ones the user removed. Unmodeled ones stay.
  for (const surplus of modeled.slice(reminders.length)) {
    comp.removeSubcomponent(surplus.comp)
  }
}

function alarmAction(method: 'popup' | 'email' | 'audio'): string {
  return method === 'email' ? 'EMAIL' : method === 'audio' ? 'AUDIO' : 'DISPLAY'
}

/**
 * Serialize an event to a VEVENT.
 *
 * Pass `existing` to patch a VEVENT parsed from the server instead of building
 * a fresh one. Calino models a subset of RFC 5545, so rebuilding from scratch
 * silently destroyed everything outside that subset — GEO, CLASS, PRIORITY,
 * RDATE, RELATED-TO, X- properties, alarm bodies, attendee parameters — the
 * moment a user so much as dragged an event another client had created.
 *
 * In patch mode every property Calino owns is still written (or removed when
 * the event no longer has it), and everything else is left exactly as the
 * server sent it. The removals are unconditional rather than branched on
 * `existing` because removing from a fresh component is a no-op — one code
 * path is easier to keep correct than two.
 */
export function calendarEventToIcalComponent(
  event: CalendarEvent,
  existing?: ICAL.Component
): ICAL.Component {
  const vevent = existing ?? new ICAL.Component('vevent')

  // Snapshot the alarms *before* anything is mutated: the reconciler compares
  // against what the original actually parsed to, and DTSTART (which absolute
  // triggers are measured from) is about to be overwritten.
  const originalAlarms = existing
    ? existing.getAllSubcomponents('valarm').map((comp) => ({
        comp,
        parsed: readAlarmReminder(comp, existing.getFirstProperty('dtstart')?.getFirstValue() as
          | ICAL.Time
          | undefined),
      }))
    : []

  const now = new Date()

  vevent.updatePropertyWithValue('uid', event.uid || event.recurrenceMasterId || event.id)
  vevent.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(now, true))
  vevent.updatePropertyWithValue('sequence', event.sequence ?? 0)
  writeAuditStamps(vevent, event, now)
  if (event.eventStatus) {
    vevent.updatePropertyWithValue('status', event.eventStatus)
  } else {
    vevent.removeAllProperties('status')
  }

  if (event.isAllDay) {
    const startParts = event.start.split('T')[0].split('-')
    const startYear = parseInt(startParts[0], 10)
    const startMonth = parseInt(startParts[1], 10)
    const startDay = parseInt(startParts[2], 10)
    const startDate = createAllDayDate(startYear, startMonth, startDay)
    vevent.updatePropertyWithValue('dtstart', startDate)

    // Bug 27 fix: use date-fns addDays for proper date arithmetic.
    // The old manual rollover used new Date(y, m, 0) which gives the
    // last day of the previous month and fails at month/year boundaries.
    const endParts = event.end.split('T')[0].split('-')
    const endYear = parseInt(endParts[0], 10)
    const endMonth = parseInt(endParts[1], 10)
    const endDay = parseInt(endParts[2], 10)
    const endDateObj = addDays(new Date(endYear, endMonth - 1, endDay), 1)
    const endDate = createAllDayDate(
      endDateObj.getFullYear(),
      endDateObj.getMonth() + 1,
      endDateObj.getDate()
    )
    vevent.updatePropertyWithValue('dtend', endDate)
    // An event converted from timed to all-day must not keep the old TZID:
    // RFC 5545 §3.3.4 forbids it on a DATE value.
    vevent.getFirstProperty('dtstart')?.removeParameter('tzid')
    vevent.getFirstProperty('dtend')?.removeParameter('tzid')
  } else {
    // R2.2 — Pass event.timezone (if set) to createIcalDateTime so the
    // emitted DTSTART/DTEND carry ;TZID=... parameter and the wall-
    // clock time, not a UTC-converted instant.
    const startTime = createIcalDateTime(event.start, event.timezone)
    vevent.updatePropertyWithValue('dtstart', startTime)
    const endTime = createIcalDateTime(event.end, event.timezone)
    vevent.updatePropertyWithValue('dtend', endTime)

    for (const name of ['dtstart', 'dtend']) {
      const prop = vevent.getFirstProperty(name)
      if (!prop) continue
      // Clearing when the event has no zone matters in patch mode: a stale TZID
      // left on a now-floating value would relabel the wall clock.
      if (event.timezone) prop.setParameter('tzid', event.timezone)
      else prop.removeParameter('tzid')
    }
  }

  vevent.updatePropertyWithValue('summary', event.title)

  // Each of these is cleared when absent so that removing a description (or a
  // URL, or the last category) in Calino actually removes it from the resource
  // rather than leaving the server's previous value in place forever.
  if (event.description) {
    vevent.updatePropertyWithValue('description', event.description)
  } else {
    vevent.removeAllProperties('description')
  }

  if (event.location) {
    vevent.updatePropertyWithValue('location', event.location)
  } else {
    vevent.removeAllProperties('location')
  }

  if (event.url) {
    vevent.updatePropertyWithValue('url', event.url)
  } else {
    vevent.removeAllProperties('url')
  }

  writeCategories(vevent, event.categories ?? [])

  writeAttendees(vevent, event)

  writeRRule(vevent, event)

  if (event.recurrenceId) {
    writeDateProp(vevent, 'recurrence-id', event.recurrenceId, event.isAllDay, event.timezone)
  } else {
    vevent.removeAllProperties('recurrence-id')
  }

  writeExdates(vevent, event)

  vevent.updatePropertyWithValue(
    'transp',
    event.transparency === 'transparent' ? 'TRANSPARENT' : 'OPAQUE'
  )

  if (event.travelDuration) {
    addAppleTravelDuration(vevent, event.travelDuration)
  } else {
    vevent.removeAllProperties('x-apple-travel-duration')
  }

  reconcileAlarms(vevent, event.reminders ?? [], originalAlarms)

  // Attachments are fully modeled, so replacing the set wholesale is correct —
  // but the old properties have to go or patching would duplicate them.
  vevent.removeAllProperties('attach')
  // Serialize attachments
  if (event.attachments && event.attachments.length > 0) {
    for (const attachment of event.attachments) {
      if (attachment.href.startsWith('data:')) {
        // Inline binary: extract base64 from data URI, write per RFC 5545 §3.8.1.1
        const match = attachment.href.match(/^data:([^;]+);base64,(.+)$/)
        if (match) {
          const attachProp = new ICAL.Property('attach')
          attachProp.setParameter('value', 'BINARY')
          attachProp.setParameter('encoding', 'BASE64')
          if (attachment.contentType) {
            attachProp.setParameter('fmttype', attachment.contentType)
          }
          if (attachment.filename) {
            attachProp.setParameter('filename', attachment.filename)
          }
          attachProp.setValue(new ICAL.Binary(match[2]))
          vevent.addProperty(attachProp)
        }
      } else {
        // External URL: write as URI (default value type)
        const attachProp = new ICAL.Property('attach')
        attachProp.setValue(attachment.href)
        if (attachment.contentType) {
          attachProp.setParameter('fmttype', attachment.contentType)
        }
        if (attachment.filename) {
          attachProp.setParameter('filename', attachment.filename)
        }
        vevent.addProperty(attachProp)
      }
    }
  }

  return vevent
}

// ---------------------------------------------------------------------------
// R2.7 — Shared recurrence read/write helpers.
//
// RFC 5545 §3.6.2 lets a VTODO carry RRULE / EXDATE / RECURRENCE-ID exactly as
// a VEVENT does, so the VEVENT implementation below is the reference and both
// component types go through these helpers. Keeping two hand-written copies is
// how the all-day / TZID / UTC value-form handling drifts apart.
// ---------------------------------------------------------------------------

/** Reads RRULE, returning both the raw string (authoritative) and the parsed rule. */
function readRRule(comp: ICAL.Component): {
  rruleString: string | undefined
  recurrence: RecurrenceRule | undefined
} {
  const rruleProp = comp.getFirstProperty('rrule')
  if (!rruleProp) return { rruleString: undefined, recurrence: undefined }
  const rruleString = rruleProp.toICALString().substring(6)
  return { rruleString, recurrence: parseRRule(rruleString) }
}

/**
 * Reads every EXDATE value across every EXDATE property (a single line may
 * carry a comma-separated list).
 *
 * R2.3 — The per-EXDATE TZID is not stored; the ISO string keeps the wall-clock
 * and re-emission reconstructs the TZID form from the component's `timezone`.
 */
function readExdates(comp: ICAL.Component): string[] {
  const excludedDates: string[] = []
  for (const exdateProp of comp.getAllProperties('exdate')) {
    for (const val of exdateProp.getValues()) {
      if (val instanceof ICAL.Time) {
        excludedDates.push(icalTimeToISO(val).iso)
      }
    }
  }
  return excludedDates
}

/**
 * Reads RECURRENCE-ID. R2.3 — the wall-clock is preserved on the ISO string;
 * re-emission uses `timezone` + `isAllDay` to pick the value form back.
 *
 * `RANGE=THISANDFUTURE` (RFC 5545 §3.2.13) would make the override apply to
 * every later instance too. We do not implement that semantic, so we report it
 * rather than silently treating the override as a single instance.
 */
function readRecurrenceId(comp: ICAL.Component): {
  recurrenceId: string | undefined
  hasThisAndFuture: boolean
} {
  const recIdProp = comp.getFirstProperty('recurrence-id')
  if (!recIdProp) return { recurrenceId: undefined, hasThisAndFuture: false }
  const range = recIdProp.getParameter('range')
  const hasThisAndFuture = typeof range === 'string' && range.toUpperCase() === 'THISANDFUTURE'
  const recIdValue = recIdProp.getFirstValue()
  return {
    recurrenceId: recIdValue instanceof ICAL.Time ? icalTimeToISO(recIdValue).iso : undefined,
    hasThisAndFuture,
  }
}

/**
 * Writes a date-valued property in the correct value form.
 *
 * All three of DTSTART, DUE and RECURRENCE-ID must agree on their value type
 * (RFC 5545 §3.6.2 / §3.8.2.3), so routing them all through one helper makes
 * that structural rather than a rule three call sites have to remember.
 */
function writeDateProp(
  comp: ICAL.Component,
  name: string,
  iso: string,
  isAllDay: boolean,
  tzid?: string
): void {
  if (isAllDay) {
    const [y, m, d] = iso.split('T')[0].split('-')
    comp.updatePropertyWithValue(
      name,
      createAllDayDate(parseInt(y, 10), parseInt(m, 10), parseInt(d, 10))
    )
    return
  }
  comp.updatePropertyWithValue(name, createIcalDateTime(iso, tzid))
  if (tzid) {
    comp.getFirstProperty(name)?.setParameter('tzid', tzid)
  }
}

/**
 * The RECURRENCE-ID exactly as a builder would emit it, or '' for a master.
 *
 * The patch layer keys components on this string so an incoming override can be
 * matched to the one already in the resource. It has to go through the same
 * `writeDateProp` the builders use: a parsed/normalised value would depend on
 * the ambient zone, and then the two sides of the match would disagree
 * depending on where the app happens to be running.
 */
export function recurrenceIdICALString(event: CalendarEvent): string {
  if (!event.recurrenceId) return ''
  const scratch = new ICAL.Component('vevent')
  writeDateProp(scratch, 'recurrence-id', event.recurrenceId, event.isAllDay, event.timezone)
  return scratch.getFirstProperty('recurrence-id')?.toICALString() ?? ''
}

/** Writes RRULE, preferring the raw round-tripped string over the parsed rule. */
function writeRRule(comp: ICAL.Component, event: CalendarEvent): void {
  // Both branches below append rather than replace, so an existing RRULE has to
  // go first or patching a series would emit two of them.
  comp.removeAllProperties('rrule')
  if (event.rruleString) {
    // A legacy all-day series may carry a timed UNTIL, which §3.3.10 forbids
    // alongside a DATE-valued DTSTART — repair it on the way out rather than
    // writing back what we were given (see normaliseAllDayUntil).
    comp.addProperty(
      ICAL.Property.fromString(
        `RRULE:${normaliseAllDayUntil(event.rruleString, event.isAllDay)}`
      )
    )
  } else if (event.recurrence) {
    // R2.1 — Propagate isAllDay so buildRRuleString emits VALUE=DATE for UNTIL.
    const rruleStr = buildRRuleString({ ...event.recurrence, isAllDay: event.isAllDay })
    comp.updatePropertyWithValue('rrule', ICAL.Recur.fromString(rruleStr))
  }
}

/** Writes one EXDATE property per excluded date, matching DTSTART's value form. */
function writeExdates(comp: ICAL.Component, event: CalendarEvent): void {
  // EXDATE is written one property per date, so patching has to clear the old
  // set first — otherwise restoring a deleted occurrence could never take.
  comp.removeAllProperties('exdate')
  if (!event.excludedDates?.length) return
  for (const exDate of event.excludedDates) {
    if (event.isAllDay) {
      const [y, m, d] = exDate.split('T')[0].split('-')
      comp.addPropertyWithValue(
        'exdate',
        createAllDayDate(parseInt(y, 10), parseInt(m, 10), parseInt(d, 10))
      )
    } else if (event.timezone) {
      // R2.3 — EXDATE must use the same TZID form as DTSTART or the exception
      // will not match an occurrence.
      const exProp = comp.addPropertyWithValue('exdate', createIcalDateTime(exDate, event.timezone))
      exProp.setParameter('tzid', event.timezone)
    } else {
      comp.addPropertyWithValue('exdate', createIcalDateTime(exDate))
    }
  }
}

export function icalVtodoToCalendarEvent(vtodo: ICAL.Component, calendarId: string): CalendarEvent {
  const uidProp = vtodo.getFirstProperty('uid')
  const summaryProp = vtodo.getFirstProperty('summary')
  const descProp = vtodo.getFirstProperty('description')
  const dueProp = vtodo.getFirstProperty('due')
  const priorityProp = vtodo.getFirstProperty('priority')
  const percentProp = vtodo.getFirstProperty('percent-complete')
  const statusProp = vtodo.getFirstProperty('status')
  const seqProp = vtodo.getFirstProperty('sequence')

  let dueDate: string | undefined
  let isAllDay = true

  if (dueProp) {
    try {
      const dueRawValue = dueProp.getFirstValue()
      if (dueRawValue instanceof ICAL.Time) {
        const isoStr = icalTimeToISO(dueRawValue).iso
        if (isoStr && !isoStr.endsWith('T::')) {
          dueDate = isoStr
          isAllDay = dueRawValue.isDate
        }
      }
    } catch {
      const dueStr = dueProp.toString().replace(/^DUE[^:]*:/i, '')
      if (dueStr && /^\d{8}$/.test(dueStr.trim())) {
        const year = dueStr.substring(0, 4)
        const month = dueStr.substring(4, 6)
        const day = dueStr.substring(6, 8)
        dueDate = `${year}-${month}-${day}T00:00:00.000Z`
        isAllDay = true
      }
    }
  }

  // R2.7 — DTSTART anchors the recurrence set (RFC 5545 §3.8.2.4) and is
  // required whenever RRULE is present. It also defines the value type that
  // DUE must match (§3.8.2.3), so when both are present DTSTART wins — some
  // clients emit a date-time DTSTART alongside a date-only DUE, and trusting
  // DUE there would flip a timed task to all-day.
  let dtstartIso: string | undefined
  let timezone: string | undefined
  const dtstartProp = vtodo.getFirstProperty('dtstart')
  if (dtstartProp) {
    try {
      const dtstartValue = dtstartProp.getFirstValue()
      if (dtstartValue instanceof ICAL.Time) {
        const startResult = icalTimeToISO(dtstartValue, dtstartProp)
        if (startResult.iso && !startResult.iso.endsWith('T::')) {
          dtstartIso = startResult.iso
          // R2.2 — Capture the TZID so the wall-clock round-trips.
          if (startResult.tzid) timezone = startResult.tzid
          isAllDay = dtstartValue.isDate
        }
      }
    } catch {
      /* skip malformed DTSTART; DUE still carries the date */
    }
  }

  const { rruleString, recurrence } = readRRule(vtodo)
  const excludedDates = readExdates(vtodo)
  const { recurrenceId, hasThisAndFuture } = readRecurrenceId(vtodo)
  if (hasThisAndFuture) {
    // We apply the override to its single instance only. Saying so beats
    // silently mis-applying a range we don't implement.
    console.warn(
      'VTODO RECURRENCE-ID;RANGE=THISANDFUTURE is not supported; treating as a single instance'
    )
  }

  const locationProp = vtodo.getFirstProperty('location')
  const urlProp = vtodo.getFirstProperty('url')

  let priority: TaskPriority | undefined
  if (priorityProp) {
    const priorityValue = parseInt(priorityProp.getFirstValue() as string, 10)
    const priorityMap: Record<number, TaskPriority> = {
      1: 1,
      2: 2,
      3: 2,
      5: 2,
      6: 3,
      7: 3,
      8: 3,
      9: 3,
    }
    // RFC 5545 defines 0 as an undefined priority. Planify serializes its
    // "None" option as PRIORITY:0, while other clients omit the property.
    priority = priorityMap[priorityValue]
  }

  let percentComplete: number | undefined
  let completed = false
  if (percentProp) {
    percentComplete = parseInt(percentProp.getFirstValue() as string, 10)
    completed = percentComplete >= 100
  }

  // R2.5 — Read raw STATUS, preserving IN-PROCESS / CANCELLED / NEEDS-ACTION
  // (the old code collapsed all non-COMPLETED to `completed: false`,
  // losing the distinction). Map to UI's boolean:
  //  - COMPLETED / CANCELLED → completed = true (per product decision,
  //    CANCELLED renders as completed but flagged for deletion)
  //  - IN-PROCESS / NEEDS-ACTION → completed = false
  let taskStatus: 'NEEDS-ACTION' | 'IN-PROCESS' | 'COMPLETED' | 'CANCELLED' = 'NEEDS-ACTION'
  if (statusProp) {
    const status = statusProp.getFirstValue() as string
    if (
      status === 'IN-PROCESS' ||
      status === 'COMPLETED' ||
      status === 'CANCELLED' ||
      status === 'NEEDS-ACTION'
    ) {
      taskStatus = status
    }
    if (status === 'COMPLETED' || status === 'CANCELLED') {
      completed = true
    }
  }

  // R2.5 — Read the COMPLETED timestamp (UTC DATE-TIME per RFC 5545 §3.8.2.1).
  const completedProp = vtodo.getFirstProperty('completed')
  let completedAt: string | undefined
  if (completedProp) {
    try {
      const val = completedProp.getFirstValue()
      if (val instanceof ICAL.Time) {
        completedAt = icalTimeToISO(val).iso
      }
    } catch {
      /* skip malformed */
    }
  }

  const categories = readCategories(vtodo)

  const sequence = seqProp ? parseInt(seqProp.getFirstValue() as string, 10) : undefined

  const parentTaskId = vtodo
    .getAllProperties('related-to')
    .find((prop) => {
      const reltype = prop.getParameter('reltype')
      return (
        reltype === undefined ||
        (typeof reltype === 'string' && (!reltype.trim() || reltype.toUpperCase() === 'PARENT'))
      )
    })
    ?.getFirstValue()

  const uid = uidProp ? (uidProp.getFirstValue() as string) : uuidv4()

  // R2.7 — A master and its detached overrides legitimately share a UID
  // (RFC 5545 §3.8.4.7), and CalDAV keeps them in one resource. Deriving the
  // local id from the RECURRENCE-ID is what stops them colliding in the store
  // — before this, every VTODO in such a resource parsed to the same id.
  const id = recurrenceId ? `${uid}-${recurrenceId}` : uid

  // DTSTART is the anchor when present; otherwise a task's start collapses
  // onto its due date, which is how non-recurring tasks have always behaved.
  const start = dtstartIso || dueDate || new Date().toISOString()
  const end = dueDate || start

  return {
    id,
    uid,
    calendarId,
    title: summaryProp ? (summaryProp.getFirstValue() as string) : 'Untitled',
    description: descProp ? (descProp.getFirstValue() as string) : undefined,
    location: locationProp ? (locationProp.getFirstValue() as string) : undefined,
    url: urlProp ? (urlProp.getFirstValue() as string) : undefined,
    start,
    end,
    isAllDay,
    timezone,
    categories: categories.length > 0 ? categories : undefined,
    type: 'task',
    dueDate,
    completed,
    // R2.5 — Carry the raw status and original completion timestamp.
    taskStatus,
    completedAt,
    parentTaskId: typeof parentTaskId === 'string' ? parentTaskId : undefined,
    priority,
    percentComplete,
    sequence,
    // R2.7 — Recurrence, mirroring the VEVENT path.
    recurrence,
    rruleString,
    excludedDates: excludedDates.length > 0 ? excludedDates : undefined,
    recurrenceId,
    recurrenceMasterId: recurrenceId ? uid : undefined,
    created: readAuditStamp(vtodo, 'created'),
    lastModified: readAuditStamp(vtodo, 'last-modified'),
  }
}

/**
 * True for the RELATED-TO property `icalVtodoToCalendarEvent` reads as the
 * parent link. Only these are Calino's to rewrite — a CHILD or SIBLING
 * RELATED-TO on the same VTODO belongs to whichever client wrote it.
 */
function isParentRelatedTo(prop: ICAL.Property): boolean {
  const reltype = prop.getParameter('reltype')
  return (
    reltype === undefined ||
    (typeof reltype === 'string' && (!reltype.trim() || reltype.toUpperCase() === 'PARENT'))
  )
}

/**
 * Serialize a task to a VTODO.
 *
 * Pass `existing` to patch a VTODO from the server rather than build a fresh
 * one — see {@link calendarEventToIcalComponent} for why, and for the rule the
 * two builders share: everything `icalVtodoToCalendarEvent` reads is written or
 * removed here, and everything else is left exactly as the server sent it.
 *
 * There is no alarm reconciliation because the VTODO parser reads no VALARM, so
 * a task's alarms are entirely unmodelled and survive by being left alone.
 */
export function calendarEventToIcalVtodo(
  task: CalendarEvent,
  existing?: ICAL.Component
): ICAL.Component {
  const vtodo = existing ?? new ICAL.Component('vtodo')

  // R2.7 — A detached override carries the master's UID, so prefer the stored
  // UID over the local id (which for an override is `${uid}-${recurrenceId}`).
  // Falling back to task.id keeps tasks written before this change stable.
  const now = new Date()

  vtodo.updatePropertyWithValue('uid', task.uid || task.recurrenceMasterId || task.id)
  vtodo.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(now, true))
  vtodo.updatePropertyWithValue('sequence', task.sequence ?? 0)
  writeAuditStamps(vtodo, task, now)
  vtodo.updatePropertyWithValue('summary', task.title)

  // R2.7 — DTSTART must be present to anchor an RRULE, and DUE's value type
  // must match it (RFC 5545 §3.6.2 / §3.8.2.3). Both go through writeDateProp
  // off the same `isAllDay` flag so the two forms cannot disagree. DURATION is
  // never written — §3.6.2 forbids it alongside DUE.
  //
  // An undated task has no anchor at all: its `start` is synthesized (the
  // parser falls back to import time), so writing that as DTSTART would invent
  // a date the user never set — and would let an unanchored RRULE through.
  const hasRecurrence = Boolean(task.rruleString || task.recurrence)
  const dtstartIso = task.dueDate
    ? task.start && task.start !== task.dueDate
      ? task.start
      : task.dueDate
    : undefined
  // Emit DTSTART only when it carries information: as a recurrence anchor (RFC
  // 5545 §3.6.2 requires one), on an override so its RECURRENCE-ID has a
  // matching start, or when the task genuinely starts before it is due.
  //
  // A plain dated task gets DUE alone, as before this feature. Writing
  // DTSTART == DUE would say the task starts at the instant it is due, which
  // is both meaningless and something a strict validator can object to, and it
  // would have made every existing task emit a new property on its next save.
  const writeDtstart = Boolean(
    dtstartIso && (hasRecurrence || task.recurrenceId || dtstartIso !== task.dueDate)
  )
  if (dtstartIso && writeDtstart) {
    writeDateProp(vtodo, 'dtstart', dtstartIso, task.isAllDay, task.timezone)
  } else {
    // A task that lost its anchor must lose the property too, or the server
    // keeps answering with a start the user has deleted.
    vtodo.removeAllProperties('dtstart')
  }

  if (task.dueDate) {
    writeDateProp(vtodo, 'due', task.dueDate, task.isAllDay, task.timezone)
  } else {
    vtodo.removeAllProperties('due')
  }

  // An override describes one instance; the recurrence lives on the master.
  if (!task.recurrenceId) {
    vtodo.removeAllProperties('recurrence-id')
    // Without a DTSTART there is no anchor, so an RRULE would be meaningless.
    if (hasRecurrence && !dtstartIso) {
      console.warn('Dropping RRULE from a VTODO with no DTSTART/DUE to anchor it')
      vtodo.removeAllProperties('rrule')
      vtodo.removeAllProperties('exdate')
    } else {
      writeRRule(vtodo, task)
      writeExdates(vtodo, task)
    }
  } else {
    writeDateProp(vtodo, 'recurrence-id', task.recurrenceId, task.isAllDay, task.timezone)
    vtodo.removeAllProperties('rrule')
    vtodo.removeAllProperties('exdate')
  }

  // Cleared rather than skipped when absent, so deleting a description (or a
  // location, URL, category, priority…) in Calino actually deletes it from the
  // resource instead of leaving the server's last value in place forever.
  if (task.description) {
    vtodo.updatePropertyWithValue('description', task.description)
  } else {
    vtodo.removeAllProperties('description')
  }

  if (task.location) {
    vtodo.updatePropertyWithValue('location', task.location)
  } else {
    vtodo.removeAllProperties('location')
  }

  if (task.url) {
    vtodo.updatePropertyWithValue('url', task.url)
  } else {
    vtodo.removeAllProperties('url')
  }

  writeCategories(vtodo, task.categories ?? [])

  // RELATED-TO is written by appending, and only the PARENT-typed ones are
  // ours; drop those and re-add so a re-parent can't leave two parents behind.
  for (const prop of vtodo.getAllProperties('related-to').filter(isParentRelatedTo)) {
    vtodo.removeProperty(prop)
  }
  if (task.parentTaskId) {
    const relatedTo = vtodo.addPropertyWithValue('related-to', task.parentTaskId)
    relatedTo.setParameter('reltype', 'PARENT')
  }

  if (task.priority) {
    const priorityValue = task.priority === 1 ? 1 : task.priority === 2 ? 5 : 9
    vtodo.updatePropertyWithValue('priority', priorityValue)
  } else {
    vtodo.removeAllProperties('priority')
  }

  if (task.percentComplete !== undefined) {
    vtodo.updatePropertyWithValue('percent-complete', task.percentComplete)
  } else {
    vtodo.removeAllProperties('percent-complete')
  }

  if (task.taskStatus) {
    // R2.5 — Serialize the full status union (NEEDS-ACTION / IN-PROCESS
    // / COMPLETED / CANCELLED), not just COMPLETED / NEEDS-ACTION.
    vtodo.updatePropertyWithValue('status', task.taskStatus)
  } else if (task.completed) {
    vtodo.updatePropertyWithValue('status', 'COMPLETED')
  } else {
    vtodo.updatePropertyWithValue('status', 'NEEDS-ACTION')
  }

  if (task.completed) {
    // R2.5 — Preserve the original COMPLETED timestamp on re-serialize
    // (was always overwritten with `ICAL.Time.now()` before). The
    // COMPLETED property MUST be UTC DATE-TIME per RFC 5545 §3.8.2.1,
    // so use `fromJSDate(..., true)` (the `true` arg forces UTC `Z` form)
    // rather than `ICAL.Time.now()` which is a floating time.
    if (task.completedAt) {
      vtodo.updatePropertyWithValue(
        'completed',
        ICAL.Time.fromJSDate(new Date(task.completedAt), true)
      )
    } else {
      vtodo.updatePropertyWithValue('completed', ICAL.Time.fromJSDate(new Date(), true))
    }
  } else {
    // Reopening a task has to take its COMPLETED stamp with it — §3.8.2.1 only
    // allows the property on a task that is actually done.
    vtodo.removeAllProperties('completed')
  }

  return vtodo
}

// ── VJOURNAL ──────────────────────────────────────────────────────────────

export function icalVjournalToCalendarEvent(
  vjournal: ICAL.Component,
  calendarId: string
): CalendarEvent {
  const uidProp = vjournal.getFirstProperty('uid')
  const summaryProp = vjournal.getFirstProperty('summary')
  const descProp = vjournal.getFirstProperty('description')
  const dtstartProp = vjournal.getFirstProperty('dtstart')
  const createdProp = vjournal.getFirstProperty('created')
  const lastModProp = vjournal.getFirstProperty('last-modified')
  const seqProp = vjournal.getFirstProperty('sequence')

  // DTSTART — date only for journal entries
  let startDate = toLocalDateString(new Date())
  if (!dtstartProp) {
    console.warn('VJOURNAL missing DTSTART, defaulting to today:', uidProp?.getFirstValue())
  }
  if (dtstartProp) {
    const raw = dtstartProp.getFirstValue()
    if (raw instanceof ICAL.Time) {
      const isoStr = icalTimeToISO(raw).iso
      if (isoStr) {
        // Journal entries are date-only — strip any time component
        startDate = isoStr.includes('T') ? isoStr.split('T')[0] : isoStr
      }
    }
  }

  const categories = readCategories(vjournal)

  let created: string | undefined
  if (createdProp) {
    try {
      const val = createdProp.getFirstValue()
      if (val instanceof ICAL.Time) created = icalTimeToISO(val).iso
    } catch {
      /* skip */
    }
  }
  // Fallback: use start date for events without CREATED property
  if (!created) {
    created = new Date(startDate).toISOString()
  }

  let lastModified: string | undefined
  if (lastModProp) {
    try {
      const val = lastModProp.getFirstValue()
      if (val instanceof ICAL.Time) lastModified = icalTimeToISO(val).iso
    } catch {
      /* skip */
    }
  }
  // Fallback: use created date for events without LAST-MODIFIED property
  if (!lastModified) {
    lastModified = created
  }

  const sequence = seqProp ? parseInt(seqProp.getFirstValue() as string, 10) : undefined

  // URL
  const urlProp = vjournal.getFirstProperty('url')
  const url = urlProp ? (urlProp.getFirstValue() as string) : undefined

  // RELATED-TO (can occur multiple times)
  const relatedToProps = vjournal.getAllProperties('related-to')
  const relatedTo = relatedToProps
    .map((p) => p.getFirstValue() as string)
    .filter((v) => typeof v === 'string' && v.length > 0)

  // ATTACH (port from VEVENT logic)
  const attachments: CalendarAttachment[] = []
  const attachProps = vjournal.getAllProperties('attach')
  for (const attachProp of attachProps) {
    try {
      const attachValue = attachProp.getFirstValue()
      if (attachValue instanceof ICAL.Binary) {
        const base64Data = attachValue.decodeValue()
        const rawFmtType = attachProp.getParameter('fmttype')
        const contentType =
          (typeof rawFmtType === 'string' ? rawFmtType : undefined) || 'application/octet-stream'
        const filename = attachProp.getParameter('filename')
        attachments.push({
          href: `data:${contentType};base64,${base64Data}`,
          size: Math.round((base64Data.length * 3) / 4),
          filename: typeof filename === 'string' ? filename : 'attachment',
          contentType,
        })
      } else if (typeof attachValue === 'string') {
        if (attachValue.startsWith('data:')) {
          const match = attachValue.match(/^data:([^;]+);base64,(.+)$/)
          if (match) {
            const filename = attachProp.getParameter('filename')
            attachments.push({
              href: attachValue,
              contentType: match[1],
              size: Math.round((match[2].length * 3) / 4),
              filename: typeof filename === 'string' ? filename : 'attachment',
            })
          }
        } else {
          const fmttype = attachProp.getParameter('fmttype')
          const filename = attachProp.getParameter('filename')
          attachments.push({
            href: attachValue,
            contentType: typeof fmttype === 'string' ? fmttype : 'application/octet-stream',
            filename:
              typeof filename === 'string'
                ? filename
                : attachValue.split('/').pop() || 'attachment',
          })
        }
      }
    } catch {
      /* skip malformed attachment */
    }
  }

  return {
    id: uidProp ? (uidProp.getFirstValue() as string) : uuidv4(),
    calendarId,
    title: summaryProp ? (summaryProp.getFirstValue() as string) : '',
    description: descProp ? (descProp.getFirstValue() as string) : '',
    start: startDate,
    end: startDate,
    isAllDay: true,
    type: 'journal',
    categories: categories.length > 0 ? categories : undefined,
    created,
    lastModified,
    sequence,
    url,
    relatedTo: relatedTo.length > 0 ? relatedTo : undefined,
    attachments: attachments.length > 0 ? attachments : undefined,
  }
}

/**
 * Serialize a journal entry to a VJOURNAL.
 *
 * Pass `existing` to patch a VJOURNAL from the server; the patch rule is the
 * one {@link calendarEventToIcalComponent} documents. VJOURNAL carries no
 * VALARM in Calino's model, so there is nothing to reconcile — unmodelled
 * alarms survive by never being touched.
 */
export function calendarEventToIcalVjournal(
  entry: CalendarEvent,
  existing?: ICAL.Component
): ICAL.Component {
  const vjournal = existing ?? new ICAL.Component('vjournal')

  const now = new Date()

  vjournal.updatePropertyWithValue('uid', entry.id)
  vjournal.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(now, true))
  vjournal.updatePropertyWithValue('sequence', entry.sequence ?? 0)
  writeAuditStamps(vjournal, entry, now)

  // DTSTART — date only for journal entries
  const dateParts = entry.start.split('-')
  const dtstartDate = createAllDayDate(
    parseInt(dateParts[0], 10),
    parseInt(dateParts[1], 10),
    parseInt(dateParts[2], 10)
  )
  vjournal.updatePropertyWithValue('dtstart', dtstartDate)

  // Each of these is cleared when absent so an emptied title, body, URL,
  // category list or backlink actually leaves the resource.
  if (entry.title) {
    vjournal.updatePropertyWithValue('summary', entry.title)
  } else {
    vjournal.removeAllProperties('summary')
  }

  if (entry.description) {
    vjournal.updatePropertyWithValue('description', entry.description)
  } else {
    vjournal.removeAllProperties('description')
  }

  writeCategories(vjournal, entry.categories ?? [])

  if (entry.url) {
    vjournal.updatePropertyWithValue('url', entry.url)
  } else {
    vjournal.removeAllProperties('url')
  }

  // The journal parser reads *every* RELATED-TO regardless of RELTYPE, so
  // unlike VTODO the whole set is Calino's to replace.
  vjournal.removeAllProperties('related-to')
  if (entry.relatedTo && entry.relatedTo.length > 0) {
    for (const ref of entry.relatedTo) {
      vjournal.addPropertyWithValue('related-to', ref)
    }
  }

  // Attachments are fully modeled, so the set is replaced wholesale — but the
  // old properties have to go first or patching would duplicate them.
  vjournal.removeAllProperties('attach')
  // Serialize attachments (port from VEVENT logic)
  if (entry.attachments && entry.attachments.length > 0) {
    for (const attachment of entry.attachments) {
      if (attachment.href.startsWith('data:')) {
        const match = attachment.href.match(/^data:([^;]+);base64,(.+)$/)
        if (match) {
          const attachProp = new ICAL.Property('attach')
          attachProp.setParameter('value', 'BINARY')
          attachProp.setParameter('encoding', 'BASE64')
          if (attachment.contentType) {
            attachProp.setParameter('fmttype', attachment.contentType)
          }
          if (attachment.filename) {
            attachProp.setParameter('filename', attachment.filename)
          }
          attachProp.setValue(new ICAL.Binary(match[2]))
          vjournal.addProperty(attachProp)
        }
      } else {
        const attachProp = new ICAL.Property('attach')
        attachProp.setValue(attachment.href)
        if (attachment.contentType) {
          attachProp.setParameter('fmttype', attachment.contentType)
        }
        if (attachment.filename) {
          attachProp.setParameter('filename', attachment.filename)
        }
        vjournal.addProperty(attachProp)
      }
    }
  }

  return vjournal
}
