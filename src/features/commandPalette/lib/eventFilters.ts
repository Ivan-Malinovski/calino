import { parseISO } from 'date-fns'
import type { CalendarEvent } from '@/types'
import {
  displayOccurrence,
  isOccurrenceExcluded,
  materializeOccurrence,
  occurrencesAfter,
  occurrenceInstant,
  shapeOccurrence,
  resolveRRuleString,
  type OccurrenceShape,
} from '@/lib/occurrenceExpansion'

export type FilterDate = string

export interface CommandPaletteFilter {
  /** The palette form calls these `terms`; `includedTerms` is the descriptive alias. */
  terms: string[]
  includedTerms?: string[]
  location: string
  excludedKeywords: string[]
  fromDate?: FilterDate
  toDate?: FilterDate
}

export const EMPTY_COMMAND_PALETTE_FILTER: CommandPaletteFilter = {
  terms: [],
  includedTerms: [],
  location: '',
  excludedKeywords: [],
  fromDate: undefined,
  toDate: undefined,
}

export interface FilteredEvent {
  event: CalendarEvent
  occurrence?: OccurrenceShape
}

export interface EventTextFilter {
  terms?: string[]
  includedTerms?: string[]
  location?: string
  excludedKeywords?: string[]
}

export interface FilterDateRange {
  from?: Date
  to?: Date
  invalidDateRange: boolean
}

/** Split a palette value on whitespace while keeping quoted phrases together. */
export function parseFilterTokens(value: string): string[] {
  const tokens: string[] = []
  let token = ''
  let quote: string | undefined
  let escaped = false

  for (const character of value.trim()) {
    if (escaped) {
      token += character
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (character === quote) quote = undefined
      else token += character
      continue
    }
    if ((character === '"' || character === "'") && !token) {
      quote = character
    } else if (character === '"' || character === "'") {
      token += character
    } else if (/\s/.test(character)) {
      if (token) {
        tokens.push(token)
        token = ''
      }
    } else {
      token += character
    }
  }

  if (escaped) token += '\\'
  if (token) tokens.push(token)
  return tokens
}

const normalise = (value: string): string => value.trim().toLocaleLowerCase()

/** Match title/description terms, location, and exclusions for one event. */
export function eventMatchesText(event: CalendarEvent, filter: EventTextFilter): boolean {
  const titleAndDescription = `${event.title} ${event.description ?? ''}`.toLocaleLowerCase()
  const location = (event.location ?? '').toLocaleLowerCase()
  const includedTerms = (filter.includedTerms?.length ? filter.includedTerms : (filter.terms ?? []))
    .map(normalise)
    .filter(Boolean)
  const excludedKeywords = (filter.excludedKeywords ?? []).map(normalise).filter(Boolean)
  const wantedLocation = normalise(filter.location ?? '')

  if (
    includedTerms.length > 0 &&
    !includedTerms.some((term) => titleAndDescription.includes(term))
  ) {
    return false
  }
  if (wantedLocation && !location.includes(wantedLocation)) return false
  if (
    excludedKeywords.some(
      (keyword) => titleAndDescription.includes(keyword) || location.includes(keyword)
    )
  ) {
    return false
  }
  return true
}

function parseFilterDate(value: FilterDate | undefined, endOfDay = false): Date | undefined {
  if (value === undefined || value === '') return undefined
  const date = parseISO(value)
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date.setHours(23, 59, 59, 999)
  }
  return Number.isNaN(date.getTime()) ? undefined : date
}

/** Parse and validate the optional date bounds without changing the filter. */
export function validateFilterDateRange(
  filter: Pick<CommandPaletteFilter, 'fromDate' | 'toDate'>
): FilterDateRange {
  const from = parseFilterDate(filter.fromDate)
  const to = parseFilterDate(filter.toDate, true)
  const hasInvalidBound =
    (filter.fromDate !== undefined && filter.fromDate !== '' && !from) ||
    (filter.toDate !== undefined && filter.toDate !== '' && !to)
  return {
    from,
    to,
    invalidDateRange: Boolean(hasInvalidBound || (from && to && from.getTime() > to.getTime())),
  }
}

export const isValidFilterDateRange = (
  filter: Pick<CommandPaletteFilter, 'fromDate' | 'toDate'>
): boolean => !validateFilterDateRange(filter).invalidDateRange

