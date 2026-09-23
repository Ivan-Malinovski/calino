/**
 * The "Default View" setting decides which view `/` opens on. The root route
 * used to be hardcoded to month (desktop) / agenda (mobile), so a user who
 * chose Week still landed on Month whenever the app opened there: a new tab,
 * or the back button out of Settings.
 */
import { test, expect, type Page } from '@playwright/test'
import { clearState, STORAGE_KEYS } from './fixtures/localstorage'

/** Merge a defaultView into the settings store before the app boots. */
async function seedDefaultView(page: Page, view: string): Promise<void> {
  await page.addInitScript(
    ({ key, view }: { key: string; view: string }) => {
      const raw = window.localStorage.getItem(key)
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 4 }
      parsed.state = { ...(parsed.state ?? {}), defaultView: view }
      window.localStorage.setItem(key, JSON.stringify(parsed))
    },
    { key: STORAGE_KEYS.settings, view }
  )
}

test.describe('Default View — desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('the root route opens the configured view, not month', async ({ page }) => {
    await clearState(page)
    await seedDefaultView(page, 'week')

    await page.goto('/')
    await expect(page).toHaveURL(/\/week$/)
    await expect(page.locator('main[data-view]')).toHaveAttribute('data-view', 'week')
  })

  test('leaving settings returns to the configured view', async ({ page }) => {
    await clearState(page)
    await seedDefaultView(page, 'week')

    await page.goto('/settings')
    await page.getByRole('button', { name: 'Back to Calendar' }).click()

    await expect(page).toHaveURL(/\/week$/)
    await expect(page.locator('main[data-view]')).toHaveAttribute('data-view', 'week')
  })
})

test.describe('Default View — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('opens the agenda regardless of the setting', async ({ page }) => {
    await clearState(page)
    await seedDefaultView(page, 'week')

    await page.goto('/')
    await expect(page).toHaveURL(/\/agenda$/)
    await expect(page.locator('main[data-view]')).toHaveAttribute('data-view', 'agenda')
  })
})
