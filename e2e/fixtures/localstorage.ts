import type { Page } from '@playwright/test'

// Storage keys MUST match what the Zustand stores persist with — see
// settingsStore.ts (`calino-settings`), credentials.ts (`calino_caldav_credentials`),
// accountStorage.ts (`calino_caldav_accounts`), calendarStore.ts (`calino-storage`).
// Keep them in sync here.
export const STORAGE_KEYS = {
  settings: 'calino-settings',
  credentials: 'calino_caldav_credentials',
  accounts: 'calino_caldav_accounts',
  caldavCalendars: 'calino_caldav_calendars',
  calendar: 'calino-storage',
  contacts: 'calino-contacts',
  cookieConsent: 'calino_cookie_notice',
} as const

interface ContactSeed {
  /** vCard UID. `Contact.id` IS the UID, so this is what RELATED/MEMBER reference. */
  id: string
  displayName: string
  addressBookId: string
  related?: Array<{ value: string; type: string; isPrimary?: boolean }>
  isGroup?: boolean
  memberUids?: string[]
}

interface AddressBookSeed {
  id: string
  name: string
}

interface RecurringEventSeed {
  id: string
  title: string
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  startTime: string // HH:MM
  endTime: string // HH:MM
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'
  interval: number
}

interface CalendarCapabilitySeed {
  id: string
  name: string
  components: ('VEVENT' | 'VTODO')[]
  isDefault?: boolean
}

export async function seedCalendarCapabilities(
  page: Page,
  calendars: CalendarCapabilitySeed[]
): Promise<void> {
  await page.addInitScript(
    ({ calendarKey, calendars }: { calendarKey: string; calendars: CalendarCapabilitySeed[] }) => {
      try {
        if (sessionStorage.getItem('__calino_test_calendar_capabilities')) return
        sessionStorage.setItem('__calino_test_calendar_capabilities', '1')
        const raw = localStorage.getItem(calendarKey)
        const parsed = raw ? JSON.parse(raw) : { state: {}, version: 1 }
        parsed.state = {
          ...(parsed.state ?? {}),
          calendars: calendars.map((calendar, index) => ({
            id: calendar.id,
            name: calendar.name,
            color: '#4285F4',
            isVisible: true,
            isDefault: calendar.isDefault ?? index === 0,
            showTasksInViews: true,
            supportedComponents: calendar.components,
          })),
        }
        localStorage.setItem(calendarKey, JSON.stringify(parsed))
      } catch {
        /* noop */
      }
    },
    { calendarKey: STORAGE_KEYS.calendar, calendars }
  )
}

/**
 * Seed a recurring event directly into the calendar store's persistence
 * key (`calino-storage`). The store rehydrates from this on mount, so the
 * event shows up in views without going through NLP or CalDAV.
 *
 * Uses a sessionStorage one-shot flag so reloads within the same test
 * don't re-seed (which would duplicate events).
 */