function datePart(value: string): string {
  return value.split('T')[0]
}

function localDateStart(value: string): Date {
  const [year, month, day] = datePart(value).split('-').map(Number)
  return new Date(year, month - 1, day)
}

function localDateEnd(value: string): Date {
  const date = localDateStart(value)
  date.setHours(23, 59, 59, 999)
  return date
}

function hasExplicitAllDayEndTime(value: string): boolean {
  const time = value.split('T')[1]
  return Boolean(time && !/^00:00(?::00(?:\.0*)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(time))
}

/** Normalize both RFC-style exclusive midnights and inclusive timed ends. */
function allDayBounds(startValue: string, endValue: string): { start: Date; end: Date } {
  const start = localDateStart(startValue)
  const endDate = localDateStart(endValue)
  const end =
    endDate.getTime() > start.getTime() && !hasExplicitAllDayEndTime(endValue)
      ? new Date(endDate.getTime() - 1)
      : localDateEnd(endValue)
  return { start, end }
}

function eventSpanBounds(event: CalendarEvent): { start: Date; end: Date } {
  if (event.isAllDay) {
    return allDayBounds(event.start, event.end)
  }
  const start = occurrenceInstant(event, event.start)
  const end = occurrenceInstant(event, event.end)
  return { start, end }
}

function taskDueBounds(event: CalendarEvent): { start: Date; end: Date } | undefined {
  if (!event.dueDate) return undefined
  if (event.isAllDay || !event.dueDate.includes('T')) {
    return { start: localDateStart(event.dueDate), end: localDateEnd(event.dueDate) }
  }
  const due = occurrenceInstant(event, event.dueDate)
  return { start: due, end: due }
}

function eventBounds(event: CalendarEvent): { start: Date; end: Date } {
  return event.type === 'task'
    ? (taskDueBounds(event) ?? eventSpanBounds(event))
    : eventSpanBounds(event)
}

function shapeBounds(shape: OccurrenceShape, isAllDay: boolean): { start: Date; end: Date } {
  if (isAllDay) {
    return allDayBounds(shape.occStartStr, shape.occEndStr)
  }
  return { start: parseISO(shape.occStartStr), end: parseISO(shape.occEndStr) }
}

function overlaps(bounds: { start: Date; end: Date }, range: FilterDateRange): boolean {
  if (range.invalidDateRange) return true
  return (
    (range.from === undefined || bounds.end.getTime() >= range.from.getTime()) &&
    (range.to === undefined || bounds.start.getTime() <= range.to.getTime())
  )
}

function hasDateConstraint(range: FilterDateRange): boolean {
  return !range.invalidDateRange && (range.from !== undefined || range.to !== undefined)
}

function isCancelled(event: CalendarEvent): boolean {
  return event.eventStatus?.toUpperCase() === 'CANCELLED' || event.taskStatus === 'CANCELLED'
}

function isRecurring(event: CalendarEvent): boolean {
  return !event.recurrenceId && Boolean(resolveRRuleString(event))
}

function recurrenceKey(master: CalendarEvent, recurrenceId: string): string {
  if (master.isAllDay) return datePart(recurrenceId)
  const instant = occurrenceInstant(master, recurrenceId)
  return Number.isNaN(instant.getTime()) ? recurrenceId : String(instant.getTime())
}

function overrideForOccurrence(
  master: CalendarEvent,
  overrides: CalendarEvent[],
  shape: OccurrenceShape
): CalendarEvent | undefined {
  const wanted = master.isAllDay ? shape.occDateStr : String(parseISO(shape.occStartStr).getTime())
  return overrides.find(
    (override) => override.recurrenceId && recurrenceKey(master, override.recurrenceId) === wanted
  )
}

function overrideShape(override: CalendarEvent): OccurrenceShape {
  const startDate = datePart(override.start)
  if (override.isAllDay) {
    return {
      occStartStr: `${startDate}T00:00:00`,
      occEndStr: `${datePart(override.end)}T00:00:00`,
      occDateStr: startDate,
      occKey: startDate,
    }
  }
  const start = occurrenceInstant(override, override.start)
  const end = occurrenceInstant(override, override.end)
  return shapeOccurrence(start, start, end, false, override.timezone)
}

function masterOccurrenceShape(master: CalendarEvent, occurrence: Date): OccurrenceShape {
  // A TZID event's stored DTSTART/DTEND are wall clocks. Resolve both through
  // the event zone before calculating the duration, otherwise an occurrence
  // spanning a DST transition gets the wrong end instant.
  const start = master.isAllDay
    ? parseISO(master.start)
    : occurrenceInstant(master, master.start)
  const end = master.isAllDay ? parseISO(master.end) : occurrenceInstant(master, master.end)
  return shapeOccurrence(occurrence, start, end, master.isAllDay, master.timezone)
}

function durationMs(event: CalendarEvent): number {
  // Recurrence expansion preserves the DTSTART→DTEND span. A task's due date
  // is its search date, but it must not replace the span used to shape each
  // generated occurrence.
  if (event.isAllDay) {
    const start = localDateStart(event.start)
    const end = localDateStart(event.end)
    const days = Math.max(
      1,
      Math.round((end.getTime() - start.getTime()) / 86400000) +
        (hasExplicitAllDayEndTime(event.end) ? 1 : 0)
    )
    return days * 86400000
  }
  const bounds = eventSpanBounds(event)
  return Math.max(0, bounds.end.getTime() - bounds.start.getTime())
}

function displayCandidates(
  master: CalendarEvent,
  overrides: CalendarEvent[],
  now: Date
): Array<{ event: CalendarEvent; occurrence: OccurrenceShape }> {
  const candidates: Array<{ event: CalendarEvent; occurrence: OccurrenceShape }> = []
  const display = displayOccurrence(master, now)
  if (display) {
    const override = overrideForOccurrence(master, overrides, display)
    if (!override || !isCancelled(override)) {
      candidates.push({
        event: override ?? master,
        occurrence: override ? overrideShape(override) : display,
      })
    } else {
      // displayOccurrence intentionally knows only about EXDATEs, while a
      // cancelled detached record is stored separately. Continue the shared
      // recurrence walk so the cancelled slot can never be shown as the
      // master's representative.
      const cursor = occurrenceInstant(master, display.occStartStr)
      for (const next of occurrencesAfter(master, cursor)) {
        const nextShape = masterOccurrenceShape(master, next)
        const nextOverride = overrideForOccurrence(master, overrides, nextShape)
        if (
          !nextOverride &&
          isOccurrenceExcluded(
            next,
            nextShape.occDateStr,
            master.isAllDay,
            master.excludedDates,
            master.timezone
          )
        ) {
          continue
        }
        if (nextOverride && isCancelled(nextOverride)) continue
        candidates.push({
          event: nextOverride ?? master,
          occurrence: nextOverride ? overrideShape(nextOverride) : nextShape,
        })
        break
      }
    }
  }

  for (const override of overrides) {
    if (isCancelled(override)) continue
    const occurrence = overrideShape(override)
    if (!candidates.some((candidate) => candidate.event.id === override.id)) {
      candidates.push({ event: override, occurrence })
    }
  }

  const nowTime = now.getTime()
  const timeOf = (candidate: { occurrence: OccurrenceShape }): number =>
    candidate.occurrence.occStartStr.includes('T00:00:00') && master.isAllDay
      ? localDateStart(candidate.occurrence.occDateStr).getTime()
      : parseISO(candidate.occurrence.occStartStr).getTime()
  const future = candidates
    .filter((candidate) => timeOf(candidate) >= nowTime)
    .sort((a, b) => timeOf(a) - timeOf(b))
  if (future.length > 0) return future
  return candidates.sort((a, b) => timeOf(b) - timeOf(a))
}

function filterRecurringMaster(
  master: CalendarEvent,
  overrides: CalendarEvent[],
  filter: CommandPaletteFilter,
  range: FilterDateRange,
  now: Date
): FilteredEvent | undefined {
  if (!hasDateConstraint(range)) {
    const candidates = displayCandidates(master, overrides, now)
    const matchingCandidate = candidates.find(({ event }) => eventMatchesText(event, filter))
    if (matchingCandidate) return matchingCandidate

    // A detached occurrence may replace the displayed slot with metadata that
    // no longer matches the series' title/location. The series is still a
    // searchable record, so retain its normal representative when the master
    // itself satisfies the text filters.
    if (eventMatchesText(master, filter)) {
      const occurrence = displayOccurrence(master, now)
      const override = occurrence ? overrideForOccurrence(master, overrides, occurrence) : undefined
      if (occurrence && (!override || !isCancelled(override))) return { event: master, occurrence }
    }
    return undefined
  }

  // Generate one occurrence at a time so wide ranges still return one row
  // per series without retaining every RRULE instance in memory. For an
  // open-ended range the iterator naturally stops only for finite rules.
  const cursor = range.from
    ? new Date(range.from.getTime() - durationMs(master) - 1)
    : new Date(occurrenceInstant(master, master.start).getTime() - 1)
  // If the master metadata does not match, only detached records can satisfy
  // the text filter and the finite override pass below is sufficient. This
  // guard is important for an infinite RRULE whose series text cannot match:
  // it prevents a synchronous open-ended walk from running forever.
  if (eventMatchesText(master, filter)) {
    for (const occurrenceInstantValue of occurrencesAfter(master, cursor)) {
      if (range.to && occurrenceInstantValue.getTime() > range.to.getTime()) break
      const occurrence = masterOccurrenceShape(master, occurrenceInstantValue)
      const override = overrideForOccurrence(master, overrides, occurrence)
      if (
        !override &&
        isOccurrenceExcluded(
          occurrenceInstantValue,
          occurrence.occDateStr,
          master.isAllDay,
          master.excludedDates,
          master.timezone
        )
      ) {
        continue
      }
      if (override && isCancelled(override)) continue
      const event = override ?? master
      const effectiveOccurrence = override ? overrideShape(override) : occurrence
      const bounds =
        event.type === 'task' && !override
          ? eventBounds(materializeOccurrence(master, effectiveOccurrence))
          : override
            ? eventBounds(event)
            : shapeBounds(effectiveOccurrence, event.isAllDay)
      if (eventMatchesText(event, filter) && overlaps(bounds, range)) {
        return { event, occurrence: effectiveOccurrence }
      }
    }
  }

  // A moved detached instance can land in the requested range even when its
  // original recurrence slot does not. It is still one representative of the
  // series when no generated slot qualified above.
  for (const override of overrides) {
    if (
      !isCancelled(override) &&
      eventMatchesText(override, filter) &&
      overlaps(eventBounds(override), range)
    ) {
      return { event: override, occurrence: overrideShape(override) }
    }
  }
  return undefined
}

/** Filter stored events, collapsing recurring series to one representative. */
export function getFilteredEvents(
  events: CalendarEvent[],
  filter: CommandPaletteFilter,
  now: Date = new Date()
): { matches: FilteredEvent[]; invalidDateRange: boolean } {
  const range = validateFilterDateRange(filter)
  const masters = new Map(events.filter(isRecurring).map((event) => [event.id, event]))
  const overridesByMaster = new Map<string, CalendarEvent[]>()
  for (const event of events) {
    if (!event.recurrenceMasterId || !masters.has(event.recurrenceMasterId)) continue
    const overrides = overridesByMaster.get(event.recurrenceMasterId) ?? []
    overrides.push(event)
    overridesByMaster.set(event.recurrenceMasterId, overrides)
  }

  const matches: FilteredEvent[] = []
  const matchedMasterIds = new Set<string>()
  for (const master of masters.values()) {
    if (isCancelled(master)) continue
    const match = filterRecurringMaster(
      master,
      overridesByMaster.get(master.id) ?? [],
      filter,
      range,
      now
    )
    if (match) {
      matches.push(match)
      matchedMasterIds.add(master.id)
    }
  }

  for (const event of events) {
    if (isCancelled(event)) continue
    if (event.recurrenceMasterId && matchedMasterIds.has(event.recurrenceMasterId)) continue
    if (isRecurring(event)) continue
    if (!eventMatchesText(event, filter)) continue
    if (!hasDateConstraint(range) || overlaps(eventBounds(event), range)) {
      matches.push({ event })
    }
  }

  const order = new Map(events.map((event, index) => [event.id, index]))
  matches.sort((a, b) => (order.get(a.event.id) ?? 0) - (order.get(b.event.id) ?? 0))

  return { matches, invalidDateRange: range.invalidDateRange }
}
