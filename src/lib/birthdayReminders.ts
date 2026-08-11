import { v4 as uuidv4 } from 'uuid'
import type { CalendarEvent } from '@/types'
import { toLocalDateString } from './datetime'
import { makeDefaultReminders } from './notifications'

interface CreateBirthdayEventOptions {
  contactId: string
  contactName: string
  birthday: string // YYYY-MM-DD
  calendarId: string
  /** Seeds the same default reminder a new event gets in the modal. */
  defaultReminderMinutes: number | null
}

interface CreateAnniversaryEventOptions {
  contactId: string
  contactName: string
  anniversary: string // YYYY-MM-DD
  calendarId: string
  /** Seeds the same default reminder a new event gets in the modal. */
  defaultReminderMinutes: number | null
}

/**
 * Build the DTSTART date string (YYYY-MM-DD) for an annual event from a
 * MM/DD-bearing date. A fixed year is used — the yearly RRULE handles recurrence.
 */
function annualStartDateStr(date: string): string {
  const parts = date.split('-')
  const month = parseInt(parts[1] ?? '1', 10)
  const day = parseInt(parts[2] ?? '1', 10)
  const year = new Date().getFullYear()
  return toLocalDateString(new Date(year, month - 1, day))
}

/**
 * Create an annual recurring all-day event for a contact's birthday.
 */
export function createBirthdayEvent(options: CreateBirthdayEventOptions): CalendarEvent {
  const { contactId, contactName, birthday, calendarId, defaultReminderMinutes } = options

  const dateStr = annualStartDateStr(birthday)

  return {
    id: uuidv4(),
    calendarId,
    title: `🎂 ${contactName}'s birthday`,
    description: `Birthday of ${contactName}`,
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
    id: uuidv4(),
    calendarId,
    title: `💍 ${contactName}'s anniversary`,
    description: `Anniversary of ${contactName}`,
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
