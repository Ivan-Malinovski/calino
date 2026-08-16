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

describe('Phase 0 verification: Bug A — btoa() on non-Latin-1 credentials (FIXED in Phase 4)', () => {
  it('FIXED: the constructor accepts a password outside Latin-1', () => {
    // Was CURRENT (BUG): construction threw InvalidCharacterError. Fixed by
    // basicAuthHeader (UTF-8 encode before base64).
    expect(
      () =>
        new CalDAVClient('https://caldav.example.com', {
          ...baseCredentials,
          password: 'парол123',
        })
    ).not.toThrow()
  })

  it.each([
    ['Cyrillic', 'парол123'],
    ['CJK', '密码1234'],
    ['emoji', 'pw🔒123'],
  ])('FIXED: %s password no longer throws InvalidCharacterError', (_label, password) => {
    const client = new CalDAVClient('https://caldav.example.com', { ...baseCredentials, password })
    // The header must carry base64 of the UTF-8 bytes, not an exception.
    const expected = correctBasic('testuser', password)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((client as any).authHeader).toBe(`Basic ${expected}`)
  })

  it('FIXED: Latin-1 characters encode as UTF-8 bytes, not codepoints', () => {
    const client = new CalDAVClient('https://caldav.example.com', {
      ...baseCredentials,
      password: 'café',
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const produced = (client as any).authHeader.slice('Basic '.length)
    const correct = correctBasic('testuser', 'café')
    // Was silent mojibake (server saw 0xE9 instead of 0xC3 0xA9).
    expect(produced).toBe(correct)
    expect(produced).toBe('dGVzdHVzZXI6Y2Fmw6k=')
  })

  it("FIXED: 'ü' likewise passes without throwing", () => {
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

  it('FIXED: a Radicale calendar advertising VEVENT,VJOURNAL,VTODO keeps VJOURNAL', async () => {
    mockClientMethods.fetchCalendars.mockResolvedValue([
      {
        url: 'https://caldav.example.com/calendars/test/personal/',
        displayName: 'Personal',
        components: ['VEVENT', 'VJOURNAL', 'VTODO'],
      },
    ])

    await client.connect()
    const calendars = await client.fetchCalendars()

    expect(calendars[0].supportedComponents).toEqual(['VEVENT', 'VJOURNAL', 'VTODO'])
  })

  it('FIXED: a VJOURNAL-only collection yields ["VJOURNAL"]', async () => {
    mockClientMethods.fetchCalendars.mockResolvedValue([
      {
        url: 'https://caldav.example.com/calendars/test/journal/',
        displayName: 'Journal',
        components: ['VJOURNAL'],
      },
    ])

    await client.connect()
    const calendars = await client.fetchCalendars()

    expect(calendars[0].supportedComponents).toEqual(['VJOURNAL'])
  })

  it('FIXED: a calendar with no components property still yields undefined (unfiltered escape hatch)', async () => {
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
