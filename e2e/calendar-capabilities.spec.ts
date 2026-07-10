import { test, expect } from '@playwright/test'
import { clearState, seedCalendarCapabilities } from './fixtures/localstorage'

test.describe('CalDAV calendar component support', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await seedCalendarCapabilities(page, [
      { id: 'events', name: 'Events only', components: ['VEVENT'], isDefault: true },
      { id: 'tasks', name: 'Tasks only', components: ['VTODO'] },
      { id: 'mixed', name: 'Events and tasks', components: ['VEVENT', 'VTODO'] },
    ])
  })

  test('event creation lists event-capable calendars only', async ({ page }) => {
    await page.goto('/month')
    await expect(page.locator('[data-component="header"]')).toBeVisible()
    await page.keyboard.press('c')

    const select = page.locator('[data-component="event-calendar-select"]')
    await expect(select.locator('option')).toHaveText(['Events only', 'Events and tasks'])
  })

  test('task creation lists task-capable calendars only', async ({ page }) => {
    await page.goto('/tasks')
    await page.locator('[data-component="add-task-button"]').click()
    await page.getByPlaceholder('What needs doing?').fill('Capability test')
    await page.getByPlaceholder('What needs doing?').press('Enter')

    const select = page.locator('[data-component="event-calendar-select"]')
    await expect(select.locator('option')).toHaveText(['Tasks only', 'Events and tasks'])
  })
})