export async function seedRecurringEvent(
  page: Page,
  seed: RecurringEventSeed
): Promise<void> {
  const flagKey = `__calino_test_event_${seed.id}`
  const event = {
    id: seed.id,
    title: seed.title,
    type: 'event',
    start: `${seed.startDate}T${seed.startTime}:00.000Z`,
    end: `${seed.endDate}T${seed.endTime}:00.000Z`,
    allDay: false,
    calendarId: 'default',
    recurrence: {
      frequency: seed.frequency,
      interval: seed.interval,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  await page.addInitScript(
    ({ flagKey, calendarKey, event }: { flagKey: string; calendarKey: string; event: unknown }) => {
      try {
        if (sessionStorage.getItem(flagKey)) return
        sessionStorage.setItem(flagKey, '1')
        const raw = localStorage.getItem(calendarKey)
        const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
        const events = parsed.state?.events ?? []
        events.push(event)
        parsed.state = { ...(parsed.state ?? {}), events }
        localStorage.setItem(calendarKey, JSON.stringify(parsed))
      } catch {
        /* noop */
      }
    },
    { flagKey, calendarKey: STORAGE_KEYS.calendar, event }
  )
}

interface JournalSeed {
  /** Calendars to install, in sidebar order. First is the default. */
  calendars: { id: string; name: string }[]
  /** Journal entries, each pinned to one of the seeded calendars. */
  entries: { id: string; title: string; body: string; date: string; calendarId: string }[]
}

/**
 * Seed calendars plus journal entries and turn the Journal view on.
 *
 * Journal entries are ordinary events with `type: 'journal'`, so they go into
 * the same `calino-storage` bucket; the extra work here is flipping
 * `journalEnabled` in settings, since the view is hidden until the first
 * VJOURNAL arrives from a server.
 */
export async function seedJournal(page: Page, seed: JournalSeed): Promise<void> {
  const now = new Date().toISOString()
  const calendars = seed.calendars.map((calendar, index) => ({
    id: calendar.id,
    name: calendar.name,
    color: index === 0 ? '#4285F4' : '#E8710A',
    isVisible: true,
    isDefault: index === 0,
    showTasksInViews: true,
  }))
  const events = seed.entries.map((entry) => ({
    id: entry.id,
    calendarId: entry.calendarId,
    title: entry.title,
    description: entry.body,
    start: entry.date,
    end: entry.date,
    isAllDay: true,
    type: 'journal',
    created: now,
    lastModified: now,
  }))

  await page.addInitScript(
    ({
      calendarKey,
      settingsKey,
      calendars,
      events,
    }: {
      calendarKey: string
      settingsKey: string
      calendars: unknown[]
      events: unknown[]
    }) => {
      try {
        if (sessionStorage.getItem('__calino_test_journal')) return
        sessionStorage.setItem('__calino_test_journal', '1')

        const raw = localStorage.getItem(calendarKey)
        const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
        parsed.state = { ...(parsed.state ?? {}), calendars, events }
        localStorage.setItem(calendarKey, JSON.stringify(parsed))

        const settingsRaw = localStorage.getItem(settingsKey)
        const settings = settingsRaw ? JSON.parse(settingsRaw) : { state: {}, version: 1 }
        settings.state = { ...(settings.state ?? {}), journalEnabled: true }
        localStorage.setItem(settingsKey, JSON.stringify(settings))
      } catch {
        /* noop */
      }
    },
    { calendarKey: STORAGE_KEYS.calendar, settingsKey: STORAGE_KEYS.settings, calendars, events }
  )
}

/**
 * Wipes Calino state and dismisses onboarding + cookie consent.
 *
 * Runs ONCE per test — uses a flag in `window` to avoid wiping state on
 * subsequent reloads within the same test. (addInitScript would otherwise
 * re-run on every navigation, which breaks tests that intentionally
 * reload to verify localStorage round-trips.)
 */
export async function clearState(page: Page): Promise<void> {
  await page.addInitScript((keys: typeof STORAGE_KEYS) => {
    // Use sessionStorage as the one-shot flag — it survives `page.reload()`
    // but is cleared when the test ends (or the browser tab is closed).
    try {
      if (sessionStorage.getItem('__calino_test_cleaned')) return
      sessionStorage.setItem('__calino_test_cleaned', '1')
      for (const key of Object.values(keys)) localStorage.removeItem(key)
      // Mark onboarding complete + dismiss cookie consent so the page
      // boots straight into the calendar.
      const settingsRaw = localStorage.getItem(keys.settings)
      const parsed = settingsRaw ? JSON.parse(settingsRaw) : { state: {}, version: 1 }
      parsed.state = { ...(parsed.state ?? {}), hasCompletedOnboarding: true }
      localStorage.setItem(keys.settings, JSON.stringify(parsed))
      localStorage.setItem(keys.cookieConsent, 'dismissed')
    } catch {
      /* noop */
    }
  }, STORAGE_KEYS)
}

/**
 * Seed contacts and address books into `calino-contacts` so contact specs can
 * start from a populated address book. Fills in the `Contact` fields the store
 * and UI require but that individual specs rarely care about.
 *
 * Uses the same one-shot sessionStorage flag pattern as the other seeders so
 * the data survives a reload within one test.
 */
export async function seedContacts(
  page: Page,
  addressBooks: AddressBookSeed[],
  contacts: ContactSeed[]
): Promise<void> {
  await page.addInitScript(
    ({ key, addressBooks: books, contacts: seeds }) => {
      try {
        if (sessionStorage.getItem('__calino_test_contacts_seeded')) return
        sessionStorage.setItem('__calino_test_contacts_seeded', '1')
        const now = new Date().toISOString()
        const state = {
          addressBooks: books.map((b) => ({
            id: b.id,
            accountId: 'contacts-account-1',
            url: `https://dav.example/${b.id}/`,
            name: b.name,
            description: '',
            ctag: null,
            syncToken: null,
            isVisible: true,
          })),
          contacts: seeds.map((c) => ({
            id: c.id,
            addressBookId: c.addressBookId,
            accountId: 'contacts-account-1',
            url: `https://dav.example/${c.addressBookId}/${c.id}.vcf`,
            displayName: c.displayName,
            familyName: c.displayName.split(' ').slice(1).join(' '),
            givenName: c.displayName.split(' ')[0],
            additionalNames: '',
            prefixes: '',
            suffixes: '',
            nickname: '',
            organization: '',
            department: '',
            title: '',
            note: '',
            categories: [],
            photo: null,
            birthday: '',
            anniversary: '',
            emails: [],
            phones: [],
            addresses: [],
            urls: [],
            ims: [],
            langs: [],
            related: (c.related ?? []).map((r) => ({
              value: r.value,
              type: r.type,
              isPrimary: r.isPrimary ?? false,
            })),
            isGroup: c.isGroup ?? false,
            memberUids: c.memberUids ?? [],
            xmlData: null,
            opaqueLines: [],
            createdAt: now,
            updatedAt: now,
          })),
          pendingChanges: [],
        }
        localStorage.setItem(key, JSON.stringify({ state, version: 2 }))
      } catch {
        /* noop */
      }
    },
    { key: STORAGE_KEYS.contacts, addressBooks, contacts }
  )
}

/**
 * Seed a CalDAV account in localStorage so the test can skip the add-account
 * flow and start from "calendar already connected". Writes the account
 * metadata (`calino_caldav_accounts`), the credential record
 * (`calino_caldav_credentials`), and a matching calendar record
 * (`calino_caldav_calendars`) so the Sync page and the CalDAV client both
 * see the account, and `useSettingsSync`'s `getCalendarsByAccountId` lookup
 * (used to derive the calendar-home URL for settings-calendar discovery)
 * doesn't come back empty.
 *
 * Uses a one-shot flag so the seed survives reloads within the same test
 * (otherwise addInitScript runs again and clearState would wipe it).
 */
export async function seedAccount(
  page: Page,
  account: {
    id?: string
    name: string
    serverUrl: string
    username: string
    password: string
    /**
     * Collections to seed for this account. Defaults to the single
     * `Personal` calendar every existing spec relies on — pass this only
     * when a spec needs more than one collection (e.g. a move target).
     */
    calendars?: Array<{
      id?: string
      name: string
      path: string
      isDefault?: boolean
      color?: string
      supportedComponents?: string[]
    }>
  }
): Promise<string> {
  const accountId = account.id ?? cryptoRandomId()
  const credentialId = cryptoRandomId()
  const createdAt = new Date().toISOString()
  const calendarSeeds = account.calendars ?? [
    { name: 'Personal', path: 'calendars/user/personal/', isDefault: true },
  ]

  await page.addInitScript(
    ({
      flagKey,
      accountKey,
      credKey,
      calendarKey,
      accountsJson,
      credsJson,
      calendarsJson,
    }: {
      flagKey: string
      accountKey: string
      credKey: string
      calendarKey: string
      accountsJson: string
      credsJson: string
      calendarsJson: string
    }) => {
      try {
        if (sessionStorage.getItem(flagKey)) return
        sessionStorage.setItem(flagKey, '1')
        // Append rather than overwrite so a spec can seed more than one
        // account (cross-account flows). Single-account specs are
        // unaffected — the keys start empty after `clearState`.
        const append = (key: string, json: string) => {
          let existing: unknown[] = []
          try {
            const raw = localStorage.getItem(key)
            const parsed = raw ? JSON.parse(raw) : []
            if (Array.isArray(parsed)) existing = parsed
          } catch {
            /* noop */
          }
          localStorage.setItem(key, JSON.stringify([...existing, ...JSON.parse(json)]))
        }
        append(accountKey, accountsJson)
        append(credKey, credsJson)
        append(calendarKey, calendarsJson)
      } catch {
        /* noop */
      }
    },
    {
      flagKey: `__calino_test_seeded_${accountId}`,
      accountKey: STORAGE_KEYS.accounts,
      credKey: STORAGE_KEYS.credentials,
      calendarKey: STORAGE_KEYS.caldavCalendars,
      accountsJson: JSON.stringify([
        {
          id: accountId,
          name: account.name,
          serverUrl: account.serverUrl,
          proxyUrl: null,
          username: account.username,
          credentialId,
          createdAt,
          lastSyncAt: null,
        },
      ]),
      credsJson: JSON.stringify([
        {
          id: credentialId,
          serverUrl: account.serverUrl,
          username: account.username,
          password: account.password,
        },
      ]),
      calendarsJson: JSON.stringify(
        calendarSeeds.map((calendar, index) => ({
          id: calendar.id ?? cryptoRandomId(),
          accountId,
          url: `${account.serverUrl}${calendar.path}`,
          name: calendar.name,
          color: calendar.color ?? '#4285F4',
          ctag: null,
          syncToken: null,
          isVisible: true,
          isDefault: calendar.isDefault ?? index === 0,
          supportedComponents: calendar.supportedComponents ?? ['VEVENT'],
        }))
      ),
    }
  )
  return accountId
}

function cryptoRandomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}
