import { test, expect, type Locator } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

// Colours once any hover transition has finished.
async function settledColours(number: Locator) {
  return number.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished))
    const { backgroundColor, color } = getComputedStyle(element)
    return { backgroundColor, color }
  })
}

test.describe('month view — today marker', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
  })

  test("today's number keeps its filled disc while hovered", async ({ page }) => {
    await page.goto('/month')

    const grid = page.locator('[data-component="calendar-grid"]')
    const today = grid.locator('[data-today]').getByRole('button', { name: /in day view/ })
    const otherDay = grid
      .locator('[data-date]:not([data-today]):not([data-other-month])')
      .first()
      .getByRole('button', { name: /in day view/ })
    await expect(today).toBeVisible()
    const resting = await settledColours(today)

    await otherDay.hover()
    const otherDayHovered = await settledColours(otherDay)
    await today.hover()
    const todayHovered = await settledColours(today)

    // The digits stay in the contrast colour, and the disc does not fall back
    // to the pale hover background every other day number gets.
    expect(todayHovered.color).toBe(resting.color)
    expect(todayHovered.backgroundColor).not.toBe(otherDayHovered.backgroundColor)
  })
})
