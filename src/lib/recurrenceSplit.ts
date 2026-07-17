import { fromZonedTime } from 'date-fns-tz'
import { format } from 'date-fns'
import { buildRRuleString } from '@/lib/recurrence'
import type { CalendarEvent, RecurrenceRule } from '@/types'

export interface MasterTruncation {
  excludedDates: string[]
  recurrence: RecurrenceRule | undefined
  rruleString: string | undefined
}

/**
 * Computes the patch to apply to a recurrence master when splitting a series at
 * a given occurrence ("This and following events"). The master keeps every
 * occurrence before the split by ending immediately before that occurrence.
 *
 * Pure — it neither mutates the store nor calls CalDAV. Callers apply the
 * returned patch (via `updateEvent`) and separately create the new series.
 *
 * @param master           the recurrence master event
 * @param occurrenceValue the selected occurrence's RECURRENCE-ID value
 */
export function buildMasterTruncation(
  master: CalendarEvent,
  occurrenceValue: string
): MasterTruncation {
  const occurrenceDateStr = occurrenceValue.split('T')[0]
  let masterEndDate: string
  let untilValue: string

  if (master.isAllDay) {
    const dayBefore = new Date(`${occurrenceDateStr}T00:00:00Z`)
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1)
    masterEndDate = dayBefore.toISOString().split('T')[0]
    untilValue = masterEndDate.replaceAll('-', '')
  } else {
    const occurrence = parseOccurrenceValue(master, occurrenceValue)
    const immediatelyBefore = new Date(occurrence.getTime() - 1000)
    masterEndDate = immediatelyBefore.toISOString()
    untilValue = masterEndDate.replace(/[-:]/g, '').replace('.000', '')
  }

  // The UNTIL boundary already excludes the selected occurrence, so adding an
  // EXDATE would only pollute the master and is unnecessary.
  const excludedDates = master.excludedDates || []

  const recurrence: RecurrenceRule | undefined = master.recurrence
    ? { ...master.recurrence, endDate: masterEndDate, count: undefined, isAllDay: master.isAllDay }
    : undefined

  const rruleString = recurrence
    ? buildRRuleString(recurrence)
    : master.rruleString
      ? [
          ...master.rruleString
            .split(';')
            .filter((part) => {
              const normalized = part.toUpperCase()
              return !normalized.startsWith('UNTIL=') && !normalized.startsWith('COUNT=')
            }),
          `UNTIL=${untilValue}`,
        ].join(';')
      : undefined

  return { excludedDates, recurrence, rruleString }
}

export function getFutureOverrideIds(
  events: readonly CalendarEvent[],
  master: CalendarEvent,
  occurrenceValue: string
): string[] {
  const uid = master.uid || master.id
  const boundary = master.isAllDay
    ? occurrenceValue.split('T')[0]
    : parseOccurrenceValue(master, occurrenceValue).getTime()
  return events
    .filter(
      (event) =>
        Boolean(event.recurrenceId) &&
        event.calendarId === master.calendarId &&
        (event.recurrenceMasterId === master.id || event.uid === uid) &&
        (master.isAllDay
          ? event.recurrenceId!.split('T')[0] >= (boundary as string)
          : parseOccurrenceValue(master, event.recurrenceId!).getTime() >= (boundary as number))
    )
    .map((event) => event.id)
}

export function isFirstOccurrence(master: CalendarEvent, occurrenceValue: string): boolean {
  if (master.isAllDay) {
    return occurrenceValue.split('T')[0] <= master.start.split('T')[0]
  }
  return parseOccurrenceValue(master, occurrenceValue).getTime() <=
    parseOccurrenceValue(master, master.start).getTime()
}

function parseOccurrenceValue(master: CalendarEvent, value: string): Date {
  let normalized = value
  if (!normalized.includes('T')) {
    const masterTime = master.start.split('T')[1] || '00:00:00'
    normalized = `${normalized}T${masterTime}`
  }
  if (master.timezone && master.timezone !== 'UTC') {
    // Generated occurrence IDs use Date#toISOString even when DTSTART has a
    // TZID. Convert them back to the browser wall clock used by expansion, then
    // reinterpret that clock in the series timezone before writing UNTIL.
    const wallClock = normalized.endsWith('Z')
      ? format(new Date(normalized), "yyyy-MM-dd'T'HH:mm:ss")
      : normalized
    return fromZonedTime(wallClock, master.timezone)
  }
  return new Date(normalized)
}
