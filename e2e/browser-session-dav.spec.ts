import { test, expect } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

test.describe('browser-session DAV deployment', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
  })

  test('connects the managed account without asking for credentials', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    await page.getByRole('button', { name: /^\s*Sync\s*$/ }).click()

    const account = page.locator('[data-component="account-row"]', {
      hasText: 'Managed Calendar',
    })
    await expect(account).toBeVisible()
    await expect(account).toContainText('Connected')
  })
})
