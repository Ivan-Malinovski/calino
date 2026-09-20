import { expect, test } from '@playwright/test'

test.describe('setup page', () => {
  test('scrolls when the wizard is taller than the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 500 })
    await page.goto('/setup')

    const setupPage = page.getByRole('main')
    const addSubscription = page.getByRole('button', { name: 'Add Subscription' })

    await expect(setupPage).toBeVisible()
    await expect(addSubscription).not.toBeInViewport()

    await addSubscription.scrollIntoViewIfNeeded()

    await expect(addSubscription).toBeInViewport()
    expect(await setupPage.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  })
})
