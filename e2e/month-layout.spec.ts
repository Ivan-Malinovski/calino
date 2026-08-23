import { test, expect } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

test.describe('month layout at constrained heights', () => {
  test.use({ viewport: { width: 1024, height: 600 } })

  test('keeps the visible month rows inside the calendar surface', async ({ page }) => {
    await clearState(page)
    await page.goto('/month')

    const grid = page.locator('[data-component="calendar-grid"]')
    await expect(grid).toBeVisible()

    const geometry = await grid.evaluate((element) => {
      const rows = [...element.querySelectorAll('[class*="weekRow"]')]
      const gridRect = element.getBoundingClientRect()
      const lastRow = rows.at(-1)?.getBoundingClientRect()
      return {
        rowCount: rows.length,
        gridBottom: gridRect.bottom,
        lastRowBottom: lastRow?.bottom ?? 0,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }
    })

    expect(geometry.rowCount).toBeGreaterThanOrEqual(5)
    expect(geometry.lastRowBottom).toBeLessThanOrEqual(geometry.gridBottom + 1)
    expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.clientHeight + 1)
  })
})

test.describe('Android-style top safe area', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('keeps desktop header content below the status bar inset', async ({ page }) => {
    await clearState(page)
    await page.goto('/month')
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--safe-area-inset-top', '40px')
    })

    const title = page.locator('[data-component="header"] h1').first()
    await expect(title).toBeVisible()

    const titleTop = await title.evaluate((element) => element.getBoundingClientRect().top)
    expect(titleTop).toBeGreaterThanOrEqual(40)
  })
})
