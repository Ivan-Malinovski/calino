import ICAL from 'ical.js'
import { ensureZoneRegistered, preloadTimezones } from '@/lib/timezoneRegistry'
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

/**
 * Normalizes raw .ics text before handing it to `ICAL.parse`.
 *
 * - Strips a leading UTF-8 BOM (U+FEFF). Some exporters (notably some
 *   Windows/Outlook flows) prepend one; ical.js's line parser treats it as
 *   part of the first content line, which corrupts the `BEGIN:VCALENDAR`
 *   match and silently yields zero parsed items rather than an error.
 * - Normalizes all line endings to CRLF, since RFC 5545 §3.1 mandates CRLF
 *   and some files arrive with bare LF or a mix of both.
 */
export function normalizeICalText(iCalData: string): string {
  return iCalData.replace(/^\uFEFF/, '').replace(/\r\n|\r|\n/g, '\r\n')
}

/**
 * Parses raw .ics text into one or more top-level `ICAL.Component` documents.
 *
 * `ICAL.parse` returns a single jCal document (`[name, props, comps]`) for
 * ordinary input, but when the text contains multiple concatenated
 * `BEGIN:VCALENDAR…END:VCALENDAR` blocks (some exporters and mail clients
 * produce these), it returns an ARRAY of jCal documents instead — the
 * top-level `root.length == 1 ? root[0] : root` branch in ical.js. Passing
 * that array straight to `new ICAL.Component()` misinterprets it as a single
 * malformed document. Detect the shape and build one `Component` per
 * document instead.
 */
function parseICalComponents(iCalData: string): ICAL.Component[] {
  const jCal = ICAL.parse(normalizeICalText(iCalData)) as unknown

  // A single jCal document is `[name: string, props: [], comps: []]` — its
  // first element is a string. An array-of-documents has jCal documents (each
  // themselves arrays) as its elements, so the first element is not a string.
  const isMultiDocument = Array.isArray(jCal) && jCal.length > 0 && !(typeof jCal[0] === 'string')

  const documents = isMultiDocument ? (jCal as unknown[]) : [jCal]
  return documents.map((doc) => new ICAL.Component(doc as string | unknown[]))
}

function registerTimezones(comp: ICAL.Component): void {
  const vtimezones = comp.getAllSubcomponents('vtimezone')
  for (const vtz of vtimezones) {
    try {
      const tz = new ICAL.Timezone(vtz)
      ICAL.TimezoneService.register(tz)
    } catch {
      // Fall back to UTC for unknown timezones
    }
  }
}

function parseComponentsForData(iCalData: string): ICAL.Component[] {
  if (!iCalData || !iCalData.trim()) return []
  return parseICalComponents(iCalData)
}

function collectReferencedTimezones(comp: ICAL.Component, timezoneIds: Set<string>): void {
  // The TZID property belonging to a VTIMEZONE is a definition, not a request
  // for package data. Registering those definitions before preloading keeps a
  // server-provided VTIMEZONE authoritative.
  if (comp.name !== 'vtimezone') {
    for (const prop of comp.getAllProperties()) {
      const tzid = prop.getParameter('tzid')
      if (typeof tzid === 'string' && tzid.trim()) timezoneIds.add(tzid.trim())
    }
  }
  for (const child of comp.getAllSubcomponents()) {
    collectReferencedTimezones(child, timezoneIds)
  }
}

function prepareComponentsForAsyncParsing(comps: ICAL.Component[]): Set<string> {
  const timezoneIds = new Set<string>()
  for (const comp of comps) {
    registerTimezones(comp)
    collectReferencedTimezones(comp, timezoneIds)
  }
  return timezoneIds
}

type ComponentKind = 'event' | 'task' | 'journal'

function parseEventsFromComponents(
  comps: ICAL.Component[],
  calendarId: string,
  only?: ComponentKind
): { events: CalendarEvent[]; tasks: CalendarEvent[]; journals: CalendarEvent[] } {
  const events: CalendarEvent[] = []
  const tasks: CalendarEvent[] = []
  const journals: CalendarEvent[] = []

  for (const comp of comps) {
    registerTimezones(comp)

    if (!only || only === 'event')
      for (const vevent of comp.getAllSubcomponents('vevent')) {
        try {
          events.push(icalEventToCalendarEvent(vevent, calendarId))
        } catch (e) {
          console.error('Failed to parse vevent:', e)
        }
      }

    if (!only || only === 'task')
      for (const vtodo of comp.getAllSubcomponents('vtodo')) {
        try {
          tasks.push(icalVtodoToCalendarEvent(vtodo, calendarId))
        } catch (e) {
          console.error('Failed to parse vtodo:', e)
        }
      }

    if (!only || only === 'journal')
      for (const vjournal of comp.getAllSubcomponents('vjournal')) {
        try {
          journals.push(icalVjournalToCalendarEvent(vjournal, calendarId))
        } catch (e) {
          console.error('Failed to parse vjournal:', e)
        }
      }
  }

  return { events, tasks, journals }
}

