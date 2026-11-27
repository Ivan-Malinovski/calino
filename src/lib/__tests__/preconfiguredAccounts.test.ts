import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createLocalStorageMock } from '@/test/storageMock'
import {
  calendarPath,
  calendarHasUnsyncedEvents,
  extendCalendarSelection,
  filterSelectedCalendars,
  isSameLogin,
  isSameUrlPath,
  preconfiguredSecretHash,
  readPreconfiguredRegistry,
  removableDuplicates,
  sameCalendarSelection,
  writePreconfiguredRegistry,
} from '../preconfiguredAccounts'

const calendars = [
  { name: 'Personal', url: 'https://dav.example.com/calendars/me/personal/' },
  { name: 'Work', url: 'https://dav.example.com/calendars/me/work/' },
  { name: 'Calino Settings', url: 'https://dav.example.com/calendars/me/calino-settings/' },
]

const storage = createLocalStorageMock()

describe('preconfiguredAccounts', () => {
  beforeEach(() => storage.install())
  afterEach(() => {
    vi.restoreAllMocks()
    storage.reset()
  })

  it('normalizes absolute and relative collection URLs to one path', () => {
    expect(calendarPath('https://a.example/cal/My%20Cal/')).toBe('/cal/My Cal')
    expect(calendarPath('/cal/My Cal')).toBe('/cal/My Cal')
  })

  it('keeps every calendar without a selection', () => {
    expect(filterSelectedCalendars(calendars, undefined, undefined)).toHaveLength(3)
  })

  it('keeps only selected calendars plus the settings calendar', () => {
    const kept = filterSelectedCalendars(calendars, undefined, [
      { name: 'Work', url: '/calendars/me/work' },
    ])
    expect(kept.map((c) => c.name)).toEqual(['Work', 'Calino Settings'])
  })

  it('falls back to the name when a selected URL is no longer listed', () => {
    const kept = filterSelectedCalendars(calendars, undefined, [
      { name: 'Personal', url: 'https://dav.example.com/old/path/' },
    ])
    expect(kept.map((c) => c.name)).toEqual(['Personal', 'Calino Settings'])
  })

  it('reads the selection from the registry by account id', () => {
    writePreconfiguredRegistry({
      acc1: {
        configUrl: 'https://dav.example.com',
        username: 'me',
        secretHash: 'x',
        calendars: [{ name: 'Personal', url: '/calendars/me/personal/' }],
      },
    })
    expect(readPreconfiguredRegistry().acc1.username).toBe('me')
    expect(filterSelectedCalendars(calendars, 'acc1').map((c) => c.name)).toEqual([
      'Personal',
      'Calino Settings',
    ])
    expect(filterSelectedCalendars(calendars, 'other')).toHaveLength(3)
  })

  it('compares selections regardless of order and URL form', () => {
    const a = [
      { name: 'A', url: 'https://x/a/' },
      { name: 'B', url: 'https://x/b/' },
    ]
    const b = [
      { name: 'B', url: '/b' },
      { name: 'A', url: '/a' },
    ]
    expect(sameCalendarSelection(a, b)).toBe(true)
    expect(sameCalendarSelection(a, undefined)).toBe(false)
    expect(sameCalendarSelection(undefined, undefined)).toBe(true)
  })

  it('changes the secret hash when the password changes', async () => {
    const one = await preconfiguredSecretHash({ name: 'n', password: 'p1' })
    const two = await preconfiguredSecretHash({ name: 'n', password: 'p2' })
    expect(one).not.toBe(two)
    expect(one).toBe(await preconfiguredSecretHash({ name: 'n', password: 'p1' }))
  })
})

