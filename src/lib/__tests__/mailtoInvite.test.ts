import { describe, it, expect } from 'vitest'
import {
  buildMailtoUri,
  formatInviteBody,
  formatInviteForClipboard,
  MAILTO_MAX_LENGTH,
} from '../mailtoInvite'
import type { CalendarEvent } from '@/types'

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt-1',
    calendarId: 'cal-1',
    title: 'Sprint planning',
    start: '2026-03-10T09:00:00.000Z',
    end: '2026-03-10T10:30:00.000Z',
    isAllDay: false,
    attendees: [{ email: 'colleague@example.com', name: 'Sam Rivers' }],
    ...overrides,
  }
}

/** The URI's decoded body, for readable assertions. */
function bodyOf(uri: string): string {
  return decodeURIComponent(uri.split('&body=')[1] ?? '')
}

function subjectOf(uri: string): string {
  return decodeURIComponent((uri.split('?subject=')[1] ?? '').split('&body=')[0] ?? '')
}

describe('formatInviteBody', () => {
  it('leads with the title and lists when/where', () => {
    const body = formatInviteBody(makeEvent({ location: 'Room 4' }))

    expect(body).toContain("You're invited to: Sprint planning")
    expect(body).toContain('When: ')
    expect(body).toContain('Where: Room 4')
  })

  it('marks all-day events as such and omits clock times', () => {
    const body = formatInviteBody(
      makeEvent({ isAllDay: true, start: '2026-03-10T00:00:00.000Z', end: '2026-03-10T23:59:59.000Z' })
    )

    expect(body).toContain('(all day)')
    expect(body).not.toMatch(/\d{1,2}:\d{2}/)
  })

  it('respects the 12-hour preference', () => {
    expect(formatInviteBody(makeEvent(), { use24Hour: false })).toMatch(/\d{1,2}:\d{2} (AM|PM)/i)
    expect(formatInviteBody(makeEvent(), { use24Hour: true })).not.toMatch(/\d{1,2}:\d{2} (AM|PM)/i)
  })

  it('includes the organizer, link and description when present', () => {
    const body = formatInviteBody(
      makeEvent({
        organizer: { email: 'me@example.com', name: 'Ivan' },
        url: 'https://meet.example.com/abc',
        description: 'Bring the roadmap.',
      })
    )

    expect(body).toContain('Organizer: Ivan <me@example.com>')
    expect(body).toContain('Link: https://meet.example.com/abc')
    expect(body).toContain('Bring the roadmap.')
  })

  it('omits absent fields rather than printing empty labels', () => {
    const body = formatInviteBody(makeEvent())
    expect(body).not.toContain('Where:')
    expect(body).not.toContain('Link:')
    expect(body).not.toContain('Organizer:')
  })

  it('survives an unparseable date', () => {
    const body = formatInviteBody(makeEvent({ start: 'not-a-date', end: 'nope' }))
    expect(body).toContain("You're invited to")
    expect(body).not.toContain('Invalid')
  })
})

describe('buildMailtoUri', () => {
  it('addresses every attendee', () => {
    const result = buildMailtoUri(
      makeEvent({
        attendees: [{ email: 'a@example.com' }, { email: 'b@example.com' }],
      })
    )

    expect(result).not.toBeNull()
    expect(result!.uri.startsWith('mailto:a%40example.com,b%40example.com?')).toBe(true)
    expect(result!.recipients).toEqual(['a@example.com', 'b@example.com'])
  })

  it('returns null when there is nobody to write to', () => {
    expect(buildMailtoUri(makeEvent({ attendees: [] }))).toBeNull()
  })

  it('excludes the sender and de-duplicates', () => {
    const result = buildMailtoUri(
      makeEvent({
        attendees: [
          { email: 'me@example.com' },
          { email: 'ME@example.com' },
          { email: 'other@example.com' },
        ],
      }),
      undefined,
      undefined,
      { selfEmail: 'me@example.com' }
    )

    expect(result!.recipients).toEqual(['other@example.com'])
  })

  it('returns null when the only attendee is the sender', () => {
    expect(
      buildMailtoUri(makeEvent({ attendees: [{ email: 'me@example.com' }] }), undefined, undefined, {
        selfEmail: 'me@example.com',
      })
    ).toBeNull()
  })

  it('puts the title and time in the subject', () => {
    const subject = subjectOf(buildMailtoUri(makeEvent())!.uri)
    expect(subject).toContain('Invitation: Sprint planning')
    expect(subject).toContain('2026')
  })

  it('percent-encodes characters that would break the URI', () => {
    const result = buildMailtoUri(makeEvent({ title: 'Q&A: "scope" + risks?' }))!

    expect(result.uri).not.toContain('"')
    expect(result.uri.split('?subject=')[1]!.split('&body=')[0]).not.toContain('&')
    expect(subjectOf(result.uri)).toContain('Q&A: "scope" + risks?')
  })

  it('keeps newlines in the body intact through encoding', () => {
    expect(bodyOf(buildMailtoUri(makeEvent({ location: 'Room 4' }))!.uri)).toContain('\n')
  })

  it('stays under the length cap by trimming the description', () => {
    const result = buildMailtoUri(makeEvent({ description: 'x'.repeat(5000) }))!

    expect(result.uri.length).toBeLessThanOrEqual(MAILTO_MAX_LENGTH)
    expect(result.truncated).toBe(true)
    // The essentials survive the trim.
    expect(bodyOf(result.uri)).toContain('When: ')
  })

  it('drops the description entirely when even a trimmed one will not fit', () => {
    const result = buildMailtoUri(
      makeEvent({
        title: 'y'.repeat(700),
        location: 'z'.repeat(700),
        description: 'x'.repeat(5000),
      })
    )!

    expect(result.truncated).toBe(true)
    expect(bodyOf(result.uri)).not.toContain('xxxx')
  })

  it('does not flag truncation for an ordinary event', () => {
    const result = buildMailtoUri(makeEvent({ description: 'Short note.' }))!
    expect(result.truncated).toBe(false)
    expect(result.uri.length).toBeLessThanOrEqual(MAILTO_MAX_LENGTH)
  })

  it('accepts an explicit attendee list and organizer over the event fields', () => {
    const result = buildMailtoUri(
      makeEvent({ attendees: [{ email: 'stale@example.com' }] }),
      [{ email: 'fresh@example.com' }],
      { email: 'chair@example.com', name: 'Chair' }
    )!

    expect(result.recipients).toEqual(['fresh@example.com'])
    expect(bodyOf(result.uri)).toContain('Organizer: Chair <chair@example.com>')
  })
})

describe('formatInviteForClipboard', () => {
  it('renders recipients, subject and body as plain text', () => {
    const text = formatInviteForClipboard(buildMailtoUri(makeEvent())!)

    expect(text).toContain('To: colleague@example.com')
    expect(text).toContain('Subject: Invitation: Sprint planning')
    expect(text).toContain('When: ')
    // Nothing percent-encoded — this goes to a human, not to a URI parser.
    expect(text).not.toContain('%20')
  })

  it('keeps the full description even when the mailto: had to truncate it', () => {
    const description = 'x'.repeat(4000)
    const result = buildMailtoUri(makeEvent({ description }))!

    expect(result.truncated).toBe(true)
    expect(formatInviteForClipboard(result)).toContain(description)
  })
})
