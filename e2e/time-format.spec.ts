import { test, expect } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

test.describe('time format in event form', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
  })

  test('uses the selected 12-hour format when creating an event', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('radio', { name: '12-hour (2:30 PM)' }).click()

    await page.goto('/month')
    await page.keyboard.press('c')

    const startTime = page.locator('[data-component="event-start-time"]')
    const endTime = page.locator('[data-component="event-end-time"]')
    await expect(startTime).toHaveValue(/AM|PM/)
    await expect(endTime).toHaveValue(/AM|PM/)

    await startTime.fill('2:30 PM')
    await startTime.press('Tab')
    await expect(endTime).toHaveValue('3:30 PM')
  })

  test('uses the selected 12-hour format when creating a task', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('radio', { name: '12-hour (2:30 PM)' }).click()

    await page.goto('/tasks')
    await page.locator('[data-component="add-task-button"]').click()
    await page.getByPlaceholder('What needs doing?').fill('Call the dentist')
    await page.getByPlaceholder('What needs doing?').press('Enter')
    await page.getByRole('checkbox', { name: 'Only due date' }).uncheck()

    await expect(page.locator('[data-component="task-due-time"]')).toHaveValue('9:00 AM')
  })
})
