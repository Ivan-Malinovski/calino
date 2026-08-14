import ICAL from 'ical.js'
import {
  calendarEventToIcalComponent,
  calendarEventToIcalVjournal,
  calendarEventToIcalVtodo,
} from '@/features/caldav/adapter/icalTypeMapping'
import { downloadFile } from '@/features/carddav/lib/vCardFileUtils'
import type { Calendar, CalendarEvent } from '@/types'

export const ICS_MIME_TYPE = 'text/calendar'

/** Longest base name we put in a download filename, before the `.ics`. */
const MAX_FILENAME_LENGTH = 80

/**
 * Serialize events into a single VCALENDAR.
 *
 * We can't use the higher-level eventToICAL / taskToICAL / journalToICAL
 * helpers directly because each wraps its component in its own VCALENDAR
 * envelope — concatenating those would produce an invalid ICS file
 * (multiple top-level VCALENDARs).
 */
export function buildVCalendar(events: CalendarEvent[]): string {
  const comp = new ICAL.Component('vcalendar')
  comp.updatePropertyWithValue('version', '2.0')
  comp.updatePropertyWithValue('prodid', '-//Calino//Calendar//EN')
  comp.updatePropertyWithValue('calscale', 'GREGORIAN')

  for (const event of events) {
    if (event.type === 'task') {
      comp.addSubcomponent(calendarEventToIcalVtodo(event))
    } else if (event.type === 'journal') {
      comp.addSubcomponent(calendarEventToIcalVjournal(event))
    } else {
      comp.addSubcomponent(calendarEventToIcalComponent(event))
    }
  }

  return comp.toString()
}

/**
 * Turn a user-supplied title into something safe to hand to a download
 * attribute. Path separators and control characters are the parts that
 * actually matter; the rest is cosmetic tidying so the file is recognizable.
 *
 * Non-Latin titles survive intact — browsers handle them fine — but a title
 * that sanitizes down to nothing falls back to `fallback`.
 */
export function sanitizeFilename(title: string, fallback: string): string {
  const cleaned = title
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .slice(0, MAX_FILENAME_LENGTH)
    .trim()

  return cleaned.length > 0 ? cleaned : fallback
}

/** Download a single event (or task/journal) as its own .ics file. */
export function exportSingleEventIcs(event: CalendarEvent): void {
  const ics = buildVCalendar([event])
  downloadFile(ics, `${sanitizeFilename(event.title, 'event')}.ics`, ICS_MIME_TYPE)
}

/**
 * Download every event belonging to `calendar` as one .ics file.
 * `events` may be the whole store — filtering to the calendar happens here so
 * callers don't each have to remember to do it.
 */
export function exportCalendarIcs(calendar: Calendar, events: CalendarEvent[]): number {
  const own = events.filter((e) => e.calendarId === calendar.id)
  const ics = buildVCalendar(own)
  downloadFile(ics, `${sanitizeFilename(calendar.name, 'calendar')}.ics`, ICS_MIME_TYPE)
  return own.length
}

/** Download every event as one .ics file, named by today's date. */
export function exportAllEventsIcs(events: CalendarEvent[]): void {
  const ics = buildVCalendar(events)
  const stamp = new Date().toISOString().split('T')[0]
  downloadFile(ics, `calino-export-${stamp}.ics`, ICS_MIME_TYPE)
}
