/**
 * #237 — a CalDAV server that holds an external ICS feed as a subscription
 * (Radicale `VSUBSCRIBED`: resourcetype `cs:subscribed`, feed URL in
 * `cs:source`) stores no events and is not a `calendar` collection, so the
 * client used to drop it silently. Calino now mirrors it as a read-only webcal
 * subscription and reads the feed itself.
 */
import { test, expect, type Page } from '@playwright/test'
import { clearState, seedAccount } from './fixtures/localstorage'

const today = new Date()
const stamp = `${today.getUTCFullYear()}${String(today.getUTCMonth() + 1).padStart(2, '0')}${String(
  today.getUTCDate()
).padStart(2, '0')}`

const FEED = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Test//EN',
  'BEGIN:VEVENT',
  'UID:server-holiday-1@example.test',
  'DTSTAMP:20260101T000000Z',
  `DTSTART:${stamp}T090000Z`,
  `DTEND:${stamp}T100000Z`,
  'SUMMARY:Server Holiday Event',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n')

async function syncAll(page: Page): Promise<void> {
  await page.locator('[data-component="sync-all-calendars"]').click()
  await expect(
    page.getByText(/All calendars synced\.|Calendars are already syncing\./)
  ).toBeVisible({ timeout: 20_000 })
}

test.describe('server-held subscriptions (#237)', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await clearState(page)
    await page.route('**/server-holidays.ics', (route) =>
      route.fulfill({ status: 200, contentType: 'text/calendar', body: FEED })
    )
    await seedAccount(page, {
      id: 'sub-account',
      name: 'Mock Subscriptions',
      serverUrl: `${baseURL}/mock-caldav-sub/dav/`,
      username: 'userd',
      password: 'pass',
      calendars: [{ name: 'Sub Work', path: 'calendars/userd/sub-work/', isDefault: true }],
    })
  })

  test('a subscribed collection appears as a read-only calendar with the feed events', async ({
    page,
  }) => {
    await page.goto('/month')
    await syncAll(page)

    const eventCard = page.locator('[data-component="event-card"]', {
      hasText: 'Server Holiday Event',
    })
    await expect(eventCard).toBeVisible({ timeout: 15_000 })
    // Read-only, like any webcal calendar.
    await expect(eventCard).toHaveAttribute('data-no-drag', '')
  })

  test('syncing again does not duplicate the subscription', async ({ page }) => {
    await page.goto('/month')
    await syncAll(page)
    await expect(
      page.locator('[data-component="event-card"]', { hasText: 'Server Holiday Event' })
    ).toBeVisible({
      timeout: 15_000,
    })
    await syncAll(page)

    const subscriptions = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('calino_webcal_subscriptions') ?? '[]')
    )
    expect(subscriptions).toHaveLength(1)
    expect(subscriptions[0]).toMatchObject({
      url: 'https://feeds.example.test/server-holidays.ics',
      serverAccountId: 'sub-account',
    })
  })
})
