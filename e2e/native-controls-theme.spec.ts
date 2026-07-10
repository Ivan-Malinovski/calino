import { test, expect } from '@playwright/test'
import { clearState, STORAGE_KEYS } from './fixtures/localstorage'

test.describe('native controls follow the active theme', () => {
  test('task selects and date inputs use the dark browser color scheme', async ({ page }) => {
    await clearState(page)
    await page.addInitScript(({ settingsKey }: { settingsKey: string }) => {
      const raw = localStorage.getItem(settingsKey)
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 1 }
      parsed.state = { ...(parsed.state ?? {}), themeMode: 'dark' }
      localStorage.setItem(settingsKey, JSON.stringify(parsed))
    }, { settingsKey: STORAGE_KEYS.settings })

    await page.goto('/tasks')
    await page.locator('[data-component="add-task-button"]').click()
    await page.getByPlaceholder('What needs doing?').fill('Dark controls')
    await page.getByPlaceholder('What needs doing?').press('Enter')

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    for (const selector of [
      '#priority-select',
      '[data-component="event-calendar-select"]',
      '#due-date',
    ]) {
      await expect(page.locator(selector)).toHaveCSS('color-scheme', 'dark')
    }

    const calendarOption = page
      .locator('[data-component="event-calendar-select"] option')
      .first()
    await expect(calendarOption).toHaveCSS('background-color', 'rgb(42, 40, 38)')
    await expect(calendarOption).toHaveCSS('color', 'rgb(240, 236, 230)')

    await page.evaluate(async () => {
      const { showToast } = await import('/src/lib/toast.ts')
      showToast('Dark theme toast')
    })
    await expect(page.getByText('Dark theme toast')).toBeVisible()
    await expect(page.locator('[data-sonner-toaster]')).toHaveAttribute('data-sonner-theme', 'dark')
  })
})
