import ICAL from 'ical.js'
import { v4 as uuidv4 } from 'uuid'
import type { CalendarEvent, CalendarAttachment, RecurrenceRule, Reminder, TaskPriority } from '@/types'
import { addDays } from 'date-fns'
import { buildRRuleString } from '@/lib/recurrence'

export function parseAppleTravelDuration(vevent: ICAL.Component): number | undefined {
  const prop = vevent.getFirstProperty('x-apple-travel-duration')
  if (prop) {
    const value = prop.getFirstValue() as string
    return parseTravelDuration(value) ?? undefined
  }
  return undefined
}

export function addAppleTravelDuration(vevent: ICAL.Component, minutes: number): void {
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

  const totalMinutes = (weeks * 7 * 24 * 60) + (days * 24 * 60) + (hours * 60) + minutes + Math.ceil(seconds / 60)
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
        const days = value.split(',').map((d) => parseInt(d.trim(), 10)).filter((n) => !isNaN(n))
        if (days.length > 0) byMonthDay = days
        break
      }
      case 'BYMONTH': {
        const months = value.split(',').map((m) => parseInt(m.trim(), 10)).filter((n) => !isNaN(n))
        if (months.length > 0) byMonth = months
        break
      }
      case 'BYSETPOS': {
        // Standalone BYSETPOS is a distinct rule part from per-BYDAY
        // ordinals. The two do NOT share storage after R2.4.
        const positions = value.split(',').map((p) => parseInt(p.trim(), 10)).filter((n) => !isNaN(n))
        if (positions.length > 0) bySetPos = positions
        break
      }
      // R2.4 — Missing RRULE parts per RFC 5545 §3.3.10.
      case 'WKST': {
        if (
          value === 'MO' || value === 'TU' || value === 'WE' || value === 'TH' ||
          value === 'FR' || value === 'SA' || value === 'SU'
        ) {
          wkst = value
        }
        break
      }
      case 'BYHOUR': {
        const hours = value.split(',').map((h) => parseInt(h.trim(), 10)).filter((n) => !isNaN(n))
        if (hours.length > 0) byHour = hours
        break
      }
      case 'BYMINUTE': {
        const minutes = value.split(',').map((m) => parseInt(m.trim(), 10)).filter((n) => !isNaN(n))
        if (minutes.length > 0) byMinute = minutes
        break
      }
      case 'BYSECOND': {
        const seconds = value.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n))
        if (seconds.length > 0) bySecond = seconds
        break
      }
      case 'BYWEEKNO': {
        const weeks = value.split(',').map((w) => parseInt(w.trim(), 10)).filter((n) => !isNaN(n))
        if (weeks.length > 0) byWeekNo = weeks
        break
      }
      case 'BYYEARDAY': {
        const days = value.split(',').map((d) => parseInt(d.trim(), 10)).filter((n) => !isNaN(n))
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
        ICAL.Timezone.utcTimezone,
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

  let recurrence: RecurrenceRule | undefined
  let rruleString: string | undefined

  const rruleProp = vevent.getFirstProperty('rrule')
  if (rruleProp) {
    rruleString = rruleProp.toICALString().substring(6)
    recurrence = parseRRule(rruleString)
  }

  const excludedDates: string[] = []
  const exdateProps = vevent.getAllProperties('exdate')
  for (const exdateProp of exdateProps) {
    const values = exdateProp.getValues()
    for (const val of values) {
      if (val instanceof ICAL.Time) {
        // R2.3 — For TZID preservation we'd need to store the TZID
        // per-exdate. For now we keep the ISO string (which is wall-
        // clock if the original had TZID). Re-emission uses the master
        // event's `event.timezone` to reconstruct the TZID form.
        excludedDates.push(icalTimeToISO(val).iso)
      }
    }
  }

  const reminders: Reminder[] = []
  const valarms = vevent.getAllSubcomponents('valarm')
  for (const valarm of valarms) {
    const triggerProp = valarm.getFirstProperty('trigger')
    if (triggerProp) {
      const triggerValue = triggerProp.getFirstValue()
      let minutes: number | null = null

      if (typeof triggerValue === 'string') {
        minutes = parseTriggerDuration(triggerValue)
      } else if (triggerValue instanceof ICAL.Duration) {
        // Duration triggers (e.g. -PT30M, +P2D) are parsed by ical.js as
        // ICAL.Duration. The sign of the duration tells us pre/post:
        // negative is "before", positive is "after" (per RFC 5545
        // §3.8.6.3). R2.6 — for post-event reminders (positive), we
        // emit `Math.abs` so the value is non-negative; the UI doesn't
        // currently distinguish but the option is there.
        const totalSeconds = triggerValue.toSeconds()
        minutes = Math.round(Math.abs(totalSeconds) / 60)
      } else if (triggerValue instanceof ICAL.Time) {
        // Bug 26 fix: calculate minutes from event DTSTART, not Date.now()
        const isoStr = icalTimeToISO(triggerValue).iso
        if (isoStr && dtstart) {
          const triggerDate = new Date(isoStr)
          const startDate = new Date(icalTimeToISO(dtstart).iso)
          if (!isNaN(triggerDate.getTime()) && !isNaN(startDate.getTime())) {
            const diffMs = startDate.getTime() - triggerDate.getTime()
            minutes = Math.round(diffMs / 60000)
            if (minutes < 0) minutes = Math.abs(minutes)
          }
        }
      }

      if (minutes !== null && minutes > 0) {
        // R2.6 — Read the VALARM ACTION property (DISPLAY/EMAIL/AUDIO)
        // and map to the Reminder.method union. Default to 'popup' for
        // compatibility with existing reminders and for any non-recognised
        // ACTION values (x-name / iana-token) which we still want to
        // preserve as DISPLAY-ish.
        let method: 'popup' | 'email' | 'audio' = 'popup'
        const actionProp = valarm.getFirstProperty('action')
        if (actionProp) {
          const actionValue = actionProp.getFirstValue() as string
          if (actionValue === 'EMAIL') method = 'email'
          else if (actionValue === 'AUDIO') method = 'audio'
          // else: 'DISPLAY' or anything else → 'popup' (default)
        }
        reminders.push({
          id: uuidv4(),
          minutesBefore: minutes,
          method,
        })
      }
    }
  }

  const travelDuration = parseAppleTravelDuration(vevent)

  const transpProp = vevent.getFirstProperty('transp')
  let transparency: 'transparent' | 'opaque' = 'opaque'
  if (transpProp) {
    const transpValue = transpProp.getFirstValue() as string
    transparency = transpValue === 'TRANSPARENT' ? 'transparent' : 'opaque'
  }

  let recurrenceId: string | undefined
  const recIdProp = vevent.getFirstProperty('recurrence-id')
  if (recIdProp) {
    const recIdValue = recIdProp.getFirstValue()
    if (recIdValue instanceof ICAL.Time) {
      // R2.3 — RECURRENCE-ID's wall-clock is preserved on the iso
      // string; re-emission uses event.timezone + event.isAllDay.
      recurrenceId = icalTimeToISO(recIdValue).iso
    }
  }

  const categories: string[] = []
  const catProp = vevent.getFirstProperty('categories')
  if (catProp) {
    const catValue = catProp.getFirstValue()
    if (typeof catValue === 'string') {
      categories.push(...catValue.split(',').map((c) => c.trim()))
    }
  }

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
      const contentType = (typeof rawFmtType === 'string' ? rawFmtType : undefined) || 'application/octet-stream'
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
          filename: typeof filename === 'string' ? filename : attachValue.split('/').pop() || 'attachment',
        })
      }
    }
  }

  return {
    id: event.uid || uuidv4(),
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
    recurrence,
    reminders: reminders.length > 0 ? reminders : undefined,
    rruleString,
    travelDuration,
    transparency,
    sequence,
    excludedDates: excludedDates.length > 0 ? excludedDates : undefined,
    recurrenceId,
    attachments: attachments.length > 0 ? attachments : undefined,
  }
}

