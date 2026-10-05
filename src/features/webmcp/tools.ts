import { z } from 'zod'
import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import { useCalendarStore } from '@/store/calendarStore'
import { findEventById, extractOriginalEventId } from '@/lib/events'
import { toEventInstant } from '@/lib/datetime'
import type { CalendarEvent } from '@/types'

export interface WebMCPTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }
  execute: (input: unknown) => unknown
}

const date = z.iso.date()
const id = z.string().min(1).max(512)
const searchInput = z.strictObject({
  start: date.describe('First date, inclusive, YYYY-MM-DD in the device timezone.'),
  end: date.describe('Last date, inclusive. Search at most 31 calendar days.'),
  query: z.string().max(200).optional().describe('Literal title or location text.'),
  calendarId: id.optional(),
  limit: z.number().int().min(1).max(50).default(20),
})
const prepareInput = z.strictObject({
  title: z.string().trim().min(1).max(300),
  start: z
    .string()
    .max(16)
    .describe('YYYY-MM-DDTHH:mm in the device timezone, or YYYY-MM-DD for all-day.'),
  end: z
    .string()
    .max(16)
    .describe('Same format as start. For all-day events, the last date is inclusive.'),
  allDay: z.boolean().default(false),
  calendarId: id
    .optional()
    .describe('A writable calendar supporting events; omitted uses the default.'),
  location: z.string().max(500).optional(),
})

function isEvent(event: CalendarEvent): boolean {
  return event.type === undefined || event.type === 'event'
}

function requireFreeForm(): void {
  const state = useCalendarStore.getState()
  if (state.isModalOpen || state.isJournalModalOpen) {
    throw new Error('Close the current form before opening another event.')
  }
}

function tool<T extends z.ZodType>(
  name: string,
  description: string,
  schema: T,
  readOnly: boolean,
  execute: (input: z.output<T>) => unknown
): WebMCPTool {
  return {
    name,
    description,
    inputSchema: z.toJSONSchema(schema, { io: 'input' }),
    annotations: { readOnlyHint: readOnly, untrustedContentHint: readOnly },
    execute: (input) => {
      const parsed = schema.safeParse(input)
      if (!parsed.success)
        return {
          error: 'Invalid arguments.',
          details: parsed.error.issues.map(({ path, message }) => ({ path, message })),
        }
      try {
        return execute(parsed.data)
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Unable to complete the request.' }
      }
    },
  }
}

