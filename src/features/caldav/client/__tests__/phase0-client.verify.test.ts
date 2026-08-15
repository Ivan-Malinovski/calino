import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CalDAVClient } from '../CalDAVClient'
import type { CalDAVCredentials } from '../../types'

vi.mock('tsdav', () => ({
  createDAVClient: vi.fn(),
}))

const mockCreateDAVClient = vi.mocked(await import('tsdav').then((m) => m.createDAVClient))

const mockClientMethods = {
  fetchCalendars: vi.fn(),
  fetchCalendarObjects: vi.fn(),
  createCalendarObject: vi.fn(),
  updateCalendarObject: vi.fn(),
  deleteCalendarObject: vi.fn(),
  davRequest: vi.fn(),
} as any

const baseCredentials: CalDAVCredentials = {
  id: 'cred-1',
  serverUrl: 'https://caldav.example.com',
  username: 'testuser',
  password: 'testpass',
}

/**
 * Correct behaviour for Basic auth with non-ASCII credentials is to encode the
 * `user:pass` string as UTF-8 *bytes* and base64 those bytes, e.g.
 *
 *   const bytes = new TextEncoder().encode(`${username}:${password}`)
 *   const b64 = btoa(String.fromCharCode(...bytes))
 *
 * `btoa(str)` instead treats each code unit as one byte: it throws for any code
 * point > U+00FF and silently produces Latin-1 (not UTF-8) bytes for U+0080..U+00FF.
 */
function correctBasic(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`)
  return btoa(String.fromCharCode(...bytes))
}

describe('Phase 0 verification: Bug A — btoa() on non-Latin-1 credentials', () => {
  it('CURRENT (BUG): the constructor throws for a password outside Latin-1', () => {
    // CORRECT behaviour: construction succeeds and the header carries
    // base64 of the UTF-8 bytes. Flip this to `.not.toThrow()` when fixed.
    expect(
      () =>
        new CalDAVClient('https://caldav.example.com', {
          ...baseCredentials,
          password: 'парол123',
        })
    ).toThrow()
  })

  it.each([
    ['Cyrillic', 'парол123'],
    ['CJK', '密码1234'],
    ['emoji', 'pw🔒123'],
  ])('CURRENT (BUG): %s password throws InvalidCharacterError', (_label, password) => {
    let caught: unknown
    try {
      new CalDAVClient('https://caldav.example.com', { ...baseCredentials, password })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
    const err = caught as Error
    // jsdom throws a DOMException named InvalidCharacterError — an opaque
    // low-level failure with no mention of the password or of CalDAV.
    expect(err.name).toBe('InvalidCharacterError')
    expect(err.message).toMatch(/not a valid latin1|character/i)
    expect(err.message).not.toMatch(/password/i)
  })

  it('CURRENT: a Latin-1 password (café / ü) does NOT throw, but encodes Latin-1 bytes, not UTF-8', () => {
    const password = 'café'
    const client = new CalDAVClient('https://caldav.example.com', {
      ...baseCredentials,
      password,
    })
    expect(client).toBeInstanceOf(CalDAVClient)

    const produced = btoa(`testuser:${password}`)
    const correct = correctBasic('testuser', password)
    // CURRENT (BUG): silent mojibake — server sees 0xE9 instead of 0xC3 0xA9.
    // CORRECT: produced should equal `correct`. Flip to toBe when fixed.
    expect(produced).not.toBe(correct)
    expect(produced).toBe('dGVzdHVzZXI6Y2Fm6Q==')
    expect(correct).toBe('dGVzdHVzZXI6Y2Fmw6k=')

    // 'ü' likewise passes btoa without throwing
    expect(
      () => new CalDAVClient('https://caldav.example.com', { ...baseCredentials, password: 'über' })
    ).not.toThrow()
  })
})

describe('Phase 0 verification: Bug B — fetchCalendars() drops VJOURNAL', () => {
  let client: CalDAVClient

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    mockCreateDAVClient.mockResolvedValue(mockClientMethods)
    client = new CalDAVClient('https://caldav.example.com', baseCredentials)
  })

  it('CURRENT (BUG): a Radicale calendar advertising VEVENT,VJOURNAL,VTODO loses VJOURNAL', async () => {
    mockClientMethods.fetchCalendars.mockResolvedValue([
      {
        url: 'https://caldav.example.com/calendars/test/personal/',
        displayName: 'Personal',
        components: ['VEVENT', 'VJOURNAL', 'VTODO'],
      },
    ])

    await client.connect()
    const calendars = await client.fetchCalendars()

    // CORRECT: ['VEVENT', 'VJOURNAL', 'VTODO']
    expect(calendars[0].supportedComponents).toEqual(['VEVENT', 'VTODO'])
    expect(calendars[0].supportedComponents).not.toContain('VJOURNAL')
  })

  it('CURRENT (BUG): a VJOURNAL-only collection yields a truthy empty array', async () => {
    mockClientMethods.fetchCalendars.mockResolvedValue([
      {
        url: 'https://caldav.example.com/calendars/test/journal/',
        displayName: 'Journal',
        components: ['VJOURNAL'],
      },
    ])

    await client.connect()
    const calendars = await client.fetchCalendars()

    // CORRECT: ['VJOURNAL']
    expect(calendars[0].supportedComponents).toEqual([])
    // Truthy, so the `!calendar.supportedComponents` escape hatch used by
    // EventModal/TodoView/EventCard does NOT fire; every includes() check fails.
    expect(Boolean(calendars[0].supportedComponents)).toBe(true)
    expect(calendars[0].supportedComponents?.includes('VEVENT')).toBe(false)
    expect(calendars[0].supportedComponents?.includes('VTODO')).toBe(false)
  })

  it('CURRENT: a calendar with no components property still yields undefined (unfiltered escape hatch)', async () => {
    mockClientMethods.fetchCalendars.mockResolvedValue([
      { url: 'https://caldav.example.com/calendars/test/plain/', displayName: 'Plain' },
    ])

    await client.connect()
    const calendars = await client.fetchCalendars()

    expect(calendars[0].supportedComponents).toBeUndefined()
  })

  it('CURRENT (BUG): downstream filter — a VJOURNAL-only calendar is excluded from the event/task pickers', async () => {
    mockClientMethods.fetchCalendars.mockResolvedValue([
      {
        url: 'https://caldav.example.com/calendars/test/journal/',
        displayName: 'Journal',
        components: ['VJOURNAL'],
      },
    ])

    await client.connect()
    const calendars = await client.fetchCalendars()

    // Mirrors EventModal.tsx:117-121 / TodoView.tsx:371 / EventCard.tsx:720
    const compatible = (required: 'VEVENT' | 'VTODO') =>
      calendars.filter((c) => !c.supportedComponents || c.supportedComponents.includes(required))

    // CORRECT once VJOURNAL is preserved: this stays empty for VEVENT/VTODO
    // (a journal-only collection genuinely cannot hold them), but the calendar
    // must be selectable in the journal UI, which has no component filter at all.
    expect(compatible('VEVENT')).toHaveLength(0)
    expect(compatible('VTODO')).toHaveLength(0)
  })
})