function parseTriggerDuration(trigger: string): number | null {
  if (trigger.startsWith('-PT')) {
    const duration = trigger.substring(3)
    let minutes = 0

    const hourMatch = duration.match(/(\d+)H/)
    const minMatch = duration.match(/(\d+)M/)
    const secMatch = duration.match(/(\d+)S/)

    if (hourMatch) {
      minutes += parseInt(hourMatch[1], 10) * 60
    }
    if (minMatch) {
      minutes += parseInt(minMatch[1], 10)
    }
    if (secMatch) {
      minutes += Math.ceil(parseInt(secMatch[1], 10) / 60)
    }

    return minutes > 0 ? minutes : null
  }

  if (trigger.startsWith('PT')) {
    const duration = trigger.substring(2)
    let minutes = 0

    const hourMatch = duration.match(/(\d+)H/)
    const minMatch = duration.match(/(\d+)M/)
    const secMatch = duration.match(/(\d+)S/)

    if (hourMatch) {
      minutes += parseInt(hourMatch[1], 10) * 60
    }
    if (minMatch) {
      minutes += parseInt(minMatch[1], 10)
    }
    if (secMatch) {
      minutes += Math.ceil(parseInt(secMatch[1], 10) / 60)
    }

    return minutes > 0 ? minutes : null
  }

  return null
}

