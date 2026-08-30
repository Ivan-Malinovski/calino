import { expect, test } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

test.describe('dynamic favicon', () => {
  test('keeps the static icon markup before JavaScript runs', async ({ page }) => {
    const response = await page.request.get('/')
    expect(response.ok()).toBe(true)
    expect(await response.text()).toContain('href="/calino-icon.svg"')
  })

  test('replaces the tab icon with the browser local calendar day', async ({ page }) => {
    await clearState(page)
    await page.goto('/month')
    await expect(page.locator('[data-component="header"]')).toBeVisible()

    const day = await page.evaluate(() => new Date().getDate())
    const href = await page.locator('link[rel="icon"]').getAttribute('href')
    expect(href, 'expected the tab icon to be an SVG data URL').toMatch(/^data:image\/svg\+xml,/)
    const svg = decodeURIComponent(href!.slice('data:image/svg+xml,'.length))
    expect(svg).toContain(`>${day}</text>`)
  })
})
