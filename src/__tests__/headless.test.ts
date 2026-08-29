import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CalendarEvent } from '@/types'
import type { HeadlessBridge } from '@/lib/headlessBridge'

const mockGetAllAccounts = vi.fn()
const mockGetAllCalendars = vi.fn()
const mockGetAllCredentials = vi.fn()
const mockFetchEvents = vi.fn()
const mockCreateClient = vi.fn()
const mockParse = vi.fn()

vi.mock('@/features/caldav/sync/accountStorage', () => ({
  getAllAccounts: () => mockGetAllAccounts(),
  getAllCalendars: () => mockGetAllCalendars(),
}))

vi.mock('@/features/caldav/client/credentials', () => ({
  getAllCredentials: () => mockGetAllCredentials(),
}))

vi.mock('@/features/caldav/client/CalDAVClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/caldav/client/CalDAVClient')>()
  return {
    ...actual,
    createCalDAVClient: (...args: unknown[]) => mockCreateClient(...args),
  }
})

vi.mock('@/features/caldav/adapter/iCalendarAdapter', () => ({
  parseICALDataAsync: (data: string, calendarId: string) => mockParse(data, calendarId),
}))

// Imported after the mocks are declared; the module only auto-runs when the
// native bridge is already on globalThis, which it is not at import time.
const { runHeadlessSync } = await import('../headless')

function bridgeStub(): HeadlessBridge & { synced: string[] } {
  const synced: string[] = []
  return {
    synced,
    davRequest: () => '{"ok":true}',
    mirrorSync: (payload: string) => {
      synced.push(payload)
      return '{"calendars":1,"written":1,"removed":0}'
    },
    log: () => {},
    finish: () => {},
  }
}

function event(id: string, calendarId: string): CalendarEvent {
  return {
    id,
    calendarId,
    title: id,
    start: '2026-08-10T09:00:00.000Z',
    end: '2026-08-10T09:30:00.000Z',
    isAllDay: false,
  }
}

// The shared test setup replaces localStorage with bare vi.fn()s, so back it
// with a real map here — this suite is specifically about what the headless
// page reads out of it and what it must not write back.
const stored = new Map<string, string>()

/** The app's persisted store, which the headless page reads but never writes. */
function persistCalendars(calendars: { id: string; isVisible: boolean }[]): void {
  stored.set(
    'calino-storage',
    JSON.stringify({
      state: {
        calendars: calendars.map((c) => ({ ...c, name: c.id, color: '#ff0000' })),
      },
    })
  )
}

let bridge: ReturnType<typeof bridgeStub>

describe('runHeadlessSync', () => {
  beforeEach(() => {
    stored.clear()
    vi.mocked(localStorage.getItem).mockImplementation((key: string) => stored.get(key) ?? null)
    vi.mocked(localStorage.setItem).mockClear()
    bridge = bridgeStub()
    ;(globalThis as { CalinoHeadless?: HeadlessBridge }).CalinoHeadless = bridge

    mockGetAllAccounts
      .mockReset()
      .mockReturnValue([
        {
          id: 'acct-1',
          name: 'Radicale',
          serverUrl: 'https://dav.test',
          proxyUrl: null,
          credentialId: 'cred-1',
        },
      ])
    mockGetAllCalendars
      .mockReset()
      .mockReturnValue([
        { id: 'cal-1', url: 'https://dav.test/cal-1/', name: 'Personal', accountId: 'acct-1' },
      ])
    mockGetAllCredentials.mockReset().mockResolvedValue([{ id: 'cred-1', password: 'pw' }])
    mockFetchEvents.mockReset().mockResolvedValue([{ url: 'a.ics', data: 'BEGIN:VCALENDAR' }])
    mockCreateClient.mockReset().mockResolvedValue({ fetchEvents: mockFetchEvents })
    mockParse.mockReset().mockImplementation((_data, calendarId) => [event('e1', calendarId)])

    persistCalendars([{ id: 'cal-1', isVisible: true }])
  })

  afterEach(() => {
    delete (globalThis as { CalinoHeadless?: HeadlessBridge }).CalinoHeadless
  })

  it('fetches visible calendars and writes them to the mirror', async () => {
    const result = await runHeadlessSync()

    expect(result).toEqual({ accounts: 1, calendars: 1, events: 1 })
    const payload = JSON.parse(bridge.synced[0]) as { events: { id: string }[] }
    expect(payload.events.map((e) => e.id)).toEqual(['e1'])
  })

  it('leaves hidden calendars alone', async () => {
    persistCalendars([{ id: 'cal-1', isVisible: false }])

    const result = await runHeadlessSync()

    expect(mockFetchEvents).not.toHaveBeenCalled()
    expect(bridge.synced).toEqual([])
    expect(result.calendars).toBe(0)
  })

  it('does not write an empty mirror when nothing could be fetched', async () => {
    // An empty payload is indistinguishable from "the user deleted everything",
    // and a partial reconcile would then wipe rows the app wrote correctly.
    mockCreateClient.mockRejectedValue(new Error('offline'))

    const result = await runHeadlessSync()

    expect(bridge.synced).toEqual([])
    expect(result.events).toBe(0)
  })

  it('still mirrors the calendars that succeeded when one fails', async () => {
    mockGetAllCalendars.mockReturnValue([
      { id: 'cal-1', url: 'https://dav.test/cal-1/', name: 'Personal', accountId: 'acct-1' },
      { id: 'cal-2', url: 'https://dav.test/cal-2/', name: 'Work', accountId: 'acct-1' },
    ])
    persistCalendars([
      { id: 'cal-1', isVisible: true },
      { id: 'cal-2', isVisible: true },
    ])
    mockFetchEvents.mockImplementation((url: string) => {
      if (url.endsWith('cal-2/')) return Promise.reject(new Error('500'))
      return Promise.resolve([{ url: 'a.ics', data: 'BEGIN:VCALENDAR' }])
    })

    const result = await runHeadlessSync()

    expect(result.calendars).toBe(1)
    const payload = JSON.parse(bridge.synced[0]) as { calendars: { id: string }[] }
    expect(payload.calendars.map((c) => c.id)).toEqual(['cal-1'])
  })

  it('never writes to the app store it reads from', async () => {
    // A background write would race the foreground app's in-memory zustand
    // copy, which only rehydrates at startup. The provider is the only thing
    // this page is allowed to mutate.
    await runHeadlessSync()
    expect(localStorage.setItem).not.toHaveBeenCalled()
  })

  it('surfaces a provider write failure so the worker retries', async () => {
    bridge.mirrorSync = () => '{"error":"provider exploded"}'
    await expect(runHeadlessSync()).rejects.toThrow('provider exploded')
  })
})
