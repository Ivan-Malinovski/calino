import { describe, it, expect } from 'vitest'
import { accountOrganizer, organizerForSave, type OrganizerAccount } from '../defaultOrganizer'
import { calendarEventToIcalComponent } from '@/features/caldav/adapter/icalTypeMapping'
import { patchICALData } from '@/features/caldav/adapter/icalPatch'
import type { CalendarEvent } from '@/types'

function account(overrides: Partial<OrganizerAccount> = {}): OrganizerAccount {
  return { protocol: 'caldav', username: 'alex', ...overrides }
}

const ATTENDEES = [{ email: 'sam@example.com' }]

describe('accountOrganizer', () => {
  it('uses the calendar user address the principal reported', () => {
    expect(
      accountOrganizer(account({ username: 'alex', calendarUserAddress: 'alex@example.com' }))
    ).toEqual({ email: 'alex@example.com' })
  })

  it('prefers that address over a username that is also an email address', () => {
    expect(
      accountOrganizer(
        account({ username: 'login@example.com', calendarUserAddress: 'alex@example.org' })
      )
    ).toEqual({ email: 'alex@example.org' })
  })

  it('falls back to an email-address username when the server reported none', () => {
    expect(
      accountOrganizer(account({ username: 'alex@example.com', calendarUserAddress: null }))
    ).toEqual({ email: 'alex@example.com' })
    // Accounts stored before the address was kept have not been asked yet.
    expect(accountOrganizer(account({ username: ' alex@example.com ' }))).toEqual({
      email: 'alex@example.com',
    })
  })

  it('has no organizer when neither the server nor the username gives an address', () => {
    expect(accountOrganizer(account({ username: 'alex', calendarUserAddress: null }))).toBe(
      undefined
    )
    expect(accountOrganizer(account({ username: 'alex@localhost' }))).toBe(undefined)
    expect(accountOrganizer(undefined)).toBe(undefined)
  })

  it('names the organizer after the principal display name', () => {
    expect(
      accountOrganizer(
        account({ calendarUserAddress: 'alex@example.com', principalDisplayName: ' Alex Doe ' })
      )
    ).toEqual({ email: 'alex@example.com', name: 'Alex Doe' })
  })

  it('omits a display name that only repeats the address', () => {
    expect(
      accountOrganizer(
        account({
          calendarUserAddress: 'alex@example.com',
          principalDisplayName: 'Alex@Example.com',
        })
      )
    ).toEqual({ email: 'alex@example.com' })
  })

  it('uses the participant identity of a JMAP account', () => {
    expect(
      accountOrganizer(
        account({
          protocol: 'jmap',
          username: 'login',
          calendarUserAddress: 'alex@example.com',
          principalDisplayName: 'Alex',
        })
      )
    ).toEqual({ email: 'alex@example.com', name: 'Alex' })
  })

  it('does not guess a JMAP identity from the username', () => {
    expect(accountOrganizer(account({ protocol: 'jmap', username: 'alex@example.com' }))).toBe(
      undefined
    )
  })

  it('treats an account without a protocol as CalDAV', () => {
    expect(
      accountOrganizer(account({ protocol: undefined, username: 'alex@example.com' }))
    ).toEqual({ email: 'alex@example.com' })
  })
})

describe('organizerForSave', () => {
  const user = account({ calendarUserAddress: 'alex@example.com' })

  it('sets the account user as organizer of an event with attendees', () => {
    expect(organizerForSave(undefined, ATTENDEES, user)).toEqual({ email: 'alex@example.com' })
  })

  it('keeps an existing organizer, which may be someone else', () => {
    const boss = { email: 'boss@example.com', name: 'Boss' }
    expect(organizerForSave(boss, ATTENDEES, user)).toBe(boss)
  })

  it('does not add an organizer to an event without attendees', () => {
    expect(organizerForSave(undefined, [], user)).toBe(undefined)
  })

  it('leaves the organizer unset when the account gives no address', () => {
    expect(organizerForSave(undefined, ATTENDEES, account({ calendarUserAddress: null }))).toBe(
      undefined
    )
    // A local calendar has no account at all.
    expect(organizerForSave(undefined, ATTENDEES, undefined)).toBe(undefined)
  })
})

describe('iCal output', () => {
  function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
    return {
      id: 'evt-1',
      uid: 'evt-1',
      calendarId: 'cal-1',
      title: 'Planning',
      start: '2026-03-10T09:00:00.000Z',
      end: '2026-03-10T10:00:00.000Z',
      isAllDay: false,
      attendees: ATTENDEES,
      ...overrides,
    }
  }
  const unfold = (ics: string) => ics.replace(/\r?\n[ \t]/g, '')

  it('writes ORGANIZER with CN on a new event with attendees', () => {
    const organizer = organizerForSave(
      undefined,
      ATTENDEES,
      account({ calendarUserAddress: 'alex@example.com', principalDisplayName: 'Alex Doe' })
    )
    const ics = unfold(calendarEventToIcalComponent(makeEvent({ organizer })).toString())

    expect(ics).toContain('ORGANIZER;CN=Alex Doe:mailto:alex@example.com')
    expect(ics).toContain('ATTENDEE:mailto:sam@example.com')
  })

  it('writes ORGANIZER without CN when there is no display name', () => {
    const organizer = organizerForSave(
      undefined,
      ATTENDEES,
      account({ username: 'alex@example.com' })
    )
    const ics = unfold(calendarEventToIcalComponent(makeEvent({ organizer })).toString())

    expect(ics).toMatch(/^ORGANIZER:mailto:alex@example\.com$/m)
  })

  it('adds ORGANIZER when patching a stored resource that has attendees but none', () => {
    const original = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Other Client//EN',
      'BEGIN:VEVENT',
      'UID:evt-1',
      'DTSTAMP:20260101T120000Z',
      'DTSTART:20260310T090000Z',
      'DTEND:20260310T100000Z',
      'SUMMARY:Planning',
      'ATTENDEE:mailto:sam@example.com',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const organizer = organizerForSave(
      undefined,
      ATTENDEES,
      account({ calendarUserAddress: 'alex@example.com' })
    )
    const patched = unfold(patchICALData(original, [makeEvent({ organizer })])!)

    expect(patched).toMatch(/^ORGANIZER:mailto:alex@example\.com$/m)
    expect(patched.match(/^ORGANIZER/gm)).toHaveLength(1)
  })

  it('writes no ORGANIZER for an event without attendees', () => {
    const organizer = organizerForSave(
      undefined,
      [],
      account({ calendarUserAddress: 'alex@example.com' })
    )
    const ics = calendarEventToIcalComponent(
      makeEvent({ attendees: undefined, organizer })
    ).toString()

    expect(ics).not.toContain('ORGANIZER')
  })
})