function createAllDayDate(year: number, month: number, day: number): ICAL.Time {
  const time = new ICAL.Time({
    year,
    month,
    day,
    hour: 0,
    minute: 0,
    second: 0,
    isDate: true,
    timezone: 'UTC'
  }, ICAL.Timezone.utcTimezone)
  return time
}

export function calendarEventToIcalComponent(event: CalendarEvent): ICAL.Component {
  const vevent = new ICAL.Component('vevent')

  vevent.updatePropertyWithValue('uid', event.id)
  vevent.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true))
  vevent.updatePropertyWithValue('sequence', event.sequence ?? 0)

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
  } else {
    // R2.2 — Pass event.timezone (if set) to createIcalDateTime so the
    // emitted DTSTART/DTEND carry ;TZID=... parameter and the wall-
    // clock time, not a UTC-converted instant.
    const startTime = createIcalDateTime(event.start, event.timezone)
    vevent.updatePropertyWithValue('dtstart', startTime)
    if (event.timezone) {
      vevent.getFirstProperty('dtstart')?.setParameter('tzid', event.timezone)
    }

    const endTime = createIcalDateTime(event.end, event.timezone)
    vevent.updatePropertyWithValue('dtend', endTime)
    if (event.timezone) {
      vevent.getFirstProperty('dtend')?.setParameter('tzid', event.timezone)
    }
  }

  vevent.updatePropertyWithValue('summary', event.title)

  if (event.description) {
    vevent.updatePropertyWithValue('description', event.description)
  }

  if (event.location) {
    vevent.updatePropertyWithValue('location', event.location)
  }

  if (event.categories && event.categories.length > 0) {
    vevent.updatePropertyWithValue('categories', event.categories.join(','))
  }

  if (event.rruleString) {
    const rruleProp = ICAL.Property.fromString(`RRULE:${event.rruleString}`)
    vevent.addProperty(rruleProp)
  } else if (event.recurrence) {
    // R2.1 — Propagate the event's isAllDay flag to the recurrence so
    // buildRRuleString can emit VALUE=DATE for UNTIL on all-day events.
    const rruleStr = buildRRuleString({ ...event.recurrence, isAllDay: event.isAllDay })
    vevent.updatePropertyWithValue('rrule', ICAL.Recur.fromString(rruleStr))
  }

  if (event.recurrenceId) {
    if (event.isAllDay) {
      const recIdParts = event.recurrenceId.split('T')[0].split('-')
      const recId = createAllDayDate(
        parseInt(recIdParts[0], 10),
        parseInt(recIdParts[1], 10),
        parseInt(recIdParts[2], 10)
      )
      vevent.updatePropertyWithValue('recurrence-id', recId)
      // R2.3 — All-day RECURRENCE-ID needs VALUE=DATE; ical.js omits
      // the parameter when the time has isDate: true, but be explicit
      // to match what icalTypeMapping.ts writes for DTSTART.
    } else if (event.timezone) {
      // R2.3 — RECURRENCE-ID with TZID: reconstruct wall-clock with
      // the same zone as the master event's DTSTART.
      const recIdTime = createIcalDateTime(event.recurrenceId, event.timezone)
      vevent.updatePropertyWithValue('recurrence-id', recIdTime)
      vevent.getFirstProperty('recurrence-id')?.setParameter('tzid', event.timezone)
    } else {
      const recId = createIcalDateTime(event.recurrenceId)
      vevent.updatePropertyWithValue('recurrence-id', recId)
    }
  }

  if (event.excludedDates && event.excludedDates.length > 0) {
    for (const exDate of event.excludedDates) {
      if (event.isAllDay) {
        const exParts = exDate.split('T')[0].split('-')
        const exIcalDate = createAllDayDate(
          parseInt(exParts[0], 10),
          parseInt(exParts[1], 10),
          parseInt(exParts[2], 10)
        )
        vevent.addPropertyWithValue('exdate', exIcalDate)
      } else if (event.timezone) {
        // R2.3 — EXDATE with TZID: emit the same TZID form as DTSTART
        // so the exception is matched against the master event.
        const exIcalTime = createIcalDateTime(exDate, event.timezone)
        const exProp = vevent.addPropertyWithValue('exdate', exIcalTime)
        exProp.setParameter('tzid', event.timezone)
      } else {
        const exIcalTime = createIcalDateTime(exDate)
        vevent.addPropertyWithValue('exdate', exIcalTime)
      }
    }
  }

  vevent.updatePropertyWithValue('transp', event.transparency === 'transparent' ? 'TRANSPARENT' : 'OPAQUE')

  if (event.travelDuration) {
    addAppleTravelDuration(vevent, event.travelDuration)
  }

  if (event.reminders && event.reminders.length > 0) {
    for (const reminder of event.reminders) {
      const valarm = new ICAL.Component('valarm')
      // R2.6 — Map the Reminder.method back to the iCal ACTION token
      // and use the longest-fit trigger form (D > H > M) per RFC 5545
      // §3.3.6. Always emit a negative (pre-event) trigger; the UI
      // doesn't currently distinguish post-event reminders, and
      // emitting `+PT...` would require a Reminder field refactor.
      const action = reminder.method === 'email' ? 'EMAIL'
        : reminder.method === 'audio' ? 'AUDIO'
        : 'DISPLAY'
      valarm.updatePropertyWithValue('action', action)
      valarm.updatePropertyWithValue('trigger', formatReminderTrigger(reminder.minutesBefore))
      vevent.addSubcomponent(valarm)
    }
  }

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

