import { test, expect } from '@playwright/test'
import { clearState, seedAccount } from './fixtures/localstorage'

test.describe('calendar discovery sync', () => {
  test('reload discovers remote calendars and the header action syncs all accounts', async ({
    page,
    baseURL,
  }) => {
    await clearState(page)
    await seedAccount(page, {
      id: 'mock-account',
      name: 'Mock Radicale',
      serverUrl: `${baseURL}/mock-caldav/dav/`,
      username: 'user',
      password: 'pass',
    })

    await page.goto('/month')

    const syncAll = page.locator('[data-component="sync-all-calendars"]')
    await expect(syncAll).toBeEnabled({ timeout: 10_000 })
    await syncAll.click()
    await expect(page.getByText(/All calendars synced\.|Calendars are already syncing\./)).toBeVisible({ timeout: 10_000 })

    // Discovery does not rely only on the previously persisted calendar list.
    await page.locator('[data-component="calendar-section-toggle"]').click()
    await expect(page.getByText('Personal', { exact: true })).toBeVisible({ timeout: 10_000 })
  })
})
