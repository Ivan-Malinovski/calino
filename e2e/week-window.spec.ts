import { test, expect, type Page } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

async function seedWeekView(page: Page, firstDayOfWeek: 0 | 1 = 1): Promise<void> {
  await page.addInitScript(({ firstDay }) => {
    const calendarRaw = localStorage.getItem('calino-storage')
    const calendar = calendarRaw ? JSON.parse(calendarRaw) : { state: {}, version: 2 }
    calendar.state = {
      ...(calendar.state ?? {}),
      currentDate: '2024-08-17',
      currentView: 'week',
    }
    localStorage.setItem('calino-storage', JSON.stringify(calendar))

    const settingsRaw = localStorage.getItem('calino-settings')
    const settings = settingsRaw ? JSON.parse(settingsRaw) : { state: {}, version: 1 }
    settings.state = { ...(settings.state ?? {}), firstDayOfWeek: firstDay }
    localStorage.setItem('calino-settings', JSON.stringify(settings))
  }, { firstDay: firstDayOfWeek })
}

function weekTitle(page: Page) {
  return page.locator('[data-component="header"] h1').last()
}

test.describe('Week view — sliding window navigation', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
  })

  test('steps one day while keeping the week title, number, and range synchronized', async ({
    page,
  }) => {
    await seedWeekView(page, 0)
    await page.goto('/week')

    await expect(weekTitle(page)).toHaveText('Aug 11 – 17')
    await expect(page.getByText('W32')).toBeVisible()

    const nextDay = page.getByRole('button', { name: 'Show next day' })
    await expect(nextDay).toHaveAttribute('title', 'Show next day')
    await nextDay.click()

    await expect(weekTitle(page)).toHaveText('Aug 12 – 18')
    await expect(page.getByText('W33')).toBeVisible()

    // The regular pager still moves by a complete seven-day window.
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(weekTitle(page)).toHaveText('Aug 19 – 25')
  })

  test('supports keyboard activation and Today realigns the window', async ({ page }) => {
    await seedWeekView(page, 1)
    await page.goto('/week')

    const nextDay = page.getByRole('button', { name: 'Show next day' })
    await nextDay.focus()
    await page.keyboard.press('Enter')
    await expect(weekTitle(page)).toHaveText('Aug 13 – 19')

    await page.locator('[data-component="header"] [data-component="today-button"]').click()
    const today = new Date()
    const start = new Date(today)
    const day = start.getDay()
    start.setDate(start.getDate() - ((day + 6) % 7))
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    const month = new Intl.DateTimeFormat('en-US', { month: 'short' })
    const dayNumber = new Intl.DateTimeFormat('en-US', { day: 'numeric' })
    const expected = `${month.format(start)} ${dayNumber.format(start)} – ${dayNumber.format(end)}`
    await expect(weekTitle(page)).toHaveText(expected)
  })

  test('keeps the controls usable on a narrow screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await seedWeekView(page)
    await page.goto('/week')

    const controls = page.locator('[data-component="week-window-controls"]')
    await expect(controls).toBeVisible()
    await expect(page.getByRole('button', { name: 'Show previous day' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Show next day' })).toBeVisible()
  })
})