export function icalVtodoToCalendarEvent(vtodo: ICAL.Component, calendarId: string): CalendarEvent {
  const uidProp = vtodo.getFirstProperty('uid')
  const summaryProp = vtodo.getFirstProperty('summary')
  const descProp = vtodo.getFirstProperty('description')
  const dueProp = vtodo.getFirstProperty('due')
  const priorityProp = vtodo.getFirstProperty('priority')
  const percentProp = vtodo.getFirstProperty('percent-complete')
  const statusProp = vtodo.getFirstProperty('status')
  const seqProp = vtodo.getFirstProperty('sequence')
  const catProp = vtodo.getFirstProperty('categories')

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
    if (status === 'IN-PROCESS' || status === 'COMPLETED' ||
        status === 'CANCELLED' || status === 'NEEDS-ACTION') {
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
    } catch { /* skip malformed */ }
  }

  const categories: string[] = []
  if (catProp) {
    const catValue = catProp.getFirstValue()
    if (typeof catValue === 'string') {
      categories.push(...catValue.split(',').map((c) => c.trim()))
    }
  }

  const sequence = seqProp ? parseInt(seqProp.getFirstValue() as string, 10) : undefined

  const parentTaskId = vtodo
    .getAllProperties('related-to')
    .find((prop) => {
      const reltype = prop.getParameter('reltype')
      return reltype === undefined || (typeof reltype === 'string' && (!reltype.trim() || reltype.toUpperCase() === 'PARENT'))
    })
    ?.getFirstValue()

  return {
    id: uidProp ? (uidProp.getFirstValue() as string) : uuidv4(),
    calendarId,
    title: summaryProp ? (summaryProp.getFirstValue() as string) : 'Untitled',
    description: descProp ? (descProp.getFirstValue() as string) : undefined,
    start: dueDate || new Date().toISOString(),
    end: dueDate || new Date().toISOString(),
    isAllDay,
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
  }
}

