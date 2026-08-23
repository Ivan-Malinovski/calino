import { test, expect } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

test.describe('language settings', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
  })

  test('switches the interface language and keeps the choice after reload', async ({ page }) => {
    await page.goto('/settings')

    const language = page.locator('[data-setting="language"]')
    await expect(language).toBeVisible()

    const selector = language.locator('select')
    await expect(selector).toHaveValue('en')

    await selector.selectOption('da')
    await expect(selector).toHaveValue('da')
    await expect(language).toHaveAttribute('data-value', 'da')

    await page.goto('/month')
    await expect(page.getByRole('button', { name: 'Forrige', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Næste', exact: true })).toBeVisible()
    const desktopSwitcher = page.locator('[data-component="view-switcher"]')
    await expect(desktopSwitcher.getByRole('button', { name: 'Måned', exact: true })).toBeVisible()
    await expect(desktopSwitcher.getByRole('button', { name: 'Uge', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Indstillinger', exact: true }).first().hover()
    await expect(
      page.getByRole('button', { name: 'Alle indstillinger →', exact: true })
    ).toBeVisible()

    await page.goto('/settings')
    await expect(page.locator('[data-component="settings-page"]')).toBeVisible()
    await expect(page.locator('[data-setting="language"]').getByRole('combobox')).toHaveValue('da')

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/month')
    const mobileSwitcher = page.locator('[data-component="nav-pill-switcher"]')
    await expect(mobileSwitcher.getByRole('button', { name: 'Måned', exact: true })).toBeVisible()
    await expect(mobileSwitcher.getByRole('button', { name: 'Uge', exact: true })).toBeVisible()
  })
})
