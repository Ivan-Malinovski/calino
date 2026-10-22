import { createUuid } from '@/lib/uuid'
import i18n from '@/lib/i18n'
import type { CalendarEvent } from '@/types'
import { toLocalDateString } from './datetime'
import { makeDefaultReminders } from './notifications'

interface CreateBirthdayEventOptions {
  contactId: string
  contactName: string
  birthday: string // YYYY-MM-DD or --MM-DD
  calendarId: string
  /** Seeds the same default reminder a new event gets in the modal. */
  defaultReminderMinutes: number | null
}

interface CreateAnniversaryEventOptions {
  contactId: string
  contactName: string
  anniversary: string // YYYY-MM-DD or --MM-DD
  calendarId: string
  /** Seeds the same default reminder a new event gets in the modal. */
  defaultReminderMinutes: number | null
}

/**
 * Build the DTSTART date string (YYYY-MM-DD) for an annual event from a
 * MM/DD-bearing date. A fixed year is used — the yearly RRULE handles recurrence.
 */
function annualStartDateStr(date: string): string {
  const parts = date.split('-').slice(-2)
  const month = parseInt(parts[0] ?? '1', 10)
  const day = parseInt(parts[1] ?? '1', 10)
  let year = new Date().getFullYear()
  // Anchor February 29 in a leap year so yearly recurrence keeps its month/day.
  while (month === 2 && day === 29 && new Date(year, 1, 29).getMonth() !== 1) year++
  return toLocalDateString(new Date(year, month - 1, day))
}

/**
 * Create an annual recurring all-day event for a contact's birthday.
 */
export function createBirthdayEvent(options: CreateBirthdayEventOptions): CalendarEvent {
  const { contactId, contactName, birthday, calendarId, defaultReminderMinutes } = options

  const dateStr = annualStartDateStr(birthday)

  return {
    id: createUuid(),
    calendarId,
    title: i18n.t('calendar:ui.contactEvent.birthdayTitle', { name: contactName }),
    description: i18n.t('calendar:ui.contactEvent.birthdayDescription', { name: contactName }),
    start: `${dateStr}T00:00:00`,
    end: `${dateStr}T00:00:00`,
    isAllDay: true,
    recurrence: {
      frequency: 'yearly',
      interval: 1,
    },
    categories: ['birthday'],
    reminders: makeDefaultReminders(defaultReminderMinutes),
    // Link back to the contact
    url: `calino:contact:${contactId}`,
  }
}

/**
 * Check if a birthday event already exists for this contact.
 */
export function hasBirthdayEvent(contactId: string, events: CalendarEvent[]): boolean {
  return events.some((e) => e.url === `calino:contact:${contactId}`)
}

/**
 * Create an annual recurring all-day event for a contact's anniversary.
 */
export function createAnniversaryEvent(options: CreateAnniversaryEventOptions): CalendarEvent {
  const { contactId, contactName, anniversary, calendarId, defaultReminderMinutes } = options

  const dateStr = annualStartDateStr(anniversary)

  return {
    id: createUuid(),
    calendarId,
    title: i18n.t('calendar:ui.contactEvent.anniversaryTitle', { name: contactName }),
    description: i18n.t('calendar:ui.contactEvent.anniversaryDescription', { name: contactName }),
    start: `${dateStr}T00:00:00`,
    end: `${dateStr}T00:00:00`,
    isAllDay: true,
    recurrence: {
      frequency: 'yearly',
      interval: 1,
    },
    categories: ['anniversary'],
    reminders: makeDefaultReminders(defaultReminderMinutes),
    // Link back to the contact — distinct marker so it doesn't collide with birthday
    url: `calino:contact:${contactId}:anniversary`,
  }
}

/**
 * Check if an anniversary event already exists for this contact.
 */
export function hasAnniversaryEvent(contactId: string, events: CalendarEvent[]): boolean {
  return events.some((e) => e.url === `calino:contact:${contactId}:anniversary`)
}
