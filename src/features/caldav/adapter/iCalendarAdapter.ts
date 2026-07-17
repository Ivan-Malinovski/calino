import ICAL from 'ical.js'
import type { CalendarEvent } from '@/types'
import { SETTINGS_EVENT_UID_PREFIX } from '@/lib/settingsSync'
import {
  icalEventToCalendarEvent,
  icalVtodoToCalendarEvent,
  icalVjournalToCalendarEvent,
  calendarEventToIcalComponent,
  calendarEventToIcalVtodo,
  calendarEventToIcalVjournal,
} from './icalTypeMapping'

export function parseICALEvent(iCalData: string, calendarId: string): CalendarEvent[] {
  if (!iCalData || !iCalData.trim()) {
    return []
  }

  let jCal: string | unknown[]
  try {
    jCal = ICAL.parse(iCalData) as string | unknown[]
  } catch (e) {
    console.error('ICAL.parse failed:', e)
    return []
  }

  const comp = new ICAL.Component(jCal)

  const vtimezones = comp.getAllSubcomponents('vtimezone')
  for (const vtz of vtimezones) {
    try {
      const tz = new ICAL.Timezone(vtz)
      ICAL.TimezoneService.register(tz)
    } catch {
      // Fall back to UTC for unknown timezones
    }
  }

  const vevents = comp.getAllSubcomponents('vevent')
  const events: CalendarEvent[] = []

  for (const vevent of vevents) {
    try {
      const event = icalEventToCalendarEvent(vevent, calendarId)
      events.push(event)
    } catch (e) {
      console.error('Failed to parse vevent:', e)
      continue
    }
  }

  return events
}

export function parseICALTask(iCalData: string, calendarId: string): CalendarEvent[] {
  if (!iCalData || !iCalData.trim()) {
    return []
  }

  let jCal: string | unknown[]
  try {
    jCal = ICAL.parse(iCalData) as string | unknown[]
  } catch (e) {
    console.error('ICAL.parse failed for tasks:', e)
    return []
  }

  const comp = new ICAL.Component(jCal)

  const vtodos = comp.getAllSubcomponents('vtodo')
  const tasks: CalendarEvent[] = []
  for (const vtodo of vtodos) {
    try {
      tasks.push(icalVtodoToCalendarEvent(vtodo, calendarId))
    } catch (e) {
      console.error('Failed to parse vtodo:', e)
      continue
    }
  }
  return tasks
}

export function parseICALData(iCalData: string, calendarId: string): CalendarEvent[] {
  const events = parseICALEvent(iCalData, calendarId)
  const tasks = parseICALTask(iCalData, calendarId)
  const journals = parseICALJournal(iCalData, calendarId)
  // Filter out the Calino Settings sync event — it's not a real calendar event.
  // Match by prefix (R1.9) because the full UID is per-instance.
  const all = [...events, ...tasks, ...journals]
  return all.filter((e) => !e.id.startsWith(SETTINGS_EVENT_UID_PREFIX))
}

/**
 * RFC 5545 §3.1 — every physical line of an iCalendar object MUST be
 * ≤75 octets (the spec says SHOULD, but servers and other clients
 * reject content that exceeds it). ical.js v2.2.1's toString() has
 * an upstream foldline bug that sometimes emits a 76-octet line for
 * long single-line content (e.g. a 1000-char DESCRIPTION). This
 * helper re-folds any line that exceeds 75 octets. Continuation
 * lines are prefixed with a single space per §3.1.
 *
 * Octets are measured in UTF-8, but §3.1 also forbids splitting a
 * multi-octet character across a fold. We therefore walk the line by
 * Unicode code point and break to a new folded line whenever adding
 * the next character would exceed the current line's octet budget —
 * so a split never lands inside a multi-byte char (no U+FFFD
 * corruption of emoji/accented text near the boundary). A single code
 * point is at most 4 octets, well under the 74-octet continuation
 * budget, so every character always fits on a fresh line.
 */
export function foldICalLines(s: string): string {
  const lines = s.split('\r\n')
  const folded: string[] = []
  const encoder = new TextEncoder()
  for (const line of lines) {
    if (encoder.encode(line).length <= 75) {
      folded.push(line)
      continue
    }
    // First line: 75 octets of content (no leading space).
    // Continuation lines: 1 leading space + up to 74 octets of content
    // = ≤75 octets per line, per RFC 5545 §3.1.
    let current = ''
    let currentOctets = 0
    let first = true
    let budget = 75
    for (const char of line) {
      const charOctets = encoder.encode(char).length
      if (currentOctets + charOctets > budget) {
        folded.push(first ? current : ' ' + current)
        first = false
        budget = 74
        current = ''
        currentOctets = 0
      }
      current += char
      currentOctets += charOctets
    }
    folded.push(first ? current : ' ' + current)
  }
  return folded.join('\r\n')
}

export function eventToICAL(event: CalendarEvent): string {
  return eventsToICAL([event])
}

export function eventsToICAL(events: CalendarEvent[]): string {
  const comp = new ICAL.Component('vcalendar')
  comp.updatePropertyWithValue('version', '2.0')
  comp.updatePropertyWithValue('prodid', '-//Calino//EN')
  comp.updatePropertyWithValue('calscale', 'GREGORIAN')

  for (const event of events) {
    comp.addSubcomponent(
      event.type === 'task'
        ? calendarEventToIcalVtodo(event)
        : event.type === 'journal'
          ? calendarEventToIcalVjournal(event)
          : calendarEventToIcalComponent(event)
    )
  }

  return foldICalLines(comp.toString())
}

export function taskToICAL(task: CalendarEvent): string {
  const comp = new ICAL.Component('vcalendar')
  comp.updatePropertyWithValue('version', '2.0')
  comp.updatePropertyWithValue('prodid', '-//Calino//EN')
  comp.updatePropertyWithValue('calscale', 'GREGORIAN')

  const vtodo = calendarEventToIcalVtodo(task)
  comp.addSubcomponent(vtodo)

  return foldICalLines(comp.toString())
}

export function parseICALJournal(iCalData: string, calendarId: string): CalendarEvent[] {
  if (!iCalData || !iCalData.trim()) {
    return []
  }

  let jCal: string | unknown[]
  try {
    jCal = ICAL.parse(iCalData) as string | unknown[]
  } catch (e) {
    console.error('ICAL.parse failed for journals:', e)
    return []
  }

  const comp = new ICAL.Component(jCal)

  const vjournals = comp.getAllSubcomponents('vjournal')
  const entries: CalendarEvent[] = []
  for (const vjournal of vjournals) {
    try {
      entries.push(icalVjournalToCalendarEvent(vjournal, calendarId))
    } catch (e) {
      console.error('Failed to parse vjournal:', e)
      continue
    }
  }
  return entries
}

export function journalToICAL(entry: CalendarEvent): string {
  const comp = new ICAL.Component('vcalendar')
  comp.updatePropertyWithValue('version', '2.0')
  comp.updatePropertyWithValue('prodid', '-//Calino//EN')
  comp.updatePropertyWithValue('calscale', 'GREGORIAN')

  const vjournal = calendarEventToIcalVjournal(entry)
  comp.addSubcomponent(vjournal)

  return foldICalLines(comp.toString())
}