export function calendarEventToIcalVtodo(task: CalendarEvent): ICAL.Component {
  const vtodo = new ICAL.Component('vtodo')

  vtodo.updatePropertyWithValue('uid', task.id)
  vtodo.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true))
  vtodo.updatePropertyWithValue('sequence', task.sequence ?? 0)
  vtodo.updatePropertyWithValue('summary', task.title)

  if (task.dueDate) {
    if (task.isAllDay) {
      const dueParts = task.dueDate.split('T')[0].split('-')
      const dueDate = createAllDayDate(
        parseInt(dueParts[0], 10),
        parseInt(dueParts[1], 10),
        parseInt(dueParts[2], 10)
      )
      vtodo.updatePropertyWithValue('due', dueDate)
    } else {
      const dueTime = ICAL.Time.fromJSDate(new Date(task.dueDate))
      vtodo.updatePropertyWithValue('due', dueTime)
    }
  }

  if (task.description) {
    vtodo.updatePropertyWithValue('description', task.description)
  }

  if (task.categories && task.categories.length > 0) {
    vtodo.updatePropertyWithValue('categories', task.categories.join(','))
  }

  if (task.parentTaskId) {
    const relatedTo = vtodo.addPropertyWithValue('related-to', task.parentTaskId)
    relatedTo.setParameter('reltype', 'PARENT')
  }

  if (task.priority) {
    const priorityValue = task.priority === 1 ? 1 : task.priority === 2 ? 5 : 9
    vtodo.updatePropertyWithValue('priority', priorityValue)
  }

  if (task.percentComplete !== undefined) {
    vtodo.updatePropertyWithValue('percent-complete', task.percentComplete)
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
      vtodo.updatePropertyWithValue('completed', ICAL.Time.fromJSDate(new Date(task.completedAt), true))
    } else {
      vtodo.updatePropertyWithValue('completed', ICAL.Time.fromJSDate(new Date(), true))
    }
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
  const catProp = vjournal.getFirstProperty('categories')

  // DTSTART — date only for journal entries
  let startDate = new Date().toISOString().split('T')[0]
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

  const categories: string[] = []
  if (catProp) {
    const catValue = catProp.getFirstValue()
    if (typeof catValue === 'string') {
      categories.push(...catValue.split(',').map((c) => c.trim()))
    }
  }

  let created: string | undefined
  if (createdProp) {
    try {
      const val = createdProp.getFirstValue()
      if (val instanceof ICAL.Time) created = icalTimeToISO(val).iso
    } catch { /* skip */ }
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
    } catch { /* skip */ }
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
    .map(p => p.getFirstValue() as string)
    .filter(v => typeof v === 'string' && v.length > 0)

  // ATTACH (port from VEVENT logic)
  const attachments: CalendarAttachment[] = []
  const attachProps = vjournal.getAllProperties('attach')
  for (const attachProp of attachProps) {
    try {
      const attachValue = attachProp.getFirstValue()
      if (attachValue instanceof ICAL.Binary) {
        const base64Data = attachValue.decodeValue()
        const rawFmtType = attachProp.getParameter('fmttype')
        const contentType = (typeof rawFmtType === 'string' ? rawFmtType : undefined) || 'application/octet-stream'
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
            filename: typeof filename === 'string' ? filename : attachValue.split('/').pop() || 'attachment',
          })
        }
      }
    } catch { /* skip malformed attachment */ }
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

export function calendarEventToIcalVjournal(entry: CalendarEvent): ICAL.Component {
  const vjournal = new ICAL.Component('vjournal')

  vjournal.updatePropertyWithValue('uid', entry.id)
  vjournal.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true))
  vjournal.updatePropertyWithValue('sequence', entry.sequence ?? 0)

  // DTSTART — date only for journal entries
  const dateParts = entry.start.split('-')
  const dtstartDate = createAllDayDate(
    parseInt(dateParts[0], 10),
    parseInt(dateParts[1], 10),
    parseInt(dateParts[2], 10)
  )
  vjournal.updatePropertyWithValue('dtstart', dtstartDate)

  if (entry.title) {
    vjournal.updatePropertyWithValue('summary', entry.title)
  }

  if (entry.description) {
    vjournal.updatePropertyWithValue('description', entry.description)
  }

  if (entry.categories && entry.categories.length > 0) {
    vjournal.updatePropertyWithValue('categories', entry.categories.join(','))
  }

  if (entry.created) {
    try {
      vjournal.updatePropertyWithValue('created', ICAL.Time.fromJSDate(new Date(entry.created)))
    } catch { /* skip */ }
  }

  if (entry.lastModified) {
    try {
      vjournal.updatePropertyWithValue('last-modified', ICAL.Time.fromJSDate(new Date(entry.lastModified)))
    } catch { /* skip */ }
  }

  if (entry.url) {
    vjournal.updatePropertyWithValue('url', entry.url)
  }

  if (entry.relatedTo && entry.relatedTo.length > 0) {
    for (const ref of entry.relatedTo) {
      vjournal.addPropertyWithValue('related-to', ref)
    }
  }

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
