import { test, expect, type Page } from '@playwright/test'
import { clearState, seedAccount } from './fixtures/localstorage'

/**
 * "This and following events" on a synced series (issue #229).
 *
 * The edit splits one series into two with different UIDs. RFC 4791 §4.1 allows
 * only one UID per calendar object resource, so the two halves must reach the
 * server as two separate PUTs. A server that enforces this (Radicale does; the
 * `series-split/` collection mimics it) answers a PUT carrying both with
 * `400 Multiple VEVENT components with different UIDs`.
 */

const COLLECTION = '/dav/calendars/user/series-split/'

function weeklySeries(uid: string): string {
  const start = new Date()
  start.setUTCDate(start.getUTCDate() - 14)
  const day = start.toISOString().slice(0, 10).replaceAll('-', '')
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Other Client//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTAMP:20260101T000000Z',
    `DTSTART:${day}T100000Z`,
    `DTEND:${day}T110000Z`,
    'RRULE:FREQ=WEEKLY',
    'SUMMARY:Split me',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n')
}

async function dump(page: Page, baseURL: string): Promise<Record<string, string>> {
  const r = await page.request.get(
    `${baseURL}/mock-caldav/__test__/dump?prefix=${encodeURIComponent(COLLECTION)}`
  )
  return (await r.json()) as Record<string, string>
}

async function requests(
  page: Page,
  baseURL: string
): Promise<Array<{ method: string; path: string }>> {
  const r = await page.request.get(
    `${baseURL}/mock-caldav/__test__/requests?prefix=${encodeURIComponent(COLLECTION)}`
  )
  return (await r.json()) as Array<{ method: string; path: string }>
}

test.describe('series split sync', () => {
  // Both tests share one mock collection and its request log.
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page, baseURL }) => {
    await page.request.post(
      `${baseURL!}/mock-caldav/__test__/reset?prefix=${encodeURIComponent(COLLECTION)}`
    )
    await clearState(page)
    await seedAccount(page, {
      id: 'split-account',
      name: 'Mock Radicale',
      serverUrl: `${baseURL}/mock-caldav/dav/`,
      username: 'user',
      password: 'pass',
      calendars: [{ name: 'Series Split', path: 'calendars/user/series-split/', isDefault: true }],
    })
  })

  test('"This and following" writes each series to its own resource', async ({ page, baseURL }) => {
    await page.request.put(`${baseURL}/mock-caldav/dav/calendars/user/series-split/split.ics`, {
      data: weeklySeries('split-weekly'),
    })

    await page.goto('/month')
    await page.locator('[data-component="sync-all-calendars"]').click()

    const card = page.locator('[data-component="event-card"]').filter({ hasText: 'Split me' })
    await expect(card.first()).toBeVisible({ timeout: 15_000 })
    // Not the first occurrence: that would delete-and-recreate rather than split.
    await card.last().click()
    await page
      .locator('[data-component="event-preview"]')
      .getByRole('button', { name: /Open event/i })
      .click()

    const startTime = page.locator('[data-component="event-start-time"]')
    await startTime.fill('1300')
    await startTime.press('Tab')
    await page.locator('[data-component="modal-save"]').click()

    const dialog = page.getByRole('dialog').filter({ hasText: /Edit recurring event/i })
    await expect(dialog).toBeVisible({ timeout: 5_000 })
    await dialog.getByRole('button', { name: /This and following events/i }).click()
    await expect(dialog).toBeHidden({ timeout: 5_000 })

    // Two resources: the truncated original and the new series.
    await expect
      .poll(async () => Object.keys(await dump(page, baseURL!)).length, { timeout: 15_000 })
      .toBe(2)

    const stored = Object.values(await dump(page, baseURL!))
    for (const resource of stored) {
      const uids = new Set(resource.match(/^UID:.*$/gm))
      expect(uids.size, `one UID per resource:\n${resource}`).toBe(1)
    }
    expect(stored.some((r) => r.includes('UID:split-weekly') && /UNTIL=/.test(r))).toBe(true)

    // And the server never had to turn a save away.
    const rejected = (await requests(page, baseURL!)).filter((r) => r.method === 'PUT 400')
    expect(rejected).toEqual([])
  })

  test('quick-editing the time in the preview popup splits into separate resources', async ({
    page,
    baseURL,
  }) => {
    await page.request.put(`${baseURL}/mock-caldav/dav/calendars/user/series-split/split.ics`, {
      data: weeklySeries('split-weekly'),
    })

    await page.goto('/month')
    await page.locator('[data-component="sync-all-calendars"]').click()

    const card = page.locator('[data-component="event-card"]').filter({ hasText: 'Split me' })
    await expect(card.first()).toBeVisible({ timeout: 15_000 })
    await card.last().click()

    const popup = page.locator('[data-component="event-preview"]')
    await popup.getByText(/^\d{1,2}:\d{2}.*-.*\d{1,2}:\d{2}/).click()
    const startTime = page.locator('[data-component="event-preview-start-time"]')
    await startTime.fill('1300')
    await startTime.press('Enter')

    const dialog = page.getByRole('dialog').filter({ hasText: /Edit recurring event/i })
    await expect(dialog).toBeVisible({ timeout: 5_000 })
    await dialog.getByRole('button', { name: /This and following events/i }).click()
    await expect(dialog).toBeHidden({ timeout: 5_000 })

    await expect
      .poll(async () => Object.keys(await dump(page, baseURL!)).length, { timeout: 15_000 })
      .toBe(2)

    const stored = Object.values(await dump(page, baseURL!))
    for (const resource of stored) {
      const uids = new Set(resource.match(/^UID:.*$/gm))
      expect(uids.size, `one UID per resource:\n${resource}`).toBe(1)
    }
    const rejected = (await requests(page, baseURL!)).filter((r) => r.method === 'PUT 400')
    expect(rejected).toEqual([])
  })
})
