import { registerPlugin, Capacitor } from '@capacitor/core'
import type { Calendar, CalendarEvent } from '@/types'
import { buildRRuleString } from './recurrence'
import { getEffectiveReminders } from './notifications'

/**
 * One-way, read-only export of Calino's events into Android's calendar
 * provider (see `android/.../CalendarMirrorPlugin.java`).
 *
 * The point is reminder reliability: `@capacitor/local-notifications` can only
 * schedule while the app is alive, so an event created on another device never
 * alerts until Calino next opens. Rows in `CalendarContract` are alarmed by the
 * OS regardless. The mirror also makes events visible to calendar widgets,
 * Wear OS and Android Auto, none of which can see IndexedDB.
 *
 * Nothing flows back — Calino remains the only writer, and the mirrored
 * calendars are created read-only.
 */

export interface MirrorCalendarPayload {
  id: string
  name: string
  color: string
}

export interface MirrorEventPayload {
  id: string
  calendarId: string
  /** Content hash; lets the native side skip events that did not change. */
  hash: string
  title: string
  description?: string
  location?: string
  /** Epoch millis. For all-day events, midnight UTC on the event's date. */
  start: number
  /** Epoch millis. Ignored by the native side when `rrule` is set. */
  end: number
  allDay: boolean
  timezone: string
  transparency?: string
  rrule?: string
  /** RFC 5545 DURATION; the provider requires it instead of DTEND on a series. */
  duration?: string
  /** Comma-separated basic-format timestamps. */
  exdate?: string
  /** Minutes before start, one per reminder. */
  reminders: number[]
}

interface CalendarMirrorPlugin {
  checkCalendarPermission(): Promise<{ granted: boolean }>
  requestCalendarPermission(): Promise<{ granted: boolean }>
  hasCalendarApp(): Promise<{ present: boolean }>
  sync(options: {
    calendars: MirrorCalendarPayload[]
    events: MirrorEventPayload[]
  }): Promise<{ calendars: number; written: number; removed: number }>
  clear(): Promise<{ removed?: number }>
}

const CalendarMirror = registerPlugin<CalendarMirrorPlugin>('CalendarMirror')

/**
 * How much of the timeline non-recurring events are mirrored for. Recurring
 * series are always mirrored whole — the provider expands them itself, so
 * there is nothing to bound.
 *
 * Past events are kept in range because widgets and Auto show "earlier today",
 * and because a year of history is what makes the mirrored calendar useful to
 * browse in another app rather than looking mysteriously empty.
 */
const MIRROR_PAST_DAYS = 365
const MIRROR_FUTURE_DAYS = 730

const DAY_MS = 24 * 60 * 60 * 1000

export function isCalendarMirrorSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export async function checkCalendarMirrorPermission(): Promise<boolean> {
  if (!isCalendarMirrorSupported()) return false
  const { granted } = await CalendarMirror.checkCalendarPermission()
  return granted
}

export async function requestCalendarMirrorPermission(): Promise<boolean> {
  if (!isCalendarMirrorSupported()) return false
  const { granted } = await CalendarMirror.requestCalendarPermission()
  return granted
}

/**
 * Whether a calendar app is installed. The provider stores reminders but does
 * not post notifications for them — a calendar app does, off the provider's
 * broadcast. With none installed, mirrored reminders would fire nothing, so
 * callers must keep local notifications in that case.
 */
export async function hasCalendarApp(): Promise<boolean> {
  if (!isCalendarMirrorSupported()) return false
  const { present } = await CalendarMirror.hasCalendarApp()
  return present
}

export async function clearCalendarMirror(): Promise<void> {
  if (!isCalendarMirrorSupported()) return
  await CalendarMirror.clear()
}

// ------------------------------------------------------------------ mapping

/** Midnight UTC on the calendar date an ISO string names, per the provider's
 * all-day contract (DTSTART at UTC midnight, EVENT_TIMEZONE "UTC"). */