export function createWebMCPTools(): WebMCPTool[] {
  return [
    tool(
      'list_calendars',
      'List Calino calendar IDs, names, visibility and whether they support creating events. Uses local data; does not sync.',
      z.strictObject({}),
      true,
      () => ({
        calendars: useCalendarStore.getState().calendars.map((calendar) => ({
          id: calendar.id,
          name: calendar.name.slice(0, 300),
          visible: calendar.isVisible,
          writable:
            !calendar.readOnly &&
            (!calendar.supportedComponents || calendar.supportedComponents.includes('VEVENT')),
        })),
      })
    ),
    tool(
      'search_events',
      'Search visible Calino events, respecting calendar and category filters. Includes recurring occurrences; excludes tasks and journals. Results use locally cached data and may not be synced. Dates and naive times are in the supplied timezone.',
      searchInput,
      true,
      ({ start, end, query, calendarId, limit }) => {
        const days = differenceInCalendarDays(parseISO(end), parseISO(start))
        if (days < 0 || days > 30)
          throw new Error('Choose an ordered range of at most 31 calendar days.')
        const state = useCalendarStore.getState()
        if (calendarId && !state.calendars.some((calendar) => calendar.id === calendarId))
          throw new Error('Unknown calendar.')
        const needle = query?.toLocaleLowerCase()
        const matches = state
          .getEventsForDateRange(start, end)
          .filter(
            (event) =>
              isEvent(event) &&
              (!calendarId || event.calendarId === calendarId) &&
              (!needle ||
                `${event.title}\n${event.location ?? ''}`.toLocaleLowerCase().includes(needle))
          )
          .sort(
            (a, b) =>
              toEventInstant(a.start, a.timezone).getTime() -
                toEventInstant(b.start, b.timezone).getTime() || a.id.localeCompare(b.id)
          )
        return {
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          truncated: matches.length > limit,
          events: matches.slice(0, limit).map((event) => ({
            id: event.id,
            calendarId: event.calendarId,
            title: event.title.slice(0, 300),
            start: event.start,
            end: event.end,
            allDay: event.isAllDay,
            timezone: event.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
            location: event.location?.slice(0, 500),
            transparency: event.transparency ?? 'opaque',
            syncStatus: event.syncStatus,
          })),
        }
      }
    ),
    tool(
      'open_event',
      'Open an existing visible Calino event for the user to inspect. Accepts an exact event or occurrence ID returned by search_events. Does not save changes.',
      z.strictObject({ eventId: id }),
      false,
      ({ eventId }) => {
        requireFreeForm()
        const state = useCalendarStore.getState()
        const event = findEventById(state.events, eventId)
        if (
          !event ||
          !isEvent(event) ||
          !state.calendars.some(
            (calendar) => calendar.id === event.calendarId && calendar.isVisible
          )
        )
          throw new Error('Event not found in visible calendars.')
        let selected = event
        if (event.id !== eventId) {
          const masterId = extractOriginalEventId(eventId)!
          const key = eventId.slice(masterId.length + 1)
          const occurrenceDate = event.isAllDay ? key : format(parseISO(key), 'yyyy-MM-dd')
          if (!date.safeParse(occurrenceDate).success) throw new Error('Invalid occurrence ID.')
          const occurrence = state
            .getEventsForDateRange(occurrenceDate, occurrenceDate)
            .find((candidate) => candidate.id === eventId && isEvent(candidate))
          if (!occurrence) throw new Error('Occurrence not found.')
          selected = occurrence
        }
        state.setCurrentDate(
          selected.isAllDay
            ? selected.start.split('T')[0]
            : format(toEventInstant(selected.start, selected.timezone), 'yyyy-MM-dd')
        )
        state.openModal(undefined, undefined, eventId)
        return { status: 'opened', eventId }
      }
    ),
    tool(
      'prepare_event',
      'Open a prefilled new event form for the user to review and save. Does not create or sync an event. Use local device times, not UTC or offset timestamps. No invitations are sent.',
      prepareInput,
      false,
      ({ title, start, end, allDay, calendarId, location }) => {
        requireFreeForm()
        const timestamp = allDay
          ? date
          : z.iso
              .datetime({ local: true })
              .refine((value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
        if (!timestamp.safeParse(start).success || !timestamp.safeParse(end).success)
          throw new Error(
            'Use valid dates for all-day events or local YYYY-MM-DDTHH:mm times for timed events.'
          )
        if (end < start || (!allDay && end === start))
          throw new Error('The end must follow the start; all-day events may end on the same date.')
        // Reject nonexistent wall-clock times during a daylight-saving transition.
        if (
          !allDay &&
          [start, end].some((value) => format(parseISO(value), "yyyy-MM-dd'T'HH:mm") !== value)
        )
          throw new Error('This local time does not exist in the device timezone.')
        const state = useCalendarStore.getState()
        const writable = state.calendars.filter(
          (calendar) =>
            !calendar.readOnly &&
            (!calendar.supportedComponents || calendar.supportedComponents.includes('VEVENT'))
        )
        const calendar = calendarId
          ? writable.find((candidate) => candidate.id === calendarId)
          : (writable.find((candidate) => candidate.isDefault) ?? writable[0])
        if (!calendar) throw new Error('Choose a writable calendar that supports events.')
        state.setCurrentDate(start.split('T')[0])
        state.setPendingEventPrefill({ title, start, end, allDay, location, kind: 'event' })
        state.openModal(start, end, undefined, 'event', title, undefined, calendar.id)
        return { status: 'awaiting_user_review', saved: false }
      }
    ),
  ]
}
