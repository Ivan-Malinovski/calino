import { test, expect } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

test.describe('Settings search', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await page.goto('/settings')
  })

  test('opens a clicked result and briefly highlights the matching setting', async ({ page }) => {
    const sidebar = page.locator('[data-component="settings-sidebar"]')
    await expect(sidebar.getByRole('button', { name: 'Back to Calendar' })).toBeVisible()
    await expect(sidebar.locator('button').first()).toContainText('Back to Calendar')

    const search = page.getByRole('combobox', { name: 'Search settings' })
    await search.fill('Default View')

    const results = page.getByRole('listbox', { name: 'Settings search results' })
    await results.getByRole('option', { name: /Default View/ }).click()

    await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible()
    const setting = page.locator('[data-component="setting-row"][data-setting="default-view"]')
    await expect(setting).toBeVisible()
    await expect(setting).toHaveCSS('animation-duration', '2.3s')
  })

  test('Enter opens the top search result', async ({ page }) => {
    const search = page.getByRole('combobox', { name: 'Search settings' })
    await search.fill('Default View')
    await expect(
      page.getByRole('listbox', { name: 'Settings search results' }).getByRole('option').first()
    ).toContainText('Default View')
    await search.press('Enter')

    await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible()
    await expect(
      page.locator('[data-component="setting-row"][data-setting="default-view"]')
    ).toHaveCSS('animation-duration', '2.3s')
  })
})