export function parseICALEvent(iCalData: string, calendarId: string): CalendarEvent[] {
  if (!iCalData || !iCalData.trim()) {
    return []
  }

  let comps: ICAL.Component[]
  try {
    comps = parseComponentsForData(iCalData)
  } catch (e) {
    console.error('ICAL.parse failed:', e)
    return []
  }

  return parseEventsFromComponents(comps, calendarId, 'event').events
}

export function parseICALTask(iCalData: string, calendarId: string): CalendarEvent[] {
  if (!iCalData || !iCalData.trim()) {
    return []
  }

  let comps: ICAL.Component[]
  try {
    comps = parseComponentsForData(iCalData)
  } catch (e) {
    console.error('ICAL.parse failed for tasks:', e)
    return []
  }

  return parseEventsFromComponents(comps, calendarId, 'task').tasks
}

export function parseICALData(iCalData: string, calendarId: string): CalendarEvent[] {
  if (!iCalData || !iCalData.trim()) return []

  let parsed: ReturnType<typeof parseEventsFromComponents>
  try {
    parsed = parseEventsFromComponents(parseComponentsForData(iCalData), calendarId)
  } catch (e) {
    console.error('ICAL.parse failed:', e)
    return []
  }

  // Filter out the Calino Settings sync event — it's not a real calendar event.
  // Match by prefix (R1.9) because the full UID is per-instance.
  const all = [...parsed.events, ...parsed.tasks, ...parsed.journals]
  return all.filter((e) => !e.id.startsWith(SETTINGS_EVENT_UID_PREFIX))
}

/**
 * Async counterpart for network/import callers. The document is parsed once,
 * source VTIMEZONEs are registered, referenced packaged zones are loaded, and
 * only then are the components mapped. Unknown zones retain ical.js's normal
 * fallback behavior because timezone preloading is best effort.
 */
export async function parseICALDataAsync(
  iCalData: string,
  calendarId: string
): Promise<CalendarEvent[]> {
  if (!iCalData || !iCalData.trim()) return []

  let comps: ICAL.Component[]
  try {
    comps = parseComponentsForData(iCalData)
  } catch (e) {
    console.error('ICAL.parse failed:', e)
    return []
  }

  await preloadTimezones(prepareComponentsForAsyncParsing(comps))
  const parsed = parseEventsFromComponents(comps, calendarId)
  return [...parsed.events, ...parsed.tasks, ...parsed.journals].filter(
    (event) => !event.id.startsWith(SETTINGS_EVENT_UID_PREFIX)
  )
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

  // Phase 2 (C4) — emit a VTIMEZONE for every referenced TZID. updateTimezones
  // only copies zones already registered in TimezoneService, so register them
  // first (lazy, cached). The patch path (icalPatch) deliberately never calls
  // this: origin VTIMEZONEs must survive untouched there.
  for (const event of events) {
    if (event.timezone) ensureZoneRegistered(event.timezone)
  }
  ICAL.helpers.updateTimezones(comp)

  return foldICalLines(comp.toString())
}

export function taskToICAL(task: CalendarEvent): string {
  const comp = new ICAL.Component('vcalendar')
  comp.updatePropertyWithValue('version', '2.0')
  comp.updatePropertyWithValue('prodid', '-//Calino//EN')
  comp.updatePropertyWithValue('calscale', 'GREGORIAN')

  const vtodo = calendarEventToIcalVtodo(task)
  comp.addSubcomponent(vtodo)

  // Phase 2 (C4) — see eventsToICAL.
  if (task.timezone) ensureZoneRegistered(task.timezone)
  ICAL.helpers.updateTimezones(comp)

  return foldICalLines(comp.toString())
}

export function parseICALJournal(iCalData: string, calendarId: string): CalendarEvent[] {
  if (!iCalData || !iCalData.trim()) {
    return []
  }

  let comps: ICAL.Component[]
  try {
    comps = parseComponentsForData(iCalData)
  } catch (e) {
    console.error('ICAL.parse failed for journals:', e)
    return []
  }

  return parseEventsFromComponents(comps, calendarId, 'journal').journals
}

export function journalToICAL(entry: CalendarEvent): string {
  const comp = new ICAL.Component('vcalendar')
  comp.updatePropertyWithValue('version', '2.0')
  comp.updatePropertyWithValue('prodid', '-//Calino//EN')
  comp.updatePropertyWithValue('calscale', 'GREGORIAN')

  const vjournal = calendarEventToIcalVjournal(entry)
  comp.addSubcomponent(vjournal)

  // Phase 2 (C4) — see eventsToICAL.
  if (entry.timezone) ensureZoneRegistered(entry.timezone)
  ICAL.helpers.updateTimezones(comp)

  return foldICalLines(comp.toString())
}
