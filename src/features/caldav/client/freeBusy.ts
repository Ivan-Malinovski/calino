import ICAL from 'ical.js'
import type { FreeBusyPeriod, FreeBusyType } from '@/lib/freeBusyCalculator'

const FBTYPES: FreeBusyType[] = ['BUSY', 'BUSY-UNAVAILABLE', 'BUSY-TENTATIVE', 'FREE']

/**
 * Parse the FREEBUSY properties out of a `text/calendar` VFREEBUSY document.
 *
 * Both RFC 5545 §3.3.9 period forms are handled — `start/end` and
 * `start/duration` — and a property with no FBTYPE parameter is BUSY, which is
 * the spec default and the form most servers actually send.
 *
 * Returns an empty array for anything unparseable: a malformed server reply
 * means "we learned nothing", never an exception into the UI.
 */
export function parseVFreeBusy(icsText: string): FreeBusyPeriod[] {
  if (!icsText || !icsText.trim()) return []

  let root: ICAL.Component
  try {
    root = new ICAL.Component(ICAL.parse(icsText) as unknown as never)
  } catch {
    return []
  }

  const components =
    root.name === 'vfreebusy' ? [root] : root.getAllSubcomponents('vfreebusy')

  const periods: FreeBusyPeriod[] = []

  for (const vfreebusy of components) {
    for (const prop of vfreebusy.getAllProperties('freebusy')) {
      const rawType = prop.getParameter('fbtype')
      const type =
        (typeof rawType === 'string' &&
          FBTYPES.find((t) => t === rawType.toUpperCase())) ||
        'BUSY'

      for (const value of prop.getValues()) {
        const period = toPeriod(value)
        if (period) periods.push({ ...period, type })
      }
    }
  }

  return periods
}

function toPeriod(value: unknown): { start: Date; end: Date } | null {
  try {
    let period: ICAL.Period | null = null

    if (value instanceof ICAL.Period) {
      period = value
    } else if (typeof value === 'string') {
      period = ICAL.Period.fromString(value, null as never)
    }
    if (!period) return null

    const start = period.start?.toJSDate()
    const end = period.getEnd?.()?.toJSDate()
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return null
    }
    return { start, end }
  } catch {
    return null
  }
}

/** UTC basic-format stamp, the only DTSTART form a free/busy range may use. */
export function toIcalUtcStamp(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`
}

/** RFC 4791 §7.10 — REPORT body asking a collection when *we* are busy. */
export function buildFreeBusyQueryXml(start: Date, end: Date): string {
  return `<?xml version="1.0" encoding="utf-8" ?>
<C:free-busy-query xmlns:C="urn:ietf:params:xml:ns:caldav">
  <C:time-range start="${toIcalUtcStamp(start)}" end="${toIcalUtcStamp(end)}"/>
</C:free-busy-query>`
}

/** RFC 6638 §4.1 — VFREEBUSY METHOD:REQUEST posted to a scheduling Outbox. */
export function buildFreeBusyRequestIcs(
  organizerEmail: string,
  attendeeEmails: string[],
  start: Date,
  end: Date
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Calino//Calendar//EN',
    'METHOD:REQUEST',
    'BEGIN:VFREEBUSY',
    `UID:${crypto.randomUUID()}`,
    `DTSTAMP:${toIcalUtcStamp(new Date())}`,
    `DTSTART:${toIcalUtcStamp(start)}`,
    `DTEND:${toIcalUtcStamp(end)}`,
    `ORGANIZER:mailto:${organizerEmail}`,
    ...attendeeEmails.map((email) => `ATTENDEE:mailto:${email}`),
    'END:VFREEBUSY',
    'END:VCALENDAR',
  ]
  return lines.join('\r\n')
}

export interface ScheduleResponse {
  recipient: string
  /** null when the server declined to answer for this recipient. */
  periods: FreeBusyPeriod[] | null
}

/**
 * Parse the `<C:schedule-response>` multistatus an Outbox POST returns.
 *
 * Per RFC 6638 §3.2.9 a request-status of `2.0` is a real answer; `3.7`
 * (invalid calendar user) and any `5.x` mean the server couldn't tell us, and
 * those map to `null` — "unknown" — rather than to "free".
 */
export function parseScheduleResponse(xml: string): ScheduleResponse[] {
  if (!xml || !xml.trim()) return []

  let doc: Document
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml')
  } catch {
    return []
  }
  if (doc.getElementsByTagName('parsererror').length > 0) return []

  const results: ScheduleResponse[] = []
  const responses = Array.from(doc.getElementsByTagNameNS('*', 'response'))

  for (const response of responses) {
    const recipientEl = response.getElementsByTagNameNS('*', 'recipient')[0]
    const href = recipientEl?.getElementsByTagNameNS('*', 'href')[0]?.textContent?.trim()
    if (!href) continue
    const recipient = href.replace(/^mailto:/i, '')

    const status =
      response
        .getElementsByTagNameNS('*', 'request-status')[0]
        ?.textContent?.trim()
        .split(';')[0]
        ?.trim() ?? ''

    if (!status.startsWith('2.')) {
      results.push({ recipient, periods: null })
      continue
    }

    const data = response.getElementsByTagNameNS('*', 'calendar-data')[0]?.textContent
    results.push({ recipient, periods: data ? parseVFreeBusy(data) : null })
  }

  return results
}