function allDayEpoch(iso: string): number {
  const [y, m, d] = iso.split('T')[0].split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function eventStartMs(event: CalendarEvent): number {
  return event.isAllDay ? allDayEpoch(event.start) : new Date(event.start).getTime()
}

function eventEndMs(event: CalendarEvent): number {
  return event.isAllDay ? allDayEpoch(event.end) : new Date(event.end).getTime()
}

/** RFC 5545 DURATION. All-day series use whole days so the provider keeps
 * them all-day across occurrences; timed series use seconds. */
export function toDuration(startMs: number, endMs: number, allDay: boolean): string {
  const ms = Math.max(endMs - startMs, allDay ? DAY_MS : 0)
  if (allDay) return `P${Math.max(Math.round(ms / DAY_MS), 1)}D`
  return `PT${Math.max(Math.round(ms / 1000), 0)}S`
}

/** Basic-format timestamp for EXDATE: `yyyyMMdd` all-day, `yyyyMMddTHHmmssZ`
 * otherwise. */
export function toBasicFormat(iso: string, allDay: boolean): string {
  if (allDay) return iso.split('T')[0].replace(/-/g, '')
  return `${new Date(iso).toISOString().replace(/[-:]/g, '').split('.')[0]}Z`
}

/** Order-independent, stable over the fields we actually write, so an event
 * whose untouched fields get reserialized does not churn the provider. */
export function hashPayload(payload: Omit<MirrorEventPayload, 'hash'>): string {
  const source = JSON.stringify([
    payload.calendarId,
    payload.title,
    payload.description ?? '',
    payload.location ?? '',
    payload.start,
    payload.end,
    payload.allDay,
    payload.timezone,
    payload.transparency ?? '',
    payload.rrule ?? '',
    payload.duration ?? '',
    payload.exdate ?? '',
    payload.reminders,
  ])
  // FNV-1a, 32-bit. Collisions only cost a missed update on an event whose
  // content changed to another value hashing identically — vanishingly rare,
  // and self-corrects on the next edit.
  let hash = 0x811c9dc5
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}

function rruleFor(event: CalendarEvent): string | undefined {
  if (event.rruleString) return event.rruleString
  if (event.recurrence) return buildRRuleString({ ...event.recurrence, isAllDay: event.isAllDay })
  return undefined
}

/**
 * Maps store events to mirror payloads.
 *
 * Detached recurrence instances are flattened rather than expressed with the
 * provider's exception model: each detached occurrence is mirrored as a plain
 * standalone event, and its RECURRENCE-ID is added to the master's EXDATE so
 * the series does not also render an occurrence in that slot. This keeps us
 * clear of ORIGINAL_INSTANCE_TIME, which is the fiddliest corner of
 * CalendarContract and buys nothing for a read-only mirror.
 */
export function buildMirrorPayload(
  events: CalendarEvent[],
  calendars: Calendar[],
  defaultReminderMinutes: number,
  now: Date = new Date()
): { calendars: MirrorCalendarPayload[]; events: MirrorEventPayload[] } {
  const mirroredCalendars = calendars
    .filter((calendar) => calendar.isVisible)
    .map((calendar) => ({ id: calendar.id, name: calendar.name, color: calendar.color }))
  const calendarIds = new Set(mirroredCalendars.map((calendar) => calendar.id))

  const windowStart = now.getTime() - MIRROR_PAST_DAYS * DAY_MS
  const windowEnd = now.getTime() + MIRROR_FUTURE_DAYS * DAY_MS
  const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  // RECURRENCE-IDs of detached occurrences, grouped by the master they detach
  // from, so masters can exclude those slots.
  const detachedByMaster = new Map<string, string[]>()
  for (const event of events) {
    if (!event.recurrenceId) continue
    const masterId = event.recurrenceMasterId ?? event.uid
    if (!masterId) continue
    const existing = detachedByMaster.get(masterId)
    if (existing) existing.push(event.recurrenceId)
    else detachedByMaster.set(masterId, [event.recurrenceId])
  }

  const payloads: MirrorEventPayload[] = []

  for (const event of events) {
    // The provider has no task or journal table; VTODO/VJOURNAL stay in Calino.
    if (event.type && event.type !== 'event') continue
    if (!calendarIds.has(event.calendarId)) continue
    // Cancelled detached occurrences exist only to blank out a slot, which
    // EXDATE already handles.
    if (event.eventStatus === 'CANCELLED') continue

    const rrule = event.recurrenceId ? undefined : rruleFor(event)
    const start = eventStartMs(event)
    const end = eventEndMs(event)

    // Bounded window applies to one-off events only; a series can extend
    // arbitrarily far and is cheap for the provider to expand.
    if (!rrule && (end < windowStart || start > windowEnd)) continue

    const exdates = [
      ...(event.excludedDates ?? []),
      ...(rrule ? (detachedByMaster.get(event.uid ?? event.id) ?? []) : []),
    ]

    const base: Omit<MirrorEventPayload, 'hash'> = {
      id: event.id,
      calendarId: event.calendarId,
      title: event.title || '(No title)',
      description: event.description,
      location: event.location,
      start,
      end,
      allDay: event.isAllDay,
      // The provider's all-day contract is UTC-anchored; timed events keep
      // their originating TZID so wall-clock survives a device timezone change.
      timezone: event.isAllDay ? 'UTC' : (event.timezone ?? deviceTimezone),
      transparency: event.transparency,
      rrule,
      duration: rrule ? toDuration(start, end, event.isAllDay) : undefined,
      exdate:
        rrule && exdates.length > 0
          ? exdates.map((iso) => toBasicFormat(iso, event.isAllDay)).join(',')
          : undefined,
      reminders: getEffectiveReminders(event, defaultReminderMinutes)
        // METHOD_ALERT is the only method we register on the calendar; an
        // email VALARM is the server's job, not the phone's.
        .filter((reminder) => reminder.method !== 'email')
        .map((reminder) => reminder.minutesBefore),
    }

    payloads.push({ ...base, hash: hashPayload(base) })
  }

  return { calendars: mirroredCalendars, events: payloads }
}

export async function syncCalendarMirror(
  events: CalendarEvent[],
  calendars: Calendar[],
  defaultReminderMinutes: number
): Promise<void> {
  if (!isCalendarMirrorSupported()) return
  const payload = buildMirrorPayload(events, calendars, defaultReminderMinutes)
  await CalendarMirror.sync(payload)
}
