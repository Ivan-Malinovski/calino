import { test, expect } from '@playwright/test'
import { clearState, seedJournal } from './fixtures/localstorage'

const today = new Date()
const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
const calendars = Array.from({ length: 30 }, (_, i) => ({
  id: `many-${i}`,
  name: `Calendar ${i + 1} ${'LongCalendarName'.repeat(5)}`,
}))

for (const viewport of [
  { width: 1200, height: 650 },
  { width: 390, height: 700 },
]) {
  test.describe(`30 calendars at ${viewport.width}px`, () => {
    test.use({ viewport })
    test.beforeEach(async ({ page }) => {
      await clearState(page)
      await seedJournal(page, {
        calendars,
        entries: [
          {
            id: 'many-entry',
            title: 'Many calendars',
            body: 'Keep writing',
            date,
            calendarId: 'many-0',
          },
        ],
      })
    })

    test('journal body stays usable while all calendar choices remain reachable', async ({
      page,
    }) => {
      await page.goto('/journal')
      await page.locator('[data-component="journal-entry-row"]').first().click()
      await expect(page.locator('[data-component="journal-read-view"]')).toBeInViewport()
      await page.locator('[data-component="journal-read-view"]').dblclick()
      const body = page.locator('[data-component="journal-body-input"]')
      await expect(body).toBeInViewport()
      const last = page.locator(
        '[data-component="journal-calendar-chip"][data-calendar-id="many-29"]'
      )
      await last.scrollIntoViewIfNeeded()
      await last.click()
      await expect(last).toHaveAttribute('aria-checked', 'true')
      await expect(body).toBeInViewport()
      await body.fill('Writing still works with thirty calendars')
      await expect(body).toHaveValue('Writing still works with thirty calendars')
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width
      )
      const stored = await page.evaluate(
        () => JSON.parse(localStorage.getItem('calino-storage')!).state.events
      )
      expect(stored.find((entry: { id: string }) => entry.id === 'many-entry')).toMatchObject({
        calendarId: 'many-29',
      })
    })

    test('sidebar reaches its last calendar and Tasks, and can hide and restore calendars', async ({
      page,
    }) => {
      await page.goto('/month')
      if (viewport.width < 768) await page.getByRole('button', { name: 'Toggle menu' }).click()
      const sidebar = page.locator('[data-component="sidebar"]')
      await sidebar.locator('[data-component="calendar-section-toggle"]').click()
      const last = sidebar.locator(
        '[data-component="calendar-visibility-toggle"][data-calendar-id="many-29"]'
      )
      await last.scrollIntoViewIfNeeded()
      await last.uncheck()
      await expect(last).not.toBeChecked()
      await last.check()
      await expect(last).toBeChecked()
      const tasks = sidebar.locator('[data-component="tasks-header"]')
      await tasks.scrollIntoViewIfNeeded()
      await expect(tasks).toBeInViewport()
      await tasks.click()
      await expect(tasks).toHaveAttribute('aria-expanded', 'true')
    })
  })
}
