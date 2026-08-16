import { test, expect, type Page } from '@playwright/test'
import { clearState, seedAccount, STORAGE_KEYS } from './fixtures/localstorage'

/**
 * Phase 3 — queued CalDAV edits are never lost.
 *
 * 1. An edit whose PUT fails (fault injection) survives locally, is queued,
 *    and lands once the server recovers.
 * 2. A stale-etag 412 is recovered by re-fetching the current etag and
 *    re-applying once, instead of replaying the dead If-Match forever.
 *
 * Owns the `/dav/calendars/user/sync-queue/` collection, like event-move owns
 * move-source/: resets scoped to it never race the specs sharing `personal/`.
 */

const SQ_PATH = '/dav/calendars/user/sync-queue/'
const CAL_SQ = 'cal-sync-queue'

interface StoreCalendarSeed {
  id: string
  name: string
  color: string
  isDefault?: boolean
}

/**
 * The calendar `<select>` in the event modal renders `calendarStore`
 * calendars, and `seedAccount` only primes the CalDAV calendar list. Seed
 * the store too so the select is populated before the first sync has run.
 */
async function seedStoreCalendars(page: Page, calendars: StoreCalendarSeed[]): Promise<void> {
  await page.addInitScript(
    ({ calendarKey, calendars }: { calendarKey: string; calendars: StoreCalendarSeed[] }) => {
      try {
        if (sessionStorage.getItem('__calino_test_sq_calendars')) return
        sessionStorage.setItem('__calino_test_sq_calendars', '1')
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

async function seedAccountSQ(page: Page, baseURL: string): Promise<void> {
  await seedAccount(page, {
    id: 'sync-queue-account',
    name: 'Mock A',
    serverUrl: `${baseURL}/mock-caldav/dav/`,
    username: 'user',
    password: 'pass',
    calendars: [
      {
        id: CAL_SQ,
        name: 'Sync Queue',
        path: 'calendars/user/sync-queue/',
        isDefault: true,
        color: '#4285F4',
        supportedComponents: ['VEVENT', 'VTODO', 'VJOURNAL'],
      },
    ],
  })
}

/**
 * Snapshot the mock's stored resources under a collection prefix.
 * Absorbs transient dev-server resets like event-move.spec.ts does.
 */
async function dump(
  page: Page,
  baseURL: string,
  prefix: string
): Promise<Record<string, string> | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await page.request.get(
        `${baseURL}/mock-caldav/__test__/dump?prefix=${encodeURIComponent(prefix)}`,
      )
      return (await response.json()) as Record<string, string>
    } catch {
      if (attempt === 2) return null
      await page.waitForTimeout(250)
    }
  }
  return null
}

const icalStamp = (date: Date) =>
  date.toISOString().replace(/[-:]/g, '').replace('.000', '')

async function triggerSync(page: Page): Promise<void> {
  const syncButton = page.locator('[data-component="sync-all-calendars"]')
  await expect(syncButton).toBeEnabled({ timeout: 15_000 })
  await syncButton.click()
}

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

test.describe('queued edits survive failed writes', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page, baseURL }) => {
    await page.request.post(
      `${baseURL!}/mock-caldav/__test__/reset?prefix=${encodeURIComponent(SQ_PATH)}`,
    )
  })

  test('an edit made while PUTs fail is queued and lands once writes recover', async ({
    page,
    baseURL,
  }) => {
    await clearState(page)
    await seedAccountSQ(page, baseURL!)
    await seedStoreCalendars(page, [
      { id: CAL_SQ, name: 'Sync Queue', color: '#4285F4', isDefault: true },
    ])

    const start = new Date()
    start.setUTCHours(10, 0, 0, 0)
    await page.request.put(`${baseURL}/mock-caldav${SQ_PATH}queue-edit.ics`, {
      data:
        `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:queue-edit\r\nDTSTART:${icalStamp(start)}\r\nDTEND:${icalStamp(new Date(start.getTime() + 3_600_000))}\r\nSUMMARY:Queue edit event\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`,
    })

    await page.goto('/month')
    await triggerSync(page)
    await expect(
      page.locator('[data-component="event-card"]').filter({ hasText: 'Queue edit event' })
    ).toBeVisible({ timeout: 15_000 })

    // Arm the fault injector: the next PUT to this collection returns 500.
    await page.request.post(
      `${baseURL}/mock-caldav/__test__/fail?method=PUT&prefix=${encodeURIComponent(SQ_PATH)}&count=1`,
    )

    await openEventModal(page, 'Queue edit event')
    await page.locator('[data-component="event-title-input"]').fill('Queue edit event (edited)')
    await page.locator('[data-component="modal-save"]').click()

    // The edit survives locally even though the write failed.
    await expect(
      page
        .locator('[data-component="event-card"]')
        .filter({ hasText: 'Queue edit event (edited)' })
    ).toBeVisible({ timeout: 15_000 })

    // Recover: the next sync drains the queue and the edit lands on the server.
    await triggerSync(page)
    await expect
      .poll(
        async () => {
          const bytes = (await dump(page, baseURL!, SQ_PATH)) ?? {}
          return Object.values(bytes).join('')
        },
        { timeout: 15_000 }
      )
      .toContain('SUMMARY:Queue edit event (edited)')
  })

  test('a stale-etag 412 is recovered by re-fetching the etag and re-applying once', async ({
    page,
    baseURL,
  }) => {
    await clearState(page)
    await seedAccountSQ(page, baseURL!)
    await seedStoreCalendars(page, [
      { id: CAL_SQ, name: 'Sync Queue', color: '#4285F4', isDefault: true },
    ])

    const start = new Date()
    start.setUTCHours(11, 0, 0, 0)
    const ics =
      `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:stale-etag\r\nDTSTART:${icalStamp(start)}\r\nDTEND:${icalStamp(new Date(start.getTime() + 3_600_000))}\r\nSUMMARY:Stale etag event\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`
    await page.request.put(`${baseURL}/mock-caldav${SQ_PATH}stale-etag.ics`, { data: ics })

    await page.goto('/month')
    await triggerSync(page)
    await expect(
      page.locator('[data-component="event-card"]').filter({ hasText: 'Stale etag event' })
    ).toBeVisible({ timeout: 15_000 })

    // Bump the server etag WITHOUT changing the content: the app's next PUT
    // sends its (now stale) If-Match and the mock answers 412, exactly like
    // Radicale does when another client touched the resource.
    await page.request.put(`${baseURL}/mock-caldav${SQ_PATH}stale-etag.ics`, { data: ics })

    await openEventModal(page, 'Stale etag event')
    await page.locator('[data-component="event-title-input"]').fill('Stale etag event (edited)')
    await page.locator('[data-component="modal-save"]').click()

    // Let the queued update replay through a sync: the 412 must be
    // recovered (re-fetch etag, re-apply), not replayed forever.
    await triggerSync(page)

    await expect
      .poll(
        async () => {
          const bytes = (await dump(page, baseURL!, SQ_PATH)) ?? {}
          return Object.values(bytes).join('')
        },
        { timeout: 15_000 }
      )
      .toContain('SUMMARY:Stale etag event (edited)')

    // And the UI agrees.
    await expect(
      page
        .locator('[data-component="event-card"]')
        .filter({ hasText: 'Stale etag event (edited)' })
    ).toBeVisible({ timeout: 15_000 })
  })
})
