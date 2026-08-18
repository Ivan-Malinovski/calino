/**
 * Patch a CalDAV resource's original iCalendar text instead of rebuilding it.
 *
 * Calino models a subset of RFC 5545, so serializing a resource from the store
 * destroyed everything outside that subset — GEO, CLASS, PRIORITY, RDATE,
 * RELATED-TO, X- properties, the origin server's PRODID, whole VTIMEZONE
 * blocks. This module takes the bytes the server last gave us (kept in
 * `rawIcsStore`), rewrites only the components Calino is actually writing, and
 * leaves the rest of the document alone.
 *
 * Every failure path returns `null` so the caller can fall back to today's
 * from-scratch serializers: a save that loses unmodelled properties is bad, a
 * save that doesn't happen is worse.
 */

import ICAL from 'ical.js'
import type { CalendarEvent } from '@/types'
import {
  calendarEventToIcalComponent,
  calendarEventToIcalVtodo,
  calendarEventToIcalVjournal,
  recurrenceIdICALString,
} from './icalTypeMapping'
import { foldICalLines } from './iCalendarAdapter'

/** The three component types Calino writes; everything else is off limits. */
const PATCHABLE = ['vevent', 'vtodo', 'vjournal'] as const

function componentName(event: CalendarEvent): (typeof PATCHABLE)[number] {
  if (event.type === 'task') return 'vtodo'
  if (event.type === 'journal') return 'vjournal'
  return 'vevent'
}

/**
 * The UID a builder will write for this event.
 *
 * Mirrors the builders exactly — an override carries its master's UID, and the
 * VJOURNAL builder uses the local id — because a key that disagreed with what
 * gets written would match nothing and silently duplicate the component.
 */
function eventUid(event: CalendarEvent): string {
  if (event.type === 'journal') return event.id
  return event.uid || event.recurrenceMasterId || event.id
}

function eventKey(event: CalendarEvent): string {
  return `${eventUid(event)}|${recurrenceIdICALString(event)}`
}

function componentKey(comp: ICAL.Component): string {
  const uid = comp.getFirstPropertyValue('uid')
  // The raw ICAL string, not a parsed value: normalising a RECURRENCE-ID goes
  // through the ambient timezone, so the key would differ between machines.
  const recurrenceId = comp.getFirstProperty('recurrence-id')?.toICALString() ?? ''
  return `${typeof uid === 'string' ? uid : ''}|${recurrenceId}`
}

function buildInto(event: CalendarEvent, existing?: ICAL.Component): ICAL.Component {
  if (event.type === 'task') return calendarEventToIcalVtodo(event, existing)
  if (event.type === 'journal') return calendarEventToIcalVjournal(event, existing)
  return calendarEventToIcalComponent(event, existing)
}

/**
 * Rewrite `events` into `originalIcs`, preserving everything else it carries.
 *
 * Returns `null` when the original can't be used — malformed text, a root that
 * isn't a VCALENDAR — so the caller falls back to a from-scratch serialization.
 */
export function patchICALData(originalIcs: string, events: CalendarEvent[]): string | null {
  let root: ICAL.Component
  try {
    root = new ICAL.Component(ICAL.parse(originalIcs) as string | unknown[])
  } catch {
    return null
  }
  if (root.name !== 'vcalendar') return null

  // Only the three patchable types are indexed, so VTIMEZONE, VFREEBUSY and
  // X- subcomponents are never visited — and therefore never touched. Same for
  // the root's own properties: PRODID stays the origin server's.
  const existingByKey = new Map<string, ICAL.Component>()
  const existingComps: ICAL.Component[] = []
  for (const name of PATCHABLE) {
    for (const comp of root.getAllSubcomponents(name)) {
      existingComps.push(comp)
      const key = componentKey(comp)
      // First writer wins: a duplicate key means the resource is malformed, and
      // patching one of the pair arbitrarily is better than patching both.
      if (!existingByKey.has(key)) existingByKey.set(key, comp)
    }
  }

  const matched = new Set<ICAL.Component>()
  const writtenUids = new Set<string>()
  for (const event of events) {
    writtenUids.add(eventUid(event))

    const existing = existingByKey.get(eventKey(event))
    // The name check catches a UID that changed component type; patching a
    // VEVENT into a VTODO would emit a component with both types' properties.
    if (existing && existing.name === componentName(event)) {
      matched.add(existing)
      buildInto(event, existing)
    } else {
      root.addSubcomponent(buildInto(event))
    }
  }

  // Components that vanished from the group are deletions — but only within the
  // UIDs being written. A foreign UID sharing the resource belongs to somebody
  // else's object and is not ours to remove.
  for (const comp of existingComps) {
    if (matched.has(comp)) continue
    const uid = comp.getFirstPropertyValue('uid')
    if (typeof uid !== 'string' || !writtenUids.has(uid)) continue
    root.removeSubcomponent(comp)
  }

  return foldICalLines(root.toString())
}
