/**
 * Keyboard navigation specs for the calendar grids.
 *
 * The month grid has had roving-tabindex arrow navigation for a while;
 * the week and day time grids gained it in the a11y release. These specs
 * pin the user-visible contract: one Tab stop into the grid, arrows move
 * focus between slots, Enter opens quick-create — and none of it leaks
 * to the window-level date pager.
 */

import { test, expect, type Page } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

test.describe('keyboard navigation', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
  })

  /** The single tabbable hour slot inside the week/day time grid. */
  function tabbableSlot(page: Page) {
    return page.locator('[data-hour][tabindex="0"]')
  }

  async function openWeekView(page: Page): Promise<void> {
    await page.goto('/week')
    await expect(page.locator('[data-component="header"]')).toBeVisible()
  }

  test('week view: Tab reaches exactly one hour cell', async ({ page }) => {
    await openWeekView(page)

    // Roving tabindex: exactly one slot is the tab stop.
    const stops = page.locator('[data-hour][tabindex="0"]')
    await expect(stops).toHaveCount(1)
    expect(await stops.first().getAttribute('data-hour')).toBe('00:00')

    // Arrow keys move focus without adding new tab stops.
    await stops.first().focus()
    await page.keyboard.press('ArrowRight')
    const active = page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      return el ? { date: el.getAttribute('data-date'), hour: el.getAttribute('data-hour') } : null
    })
    expect(active).not.toBeNull()
    expect(await tabbableSlot(page).count()).toBe(1)
  })

  test('week view: ArrowRight moves to the next day at the same hour', async ({ page }) => {
    await openWeekView(page)

    const first = tabbableSlot(page).first()
    await first.focus()
    const start = await first.getAttribute('data-date')

    await page.keyboard.press('ArrowRight')

    const active = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      return el?.getAttribute('data-date') ?? null
    })
    expect(active).not.toBe(start)
    // Same hour, one day later.
    expect(await page.locator('[data-hour][tabindex="0"]').getAttribute('data-hour')).toBe('00:00')
  })

  test('week view: ArrowDown moves one hour within the column', async ({ page }) => {
    await openWeekView(page)

    await tabbableSlot(page).first().focus()
    await page.keyboard.press('ArrowDown')

    const hour = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.getAttribute('data-hour') ?? null
    )
    expect(hour).toBe('01:00')
  })

  test('week view: Enter on an empty slot opens quick-create', async ({ page }) => {
    await openWeekView(page)

    await tabbableSlot(page).first().focus()
    await page.keyboard.press('Enter')

    const titleInput = page.locator('[data-component="event-title-input"]')
    await expect(titleInput).toBeVisible({ timeout: 5_000 })
  })

  test('day view: arrows move between hours and Enter opens quick-create', async ({ page }) => {
    await page.goto('/day')
    await expect(page.locator('[data-component="header"]')).toBeVisible()

    const stops = page.locator('[data-hour][tabindex="0"]')
    await expect(stops).toHaveCount(1)
    await stops.first().focus()

    await page.keyboard.press('ArrowDown')
    let hour = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.getAttribute('data-hour') ?? null
    )
    expect(hour).toBe('01:00')

    await page.keyboard.press('ArrowUp')
    hour = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.getAttribute('data-hour') ?? null
    )
    expect(hour).toBe('00:00')

    await page.keyboard.press('Enter')
    const titleInput = page.locator('[data-component="event-title-input"]')
    await expect(titleInput).toBeVisible({ timeout: 5_000 })
  })

  test('month view: arrow keys move between day cells', async ({ page }) => {
    await page.goto('/month')
    await expect(page.locator('[data-component="calendar-grid"]').first()).toBeVisible()

    const todayCell = page.locator('[data-today][data-date]')
    await todayCell.focus()

    await page.keyboard.press('ArrowRight')
    const afterRight = await page.evaluate(() =>
      (document.activeElement as HTMLElement | null)?.hasAttribute('data-date')
    )
    expect(afterRight).toBe(true)

    await page.keyboard.press('ArrowDown')
    const afterDown = await page.evaluate(() =>
      (document.activeElement as HTMLElement | null)?.hasAttribute('data-date')
    )
    expect(afterDown).toBe(true)
  })
})
