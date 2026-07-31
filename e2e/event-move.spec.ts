import { test, expect, type Page } from '@playwright/test'
import { clearState, seedAccount, STORAGE_KEYS } from './fixtures/localstorage'

/**
 * Regression coverage for #86 — "events can't be moved between calendars".
 *
 * Changing the calendar in the event modal updates locally but the write
 * lands back in the original CalDAV collection, so the next sync reverts it.
 * These specs assert on the mock server's own storage (`__test__/dump`)
 * rather than on what the UI happens to render, so a purely local change
 * cannot make them pass.
 */

const SOURCE = '/dav/calendars/user/move-source/'
const WORK = '/dav/calendars/user/work/'
const B_PERSONAL = '/dav/calendars/userb/personal/'

const CAL_SOURCE = 'cal-a-source'
const CAL_WORK = 'cal-a-work'
const CAL_B_PERSONAL = 'cal-b-personal'

interface StoreCalendarSeed {
  id: string
  name: string
  color: string
  isDefault?: boolean
}

/**
 * The calendar `<select>` in the event modal renders `calendarStore`
 * calendars, and `seedAccount` only primes the CalDAV calendar list. Seed
 * the store too so the target calendars are selectable before the first
 * sync has run.
 */
async function seedStoreCalendars(page: Page, calendars: StoreCalendarSeed[]): Promise<void> {
  await page.addInitScript(
    ({ calendarKey, calendars }: { calendarKey: string; calendars: StoreCalendarSeed[] }) => {
      try {
        if (sessionStorage.getItem('__calino_test_move_calendars')) return
        sessionStorage.setItem('__calino_test_move_calendars', '1')
        const raw = localStorage.getItem(calendarKey)
        const parsed = raw ? JSON.parse(raw) : { state: {}, version: 1 }
        parsed.state = {
          ...(parsed.state ?? {}),
          calendars: calendars.map((calendar, index) => ({
            id: calendar.id,
            name: calendar.name,
            color: calendar.color,
            isVisible: true,
            isDefault: calendar.isDefault ?? index === 0,
            showTasksInViews: true,
            supportedComponents: ['VEVENT', 'VTODO', 'VJOURNAL'],
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

async function seedAccountA(page: Page, baseURL: string): Promise<void> {
  await seedAccount(page, {
    id: 'move-account-a',
    name: 'Mock A',
    serverUrl: `${baseURL}/mock-caldav/dav/`,
    username: 'user',
    password: 'pass',
    calendars: [
      {
        id: CAL_SOURCE,
        name: 'Move Source',
        path: 'calendars/user/move-source/',
        isDefault: true,
        color: '#8B5CF6',
        supportedComponents: ['VEVENT', 'VTODO', 'VJOURNAL'],
      },
      {
        id: CAL_WORK,
        name: 'Work',
        path: 'calendars/user/work/',
        color: '#EF4444',
        supportedComponents: ['VEVENT', 'VTODO', 'VJOURNAL'],
      },
    ],
  })
}

/**
 * Snapshot the mock's stored resources under a collection prefix.
 *
 * The mock CalDAV server shares a dev server with the whole suite, and under
 * parallel load that server can reset a connection mid-request (ECONNRESET).
 * A raw throw inside expect.poll fails the test instantly instead of retrying,
 * so this absorbs transient resets and returns null when the connection never
 * came back — every poll matcher treats null as "not the target state yet"
 * and tries again. Callers coerce with `?? {}`.
 */
async function dump(
  page: Page,
  baseURL: string,
  prefix: string
): Promise<Record<string, string> | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await page.request.get(
        `${baseURL}/mock-caldav/__test__/dump?prefix=${encodeURIComponent(prefix)}`
      )
      return (await response.json()) as Record<string, string>
    } catch {
      if (attempt === 2) return null
      await page.waitForTimeout(250)
    }
  }
  return null
}

const icalStamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace('.000', '')

/** Open the event card's modal via the preview popup. */
async function openEventModal(page: Page, title: string): Promise<void> {
  const card = page.locator('[data-component="event-card"]').filter({ hasText: title }).first()
  await expect(card).toBeVisible({ timeout: 15_000 })
  await card.click()
  await page
    .locator('[data-component="event-preview"]')
    .getByRole('button', { name: /Open event/i })
    .click()
  await expect(page.locator('[data-component="event-calendar-select"]')).toBeVisible()
}

async function syncAll(page: Page): Promise<void> {
  const syncButton = page.locator('[data-component="sync-all-calendars"]')
  await expect(syncButton).toBeEnabled({ timeout: 15_000 })
  await syncButton.click()
  // `.first()`: a move whose cleanup DELETE failed also raises its own warning
  // toast, so more than one toast can be on screen and a bare locator trips
  // strict mode.
  await expect(
    page.getByText(/All calendars synced\.|Calendars are already syncing\.|Sync failed/).first()
  ).toBeVisible({ timeout: 15_000 })
}

test.describe('moving events between calendars', () => {
  // Every test writes to the same fixed collections on the process-wide mock
  // store, so they cannot run against each other's leftovers. The
  // collections used here (`move-source/`, `work/`, account B's `personal/`)
  // belong to this spec alone, so the resets below cannot disturb the specs
  // that share `personal/` while running in parallel.
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page, baseURL }) => {
    for (const prefix of [SOURCE, WORK, B_PERSONAL]) {
      await page.request.post(
        `${baseURL!}/mock-caldav/__test__/reset?prefix=${encodeURIComponent(prefix)}`
      )
    }
  })

  test('moves an event to another calendar and it stays there after a sync', async ({
    page,
    baseURL,
  }) => {
    await clearState(page)
    await seedAccountA(page, baseURL!)
    await seedStoreCalendars(page, [
      { id: CAL_SOURCE, name: 'Move Source', color: '#8B5CF6', isDefault: true },
      { id: CAL_WORK, name: 'Work', color: '#EF4444' },
    ])

    const start = new Date()
    start.setUTCHours(12, 0, 0, 0)
    await page.request.put(`${baseURL}/mock-caldav${SOURCE}simple-move.ics`, {
      data: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:simple-move\r\nDTSTART:${icalStamp(start)}\r\nDTEND:${icalStamp(new Date(start.getTime() + 3_600_000))}\r\nSUMMARY:Movable event\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`,
    })

    await page.goto('/month')
    await syncAll(page)

    await openEventModal(page, 'Movable event')
    await page.locator('[data-component="event-calendar-select"]').selectOption(CAL_WORK)
    await page.locator('[data-component="modal-save"]').click()

    // Server-side placement is the assertion that matters: the ICS must be
    // under `work/` and gone from the source collection.
    await expect
      .poll(async () => Object.keys((await dump(page, baseURL!, WORK)) ?? {}).length, { timeout: 15_000 })
      .toBe(1)
    const workDump = (await dump(page, baseURL!, WORK)) ?? {}
    expect(Object.values(workDump).join('')).toContain('UID:simple-move')
    // Source cleanup follows the destination write, so poll for it rather
    // than sampling mid-flight (the race that flaked the series test).
    await expect
      .poll(async () => Object.keys((await dump(page, baseURL!, SOURCE)) ?? {}).length, {
        timeout: 15_000,
      })
      .toBe(0)

    // And it survives a full sync round-trip, rendered exactly once.
    await syncAll(page)
    await expect(
      page.locator('[data-component="event-card"]').filter({ hasText: 'Movable event' })
    ).toHaveCount(1, { timeout: 15_000 })
    expect(Object.keys((await dump(page, baseURL!, WORK)) ?? {})).toHaveLength(1)
    // Polled rather than one-shot: a transient connection reset makes dump
    // return null (coerced to {}), which would false-pass a toEqual({}).
    await expect
      .poll(async () => Object.keys((await dump(page, baseURL!, SOURCE)) ?? {}).length, {
        timeout: 15_000,
      })
      .toBe(0)
  })

  test('moves a recurring series together with its detached override', async ({
    page,
    baseURL,
  }) => {
    await clearState(page)
    await seedAccountA(page, baseURL!)
    await seedStoreCalendars(page, [
      { id: CAL_SOURCE, name: 'Move Source', color: '#8B5CF6', isDefault: true },
      { id: CAL_WORK, name: 'Work', color: '#EF4444' },
    ])

    const first = new Date()
    first.setUTCHours(9, 0, 0, 0)
    const second = new Date(first)
    second.setUTCDate(second.getUTCDate() + 7)
    const overrideStart = new Date(second)
    overrideStart.setUTCHours(11, 0, 0, 0)

    await page.request.put(`${baseURL}/mock-caldav${SOURCE}series-move.ics`, {
      data:
        `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n` +
        `BEGIN:VEVENT\r\nUID:series-move\r\nDTSTART:${icalStamp(first)}\r\nDTEND:${icalStamp(new Date(first.getTime() + 3_600_000))}\r\nRRULE:FREQ=WEEKLY\r\nSUMMARY:Weekly standup\r\nEND:VEVENT\r\n` +
        `BEGIN:VEVENT\r\nUID:series-move\r\nRECURRENCE-ID:${icalStamp(second)}\r\nDTSTART:${icalStamp(overrideStart)}\r\nDTEND:${icalStamp(new Date(overrideStart.getTime() + 3_600_000))}\r\nSUMMARY:Weekly standup (moved week)\r\nEND:VEVENT\r\n` +
        `END:VCALENDAR\r\n`,
    })

    await page.goto('/month')
    await syncAll(page)

    await openEventModal(page, 'Weekly standup')
    await page.locator('[data-component="event-calendar-select"]').selectOption(CAL_WORK)
    await page.locator('[data-component="modal-save"]').click()

    const recurrenceDialog = page.getByRole('dialog').filter({ hasText: /Edit recurring event/i })
    // The dialog is rendered by React after save, so it can lag a click under
    // load — waiting on an instant isVisible() check raced the render and
    // skipped 'All events', moving a single occurrence instead of the series.
    // It only ever appears when the modal opened on the recurring master;
    // opening on a detached occurrence saves directly, so fall back silently.
    try {
      await recurrenceDialog.waitFor({ state: 'visible', timeout: 5_000 })
      await recurrenceDialog.getByRole('button', { name: /All events/i }).click()
    } catch {
      /* occurrence-only path: the save already proceeded */
    }

    // Wait for the FULL end state on both sides: the old poll settled on the
    // first resource landing in work/, while the series' second occurrence
    // and the source delete were still in flight — flaky under suite load.
    await expect
      .poll(
        async () =>
          Object.values((await dump(page, baseURL!, WORK)) ?? {})
            .join('\n')
            .match(/UID:series-move/g)?.length ?? 0,
        { timeout: 15_000 }
      )
      .toBe(2)

    const workIcs = Object.values((await dump(page, baseURL!, WORK)) ?? {}).join('\n')
    // The master AND its detached override must both land in `work/`.
    expect(workIcs).toContain('RECURRENCE-ID:')
    expect(workIcs).toContain('RRULE:FREQ=WEEKLY')
    await expect
      .poll(async () => Object.keys((await dump(page, baseURL!, SOURCE)) ?? {}).length, {
        timeout: 15_000,
      })
      .toBe(0)
  })

  test('moves an event across accounts', async ({ page, baseURL }) => {
    await clearState(page)
    await seedAccountA(page, baseURL!)
    await seedAccount(page, {
      id: 'move-account-b',
      name: 'Mock B',
      serverUrl: `${baseURL}/mock-caldav-b/dav/`,
      username: 'userb',
      password: 'pass',
      calendars: [
        {
          id: CAL_B_PERSONAL,
          name: 'Second account',
          path: 'calendars/userb/personal/',
          color: '#10B981',
          supportedComponents: ['VEVENT', 'VTODO', 'VJOURNAL'],
        },
      ],
    })
    await seedStoreCalendars(page, [
      { id: CAL_SOURCE, name: 'Move Source', color: '#8B5CF6', isDefault: true },
      { id: CAL_WORK, name: 'Work', color: '#EF4444' },
      { id: CAL_B_PERSONAL, name: 'Second account', color: '#10B981' },
    ])

    const start = new Date()
    start.setUTCHours(14, 0, 0, 0)
    await page.request.put(`${baseURL}/mock-caldav${SOURCE}cross-account.ics`, {
      data: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:cross-account\r\nDTSTART:${icalStamp(start)}\r\nDTEND:${icalStamp(new Date(start.getTime() + 3_600_000))}\r\nSUMMARY:Cross account event\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`,
    })

    await page.goto('/month')
    await syncAll(page)

    await openEventModal(page, 'Cross account event')
    await page.locator('[data-component="event-calendar-select"]').selectOption(CAL_B_PERSONAL)
    await page.locator('[data-component="modal-save"]').click()

    await expect
      .poll(async () => Object.keys((await dump(page, baseURL!, B_PERSONAL)) ?? {}).length, {
        timeout: 15_000,
      })
      .toBe(1)
    expect(Object.values((await dump(page, baseURL!, B_PERSONAL)) ?? {}).join('')).toContain(
      'UID:cross-account'
    )
    await expect
      .poll(async () => Object.keys((await dump(page, baseURL!, SOURCE)) ?? {}).length, {
        timeout: 15_000,
      })
      .toBe(0)
  })

  test('a failed cleanup DELETE never leaves the event in two calendars', async ({
    page,
    baseURL,
  }) => {
    await clearState(page)
    await seedAccountA(page, baseURL!)
    await seedStoreCalendars(page, [
      { id: CAL_SOURCE, name: 'Move Source', color: '#8B5CF6', isDefault: true },
      { id: CAL_WORK, name: 'Work', color: '#EF4444' },
    ])

    const start = new Date()
    start.setUTCHours(16, 0, 0, 0)
    await page.request.put(`${baseURL}/mock-caldav${SOURCE}flaky-cleanup.ics`, {
      data: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:flaky-cleanup\r\nDTSTART:${icalStamp(start)}\r\nDTEND:${icalStamp(new Date(start.getTime() + 3_600_000))}\r\nSUMMARY:Flaky cleanup event\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`,
    })

    await page.goto('/month')
    await syncAll(page)

    // Arm the fault injector: the cleanup DELETE on the source collection
    // fails, so the move is only half-complete on the server.
    await page.request.post(
      `${baseURL}/mock-caldav/__test__/fail?method=DELETE&prefix=${encodeURIComponent(SOURCE)}&count=1`
    )

    await openEventModal(page, 'Flaky cleanup event')
    await page.locator('[data-component="event-calendar-select"]').selectOption(CAL_WORK)
    await page.locator('[data-component="modal-save"]').click()

    await expect
      .poll(async () => Object.keys((await dump(page, baseURL!, WORK)) ?? {}).length, { timeout: 15_000 })
      .toBe(1)

    await syncAll(page)
    await syncAll(page)

    // Exactly one instance, and it lives on Work — the stale source copy
    // must not resurrect it.
    await expect(
      page.locator('[data-component="event-card"]').filter({ hasText: 'Flaky cleanup event' })
    ).toHaveCount(1, { timeout: 15_000 })
    expect(Object.keys((await dump(page, baseURL!, WORK)) ?? {})).toHaveLength(1)
    // The stale source copy is removed by the retried cleanup; poll because
    // the retry is chained through syncAccount's processPendingChanges call.
    await expect
      .poll(async () => Object.keys((await dump(page, baseURL!, SOURCE)) ?? {}).length, {
        timeout: 15_000,
      })
      .toBe(0)
  })

  test('a failed destination write never deletes the source copy', async ({ page, baseURL }) => {
    await clearState(page)
    await seedAccountA(page, baseURL!)
    await seedStoreCalendars(page, [
      { id: CAL_SOURCE, name: 'Move Source', color: '#8B5CF6', isDefault: true },
      { id: CAL_WORK, name: 'Work', color: '#EF4444' },
    ])

    const start = new Date()
    start.setUTCHours(15, 0, 0, 0)
    await page.request.put(`${baseURL}/mock-caldav${SOURCE}flaky-destination.ics`, {
      data: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:flaky-destination\r\nDTSTART:${icalStamp(start)}\r\nDTEND:${icalStamp(new Date(start.getTime() + 3_600_000))}\r\nSUMMARY:Flaky destination event\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`,
    })

    await page.goto('/month')
    await syncAll(page)

    // Arm the fault injector: the destination PUT fails once. Without a
    // res.ok check on PUT this "succeeds" silently and the move would delete
    // the source — losing the event from BOTH calendars.
    await page.request.post(
      `${baseURL}/mock-caldav/__test__/fail?method=PUT&prefix=${encodeURIComponent(WORK)}&count=1`
    )

    await openEventModal(page, 'Flaky destination event')
    await page.locator('[data-component="event-calendar-select"]').selectOption(CAL_WORK)
    await page.locator('[data-component="modal-save"]').click()

    // The queued move is replayed by the next sync's processPendingChanges.
    await syncAll(page)

    await expect
      .poll(async () => Object.keys((await dump(page, baseURL!, WORK)) ?? {}).length, {
        timeout: 15_000,
      })
      .toBe(1)
    expect(Object.values((await dump(page, baseURL!, WORK)) ?? {}).join('')).toContain(
      'UID:flaky-destination'
    )
    await expect
      .poll(async () => Object.keys((await dump(page, baseURL!, SOURCE)) ?? {}).length, {
        timeout: 15_000,
      })
      .toBe(0)

    await syncAll(page)
    await expect(
      page.locator('[data-component="event-card"]').filter({ hasText: 'Flaky destination event' })
    ).toHaveCount(1, { timeout: 15_000 })
  })

  test('a failed destination write still moves a recurring series with its detached override', async ({
    page,
    baseURL,
  }) => {
    await clearState(page)
    await seedAccountA(page, baseURL!)
    await seedStoreCalendars(page, [
      { id: CAL_SOURCE, name: 'Move Source', color: '#8B5CF6', isDefault: true },
      { id: CAL_WORK, name: 'Work', color: '#EF4444' },
    ])

    const first = new Date()
    first.setUTCHours(10, 0, 0, 0)
    const second = new Date(first)
    second.setUTCDate(second.getUTCDate() + 7)
    const overrideStart = new Date(second)
    overrideStart.setUTCHours(12, 0, 0, 0)

    await page.request.put(`${baseURL}/mock-caldav${SOURCE}series-flaky-destination.ics`, {
      data:
        `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n` +
        `BEGIN:VEVENT\r\nUID:series-flaky-destination\r\nDTSTART:${icalStamp(first)}\r\nDTEND:${icalStamp(new Date(first.getTime() + 3_600_000))}\r\nRRULE:FREQ=WEEKLY\r\nSUMMARY:Weekly flaky\r\nEND:VEVENT\r\n` +
        `BEGIN:VEVENT\r\nUID:series-flaky-destination\r\nRECURRENCE-ID:${icalStamp(second)}\r\nDTSTART:${icalStamp(overrideStart)}\r\nDTEND:${icalStamp(new Date(overrideStart.getTime() + 3_600_000))}\r\nSUMMARY:Weekly flaky (moved week)\r\nEND:VEVENT\r\n` +
        `END:VCALENDAR\r\n`,
    })

    await page.goto('/month')
    await syncAll(page)

    await page.request.post(
      `${baseURL}/mock-caldav/__test__/fail?method=PUT&prefix=${encodeURIComponent(WORK)}&count=1`
    )

    await openEventModal(page, 'Weekly flaky')
    await page.locator('[data-component="event-calendar-select"]').selectOption(CAL_WORK)
    await page.locator('[data-component="modal-save"]').click()

    const recurrenceDialog = page.getByRole('dialog').filter({ hasText: /Edit recurring event/i })
    // Same dialog race as the live series test: wait for it instead of
    // checking isVisible() the instant after save.
    try {
      await recurrenceDialog.waitFor({ state: 'visible', timeout: 5_000 })
      await recurrenceDialog.getByRole('button', { name: /All events/i }).click()
    } catch {
      /* occurrence-only path: the save already proceeded */
    }

    await syncAll(page)

    // The queued move's replay lands the whole group; wait for both VEVENTs
    // rather than the first resource (same flake class as the live series test).
    await expect
      .poll(
        async () =>
          Object.values((await dump(page, baseURL!, WORK)) ?? {})
            .join('\n')
            .match(/UID:series-flaky-destination/g)?.length ?? 0,
        { timeout: 15_000 }
      )
      .toBe(2)

    const workIcs = Object.values((await dump(page, baseURL!, WORK)) ?? {}).join('\n')
    // Master AND its detached override must both land — a queued move that
    // dropped the overrides would write a single VEVENT here.
    expect(workIcs.match(/UID:series-flaky-destination/g) ?? []).toHaveLength(2)
    expect(workIcs).toContain('RECURRENCE-ID:')
    expect(workIcs).toContain('RRULE:FREQ=WEEKLY')
    await expect
      .poll(async () => Object.keys((await dump(page, baseURL!, SOURCE)) ?? {}).length, {
        timeout: 15_000,
      })
      .toBe(0)
  })
})
