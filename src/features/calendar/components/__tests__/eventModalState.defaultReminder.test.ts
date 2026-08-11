import { describe, it, expect } from 'vitest'
import { getInitialFormState } from '../eventModalState'
import type { CalendarEvent } from '@/types'

/**
 * The "Default Reminder" setting seeds the new-event form and does nothing else.
 *
 * It used to be substituted at notify time instead: an event with no reminders
 * still fired one, so the modal showed no reminder chips while the event
 * notified anyway, and deleting the last chip had no effect — an empty list
 * couldn't be told apart from one that was never set. Seeding the form makes
 * the chips the single source of truth, which is what these tests pin.
 */
describe('default reminder seeding', () => {
  const calendars = [{ id: 'cal1', isDefault: true }]

  const newEvent = (defaultReminderMinutes: number | null) =>
    getInitialFormState(
      true,
      null,
      '2026-06-15',
      null,
      [],
      calendars,
      [],
      60,
      defaultReminderMinutes
    )

  it('seeds a new event with the default reminder', () => {
    expect(newEvent(30).reminders).toEqual([{ id: 'default', minutesBefore: 30, method: 'popup' }])
  })

  it('seeds "At time of event" rather than treating 0 as absent', () => {
    expect(newEvent(0).reminders).toEqual([{ id: 'default', minutesBefore: 0, method: 'popup' }])
  })

  it('seeds nothing when the default is None', () => {
    expect(newEvent(null).reminders).toEqual([])
  })

  it('keeps the seeded id stable so the chip survives a re-computation', () => {
    expect(newEvent(15).reminders[0].id).toBe(newEvent(15).reminders[0].id)
  })

  it('leaves an existing event alone — its own reminders are the truth', () => {
    const existing: CalendarEvent = {
      id: 'evt1',
      calendarId: 'cal1',
      title: 'Standup',
      start: '2026-06-15T09:00:00',
      end: '2026-06-15T09:30:00',
      isAllDay: false,
      type: 'event',
      reminders: [{ id: 'a', minutesBefore: 5, method: 'popup' }],
    }
    const state = getInitialFormState(true, 'evt1', null, null, [existing], calendars, [], 60, 30)

    expect(state.reminders).toEqual([{ id: 'a', minutesBefore: 5, method: 'popup' }])
  })

  it('does not re-seed an event whose reminders were cleared', () => {
    const cleared: CalendarEvent = {
      id: 'evt2',
      calendarId: 'cal1',
      title: 'Quiet one',
      start: '2026-06-15T09:00:00',
      end: '2026-06-15T09:30:00',
      isAllDay: false,
      type: 'event',
      reminders: [],
    }
    const state = getInitialFormState(true, 'evt2', null, null, [cleared], calendars, [], 60, 30)

    expect(state.reminders).toEqual([])
  })
})