describe('matching a stored account to a config entry', () => {
  const stored = { serverUrl: 'https://davis.example.org/dav', username: 'chris' }

  it('treats the same username on the same server as the same login', () => {
    // Discovery stores the resolved URL without its trailing slash.
    expect(isSameLogin(stored, 'https://davis.example.org/dav/', 'chris')).toBe(true)
    expect(isSameLogin(stored, 'https://DAVIS.example.org/', 'chris')).toBe(true)
  })

  it('keeps different users and different servers apart', () => {
    expect(isSameLogin(stored, 'https://davis.example.org/dav/', 'someone')).toBe(false)
    expect(isSameLogin(stored, 'https://other.example.org/dav/', 'chris')).toBe(false)
    expect(isSameLogin(stored, 'not a url', 'chris')).toBe(false)
  })

  it('compares paths ignoring a trailing slash', () => {
    expect(isSameUrlPath('https://davis.example.org/dav', 'https://davis.example.org/dav/')).toBe(
      true
    )
    expect(isSameUrlPath('https://davis.example.org/dav', 'https://davis.example.org/')).toBe(false)
  })
})

describe('removableDuplicates', () => {
  const calendarsOf = (id: string) => [`${id}-cal`]

  it('drops every copy except the kept one', () => {
    const copies = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(removableDuplicates(copies, 'a', calendarsOf, [])).toEqual(['b', 'c'])
  })

  it('keeps a copy holding changes that never reached the server', () => {
    const copies = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const events = [
      { calendarId: 'b-cal', syncStatus: 'pending' },
      { calendarId: 'c-cal', syncStatus: 'synced' },
    ]
    expect(removableDuplicates(copies, 'a', calendarsOf, events)).toEqual(['c'])
  })

  it('treats a failed upload as unsynced too', () => {
    const events = [{ calendarId: 'b-cal', syncStatus: 'failed' }]
    expect(removableDuplicates([{ id: 'a' }, { id: 'b' }], 'a', calendarsOf, events)).toEqual([])
  })
})

describe('calendarHasUnsyncedEvents', () => {
  it('flags a calendar with a pending change', () => {
    const events = [{ calendarId: 'c1', syncStatus: 'pending' }]
    expect(calendarHasUnsyncedEvents(events, 'c1')).toBe(true)
  })

  it('flags a calendar with a failed upload', () => {
    const events = [{ calendarId: 'c1', syncStatus: 'failed' }]
    expect(calendarHasUnsyncedEvents(events, 'c1')).toBe(true)
  })

  it('does not flag a fully synced calendar', () => {
    const events = [{ calendarId: 'c1', syncStatus: 'synced' }]
    expect(calendarHasUnsyncedEvents(events, 'c1')).toBe(false)
  })
})

describe('extendCalendarSelection', () => {
  it('adds a collection to a restricted selection and persists it', () => {
    writePreconfiguredRegistry({
      a1: {
        configUrl: 'https://dav.example.com/dav',
        username: 'me',
        secretHash: 'x',
        calendars: [{ url: 'https://dav.example.com/dav/work/', name: 'Work' }],
      },
    })
    const added = extendCalendarSelection('a1', {
      url: 'https://dav.example.com/dav/journal/',
      name: 'Journal',
    })
    expect(added).toBe(true)
    expect(readPreconfiguredRegistry().a1.calendars?.map((c) => c.name)).toEqual([
      'Work',
      'Journal',
    ])
  })

  it('is a no-op when the account has no selection', () => {
    writePreconfiguredRegistry({
      a1: { configUrl: 'https://dav.example.com/dav', username: 'me', secretHash: 'x' },
    })
    expect(
      extendCalendarSelection('a1', { url: 'https://dav.example.com/dav/new/', name: 'New' })
    ).toBe(false)
    expect(readPreconfiguredRegistry().a1.calendars).toBeUndefined()
  })

  it('is idempotent on a known URL', () => {
    const entry = { url: 'https://dav.example.com/dav/work/', name: 'Work' }
    writePreconfiguredRegistry({
      a1: {
        configUrl: 'https://dav.example.com/dav',
        username: 'me',
        secretHash: 'x',
        calendars: [entry],
      },
    })
    expect(extendCalendarSelection('a1', entry)).toBe(false)
    expect(readPreconfiguredRegistry().a1.calendars).toHaveLength(1)
  })
})
