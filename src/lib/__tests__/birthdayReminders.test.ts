import { describe, it, expect } from 'vitest'
import {
  createBirthdayEvent,
  hasBirthdayEvent,
  createAnniversaryEvent,
  hasAnniversaryEvent,
} from '../birthdayReminders'

describe('createAnniversaryEvent', () => {
  it('creates an annual all-day event on the anniversary month/day', () => {
    const event = createAnniversaryEvent({
      contactId: 'c1',
      contactName: 'Alex',
      anniversary: '2010-06-15',
      calendarId: 'cal1',
      defaultReminderMinutes: null,
    })

    expect(event.isAllDay).toBe(true)
    expect(event.recurrence).toEqual({ frequency: 'yearly', interval: 1 })
    expect(event.categories).toEqual(['anniversary'])
    expect(event.title).toContain('Alex')
    // DTSTART uses the current year but preserves month/day
    expect(event.start.slice(5, 10)).toBe('06-15')
  })

  it('uses a distinct link marker from birthday', () => {
    const event = createAnniversaryEvent({
      contactId: 'c1',
      contactName: 'Alex',
      anniversary: '2010-06-15',
      calendarId: 'cal1',
      defaultReminderMinutes: null,
    })
    expect(event.url).toBe('calino:contact:c1:anniversary')
  })
})

describe('hasBirthdayEvent / hasAnniversaryEvent do not collide', () => {
  it('distinguishes birthday and anniversary events for the same contact', () => {
    const birthday = createBirthdayEvent({
      contactId: 'c1',
      contactName: 'Alex',
      birthday: '1990-01-02',
      calendarId: 'cal1',
      defaultReminderMinutes: null,
    })
    const anniversary = createAnniversaryEvent({
      contactId: 'c1',
      contactName: 'Alex',
      anniversary: '2010-06-15',
      calendarId: 'cal1',
      defaultReminderMinutes: null,
    })

    // Only birthday present
    expect(hasBirthdayEvent('c1', [birthday])).toBe(true)
    expect(hasAnniversaryEvent('c1', [birthday])).toBe(false)

    // Only anniversary present
    expect(hasAnniversaryEvent('c1', [anniversary])).toBe(true)
    expect(hasBirthdayEvent('c1', [anniversary])).toBe(false)

    // Both present
    const both = [birthday, anniversary]
    expect(hasBirthdayEvent('c1', both)).toBe(true)
    expect(hasAnniversaryEvent('c1', both)).toBe(true)
  })
})

describe('contact events take the default reminder', () => {
  // These are created straight from the contact list, never through the event
  // modal, so they have to seed the default themselves — otherwise the setting
  // silently doesn't apply to the one kind of event Calino creates for you.
  it('seeds a birthday event with the default reminder', () => {
    const event = createBirthdayEvent({
      contactId: 'c1',
      contactName: 'Alex',
      birthday: '1990-01-02',
      calendarId: 'cal1',
      defaultReminderMinutes: 1440,
    })
    expect(event.reminders).toEqual([{ id: 'default', minutesBefore: 1440, method: 'popup' }])
  })

  it('seeds an anniversary event with the default reminder', () => {
    const event = createAnniversaryEvent({
      contactId: 'c1',
      contactName: 'Alex',
      anniversary: '2010-06-15',
      calendarId: 'cal1',
      defaultReminderMinutes: 60,
    })
    expect(event.reminders).toEqual([{ id: 'default', minutesBefore: 60, method: 'popup' }])
  })

  it('leaves them reminder-less when the default is None', () => {
    const event = createBirthdayEvent({
      contactId: 'c1',
      contactName: 'Alex',
      birthday: '1990-01-02',
      calendarId: 'cal1',
      defaultReminderMinutes: null,
    })
    expect(event.reminders).toEqual([])
  })
})
