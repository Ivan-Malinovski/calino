/**
 * The "Calino" wordmark in the header is the home control: it returns to
 * month view from any other view, and jumps to today once there (issue #149).
 */
import { test, expect } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

test.describe('header — wordmark goes home', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('returns to month view, then to today', async ({ page }) => {
    await clearState(page)
    await page.goto('/year')
    await expect(page.locator('[data-component="header"]')).toBeVisible()

    const wordmark = page.locator('[data-component="brand-home"]')
    await expect(wordmark).toHaveText('Calino')
    await wordmark.click()
    await expect(page).toHaveURL(/\/month$/)

    // Walk a month ahead, then home again: month view's "home" is today.
    const monthTitle = page.locator('[data-component="header"] h1')
    const thisMonth = await monthTitle.textContent()
    await page
      .locator('[data-component="header"]')
      .getByRole('button', { name: /next/i })
      .first()
      .click()
    await expect(monthTitle).not.toHaveText(thisMonth!)
    await wordmark.click()
    await expect(monthTitle).toHaveText(thisMonth!)
  })
})
