import { expect, test, type Page } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

const DATA_URL_PREFIX = 'data:image/svg+xml,'

async function faviconSvg(page: Page): Promise<string> {
  const href = await page.locator('link[rel="icon"]').getAttribute('href')
  expect(href, 'expected the tab icon to be an SVG data URL').toBeTruthy()
  expect(href!.startsWith(DATA_URL_PREFIX)).toBe(true)
  return decodeURIComponent(href!.slice(DATA_URL_PREFIX.length))
}

test.describe('dynamic favicon', () => {
  test('keeps the static icon markup before JavaScript runs', async ({ page }) => {
    const response = await page.request.get('/')
    expect(response.ok()).toBe(true)
    const html = await response.text()
    expect(html).toMatch(/<link rel="icon" type="image\/svg\+xml" href="\/calino-icon\.svg" \/>/)
  })

  test('replaces the tab icon with the browser local calendar day', async ({ page }) => {
    await clearState(page)
    await page.goto('/month')
    await expect(page.locator('[data-component="header"]')).toBeVisible()

    const day = await page.evaluate(() => new Date().getDate())
    const svg = await faviconSvg(page)
    expect(svg).toContain(`>${day}</text>`)
    expect(svg).toContain('#b07d4f')
    expect(svg).toContain('rotate(45 198 198)')
  })

  test.describe('with a pinned local clock', () => {
    test.use({ timezoneId: 'Europe/London' })

    test('uses the pinned local day and refreshes when the tab is shown again', async ({
      page,
    }) => {
      await page.clock.setFixedTime('2026-08-07T12:00:00+01:00')
      await clearState(page)
      await page.goto('/month')
      await expect(page.locator('[data-component="header"]')).toBeVisible()
      expect(await faviconSvg(page)).toContain('>7</text>')

      await page.clock.setFixedTime('2026-08-08T12:00:00+01:00')
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
      expect(await faviconSvg(page)).toContain('>8</text>')
    })

    test('rolls the numeral over just after local midnight', async ({ page }) => {
      // 23:59:58 → next local midnight is 2s, plus the 1s cushion in
      // startDynamicFavicon. Fast-forward past that so the one-shot fires.
      await page.clock.install({ time: new Date('2026-08-07T23:59:58+01:00') })
      await clearState(page)
      await page.goto('/month')
      await expect(page.locator('[data-component="header"]')).toBeVisible()
      expect(await faviconSvg(page)).toContain('>7</text>')

      await page.clock.fastForward(4000)
      await expect.poll(async () => faviconSvg(page)).toContain('>8</text>')
    })
  })
})
