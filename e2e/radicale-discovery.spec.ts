import { test, expect } from '@playwright/test'
import { clearState, seedAccount } from './fixtures/localstorage'

// Same DAV fixture, different host: its Radicale profile redirects well-known
// to a web UI that blocks DAV preflight, and requires collection trailing slashes.
const DAV = `http://127.0.0.1:${process.env.DAV_PORT ?? 8099}`
const CALENDAR = `${DAV}/radicale/alice/work/`

test.beforeEach(async ({ page }) => {
  await clearState(page)
})

test('connects an explicit Radicale calendar despite a CORS-blocked discovery target', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByLabel('Add calendar').first().click()
  await page.getByRole('button', { name: 'Add CalDAV Account' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/server url/i).fill(CALENDAR)
  await dialog.getByLabel(/username/i).fill('alice')
  await dialog.getByLabel(/^password/i).fill('hunter2')
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(dialog).not.toBeVisible({ timeout: 20_000 })
  await page.locator('[data-component="calendar-section-toggle"]').click()
  await expect(page.getByText('Radicale calendar', { exact: true })).toBeVisible()
  await page.reload()
  await page.locator('[data-component="calendar-section-toggle"]').click()
  const sync = page.locator('[data-component="sync-all-calendars"]')
  await expect(sync).toBeEnabled()
  await sync.click()
  await expect(
    page.getByText(/All calendars synced\.|Calendars are already syncing\./)
  ).toBeVisible()
  await expect(page.getByText('Radicale calendar', { exact: true })).toBeVisible()
})

test('diagnostics retries the exact Radicale URL after discovery hits the web UI', async ({
  page,
}) => {
  await seedAccount(page, {
    name: 'Radicale',
    serverUrl: CALENDAR,
    username: 'alice',
    password: 'hunter2',
  })
  await page.goto('/settings?tab=caldav')
  await page.locator('[data-action="diagnose-account"]').first().click()
  await expect(page.locator('[data-summary]')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-check="preflight"]')).toHaveAttribute('data-status', 'pass')
  await expect(page.locator('[data-check="auth"]')).toHaveAttribute('data-status', 'pass')
  await expect(page.locator('[data-check="propfind-depth1"]')).toHaveAttribute(
    'data-status',
    'pass'
  )
})
