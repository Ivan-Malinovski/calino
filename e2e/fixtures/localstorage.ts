import type { Page } from '@playwright/test'

// Storage keys MUST match what the Zustand stores persist with — see
// settingsStore.ts (`calino-settings`), credentials.ts (`calino_caldav_credentials`),
// accountStorage.ts (`calino_caldav_accounts`), calendarStore.ts (`calino-storage`).
// Keep them in sync here.
export const STORAGE_KEYS = {
  settings: 'calino-settings',
  credentials: 'calino_caldav_credentials',
  accounts: 'calino_caldav_accounts',
  calendar: 'calino-storage',
  cookieConsent: 'calino_cookie_notice',
} as const

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
        const parsed = raw ? JSON.parse(raw) : { state: {}, version: 1 }
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
 * Seed a CalDAV account in localStorage so the test can skip the add-account
 * flow and start from "calendar already connected". Writes both the account
 * metadata (`calino_caldav_accounts`) and the credential record
 * (`calino_caldav_credentials`) so the Sync page and the CalDAV client both
 * see the account.
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
  }
): Promise<string> {
  const accountId = account.id ?? cryptoRandomId()
  const credentialId = cryptoRandomId()
  const createdAt = new Date().toISOString()

  await page.addInitScript(
    ({
      flagKey,
      accountKey,
      credKey,
      accountsJson,
      credsJson,
    }: {
      flagKey: string
      accountKey: string
      credKey: string
      accountsJson: string
      credsJson: string
    }) => {
      try {
        if (sessionStorage.getItem(flagKey)) return
        sessionStorage.setItem(flagKey, '1')
        localStorage.setItem(accountKey, accountsJson)
        localStorage.setItem(credKey, credsJson)
      } catch {
        /* noop */
      }
    },
    {
      flagKey: `__calino_test_seeded_${accountId}`,
      accountKey: STORAGE_KEYS.accounts,
      credKey: STORAGE_KEYS.credentials,
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
    }
  )
  return accountId
}

function cryptoRandomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}
