/**
 * The year view sizes its months to the window (issue #148). The mini-months
 * used to be capped at 224px with 26px cells, so on a large display the twelve
 * cards were mostly padding and the page stopped at ~850px however tall the
 * window was.
 */
import { test, expect, type Page } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

async function yearGeometry(page: Page): Promise<{
  clientHeight: number
  scrollHeight: number
  lastCardBottom: number
  containerBottom: number
  cell: number
}> {
  const container = page.locator('[data-component="year-view"]')
  await expect(container).toBeVisible()
  return container.evaluate((element) => {
    const cards = element.querySelectorAll('[data-component="year-month"]')
    const cell = element.querySelector('[data-component="year-day"]') as HTMLElement
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      lastCardBottom: cards[cards.length - 1].getBoundingClientRect().bottom,
      containerBottom: element.getBoundingClientRect().bottom,
      cell: cell.getBoundingClientRect().width,
    }
  })
}

test.describe('year layout', () => {
  test('fills a large window without scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 2560, height: 1440 })
    await clearState(page)
    await page.goto('/year')

    const g = await yearGeometry(page)
    expect(g.scrollHeight).toBeLessThanOrEqual(g.clientHeight + 1)
    // The last row of months reaches the bottom of the view, give or take the
    // slack the height formula leaves on purpose.
    expect(g.containerBottom - g.lastCardBottom).toBeLessThan(g.clientHeight * 0.1)
    // Cells grew with the window: 54px here against the old fixed 26px.
    expect(g.cell).toBeGreaterThan(40)
  })

  test('still fits a laptop window', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await clearState(page)
    await page.goto('/year')

    const g = await yearGeometry(page)
    expect(g.scrollHeight).toBeLessThanOrEqual(g.clientHeight + 1)
  })
})
