import { test, expect } from '@playwright/test'
import { clearState, seedAccount } from './fixtures/localstorage'

// Issue #110 — deleting a task/event on a remote calendar left the resource on
// the server and surfaced "Failed to sync deletion. It will be retried."
// Servers that enforce If-Match (Baikal/sabre, Radicale) answer a delete
// carrying a stale ETag with 412; the mock used to hand out one constant ETag,
// so nothing here could ever fail. See vite-caldav-mock's etagStore.

const CALENDAR_PATH = '/dav/calendars/user/del-sync/'
const NOETAG_PATH = '/dav/calendars/user/del-sync-noetag/'

async function dump(
  page: import('@playwright/test').Page,
  baseURL: string,
  prefix = CALENDAR_PATH
): Promise<Record<string, string>> {
  const res = await page.request.get(
    `${baseURL}/mock-caldav/__test__/dump?prefix=${encodeURIComponent(prefix)}`
  )
  return (await res.json()) as Record<string, string>
}

test.describe('deleting synced resources', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page, baseURL }) => {
    for (const prefix of [CALENDAR_PATH, NOETAG_PATH]) {
      await page.request.post(
        `${baseURL!}/mock-caldav/__test__/reset?prefix=${encodeURIComponent(prefix)}`
      )
    }
  })

  test('deletes an event created in-app from the server', async ({ page, baseURL }) => {
    await clearState(page)
    await seedAccount(page, {
      id: 'del-sync-account',
      name: 'Mock Radicale',
      serverUrl: `${baseURL}/mock-caldav/dav/`,
      username: 'user',
      password: 'pass',
    })

    await page.goto('/month')
    await page.locator('[data-component="sync-all-calendars"]').click()

    // Create through the modal, targeting the remote calendar. Day cells are
    // focusable containers without a button role (the day-number button is the
    // semantic control), so select by data-date.
    const dayCell = page.locator('[data-date]').first()
    await expect(dayCell).toBeVisible({ timeout: 10_000 })
    await dayCell.click()
    const modal = page.locator('[data-component="modal-card"]')
    await expect(modal).toBeVisible()
    await modal.locator('[data-component="event-title-input"]').fill('Delete me')
    await modal
      .locator('[data-component="event-calendar-select"]')
      .selectOption({ label: 'Del Sync' })
    await modal.locator('[data-component="modal-save"]').click()

    await expect.poll(async () => Object.keys(await dump(page, baseURL!)).length).toBe(1)

    const card = page
      .locator('[data-component="event-card"]')
      .filter({ hasText: 'Delete me' })
      .first()
    await card.click()
    await page
      .locator('[data-component="event-preview"]')
      .getByRole('button', { name: 'Delete' })
      .click()

    await expect(page.getByText(/Failed to sync deletion/)).toHaveCount(0)
    await expect.poll(async () => Object.keys(await dump(page, baseURL!)).length).toBe(0)
  })

  test('deletes a task created in-app from the server', async ({ page, baseURL }) => {
    await clearState(page)
    await seedAccount(page, {
      id: 'del-sync-account',
      name: 'Mock Radicale',
      serverUrl: `${baseURL}/mock-caldav/dav/`,
      username: 'user',
      password: 'pass',
    })

    await page.goto('/month')
    await page.locator('[data-component="sync-all-calendars"]').click()
    await page.goto('/tasks')

    await page.locator('[data-component="add-task-button"]').click()
    const composer = page.getByPlaceholder('What needs doing?')
    await composer.fill('Delete this task')
    await composer.press('Enter')

    const modal = page.locator('[data-component="modal-card"]')
    await expect(modal).toBeVisible()
    await modal
      .locator('[data-component="event-calendar-select"]')
      .selectOption({ label: 'Del Sync' })
    await modal.locator('[data-component="modal-save"]').click()
    await expect(modal).not.toBeVisible()

    await expect.poll(async () => Object.keys(await dump(page, baseURL!)).length).toBe(1)

    // Reopen the task and delete it (the modal's Delete asks for a confirming
    // second click).
    await page.locator('main').getByText('Delete this task').click()
    await expect(modal).toBeVisible()
    const deleteButton = modal.getByRole('button', { name: 'Delete' })
    await deleteButton.click()
    await modal.getByRole('button', { name: /Click again to confirm/ }).click()

    await expect(page.getByText(/Failed to sync deletion/)).toHaveCount(0)
    await expect.poll(async () => Object.keys(await dump(page, baseURL!)).length).toBe(0)
  })

  // Issue #110 proper: the server withholds the ETag on PUT (what every server
  // looks like from a browser without `Access-Control-Expose-Headers: ETag`),
  // so the etag comes back through the PROPFIND fallback — where sabre's
  // XML-escaped quotes used to survive into the If-Match and 412 the delete.
  test('deletes a task when the etag came from the PROPFIND fallback', async ({
    page,
    baseURL,
  }) => {
    await clearState(page)
    await seedAccount(page, {
      id: 'del-sync-account',
      name: 'Mock Radicale',
      serverUrl: `${baseURL}/mock-caldav/dav/`,
      username: 'user',
      password: 'pass',
    })

    await page.goto('/month')
    await page.locator('[data-component="sync-all-calendars"]').click()
    await page.goto('/tasks')

    await page.locator('[data-component="add-task-button"]').click()
    const composer = page.getByPlaceholder('What needs doing?')
    await composer.fill('Fallback etag task')
    await composer.press('Enter')

    const modal = page.locator('[data-component="modal-card"]')
    await expect(modal).toBeVisible()
    await modal
      .locator('[data-component="event-calendar-select"]')
      .selectOption({ label: 'Del Sync No ETag' })
    await modal.locator('[data-component="modal-save"]').click()
    await expect(modal).not.toBeVisible()

    await expect
      .poll(async () => Object.keys(await dump(page, baseURL!, NOETAG_PATH)).length)
      .toBe(1)

    await page.locator('main').getByText('Fallback etag task').first().click()
    await expect(modal).toBeVisible()
    await modal.getByRole('button', { name: 'Delete' }).click()
    await modal.getByRole('button', { name: /Click again to confirm/ }).click()

    await expect(page.getByText(/Failed to sync deletion/)).toHaveCount(0)
    await expect
      .poll(async () => Object.keys(await dump(page, baseURL!, NOETAG_PATH)).length)
      .toBe(0)
  })
})
