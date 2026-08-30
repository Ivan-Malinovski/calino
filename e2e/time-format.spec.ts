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

  test('normalizes a compact 24-hour time when creating an event', async ({ page }) => {
    await page.goto('/month')
    await page.keyboard.press('c')

    const startTime = page.locator('[data-component="event-start-time"]')
    await startTime.fill('1140')
    await startTime.press('Tab')

    await expect(startTime).toHaveValue('11:40')
  })

  test('opens a quarter-hour picker and applies a selected time', async ({ page }) => {
    await page.goto('/month')
    await page.keyboard.press('c')

    const startTime = page.locator('[data-component="event-start-time"]')
    const options = page.locator('[data-component="time-picker-options"]')
    await startTime.click()

    await expect(options).toBeVisible()
    const menuBox = await options.boundingBox()
    const currentOptionBox = await options.getByRole('option', { name: '09:00' }).boundingBox()
    expect(menuBox).not.toBeNull()
    expect(currentOptionBox).not.toBeNull()
    expect((currentOptionBox?.y ?? 0) - (menuBox?.y ?? 0)).toBeLessThan(45)
    await expect(options.getByRole('option', { name: '10:15' })).toBeVisible()
    await options.getByRole('option', { name: '10:15' }).click()

    await expect(startTime).toHaveValue('10:15')
    await expect(page.locator('[data-component="event-end-time"]')).toHaveValue('11:15')
    await expect(options).toBeHidden()
  })

  test('uses the selected 12-hour format when creating a task', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('radio', { name: '12-hour (2:30 PM)' }).click()

    await page.goto('/tasks')
    await page.locator('[data-component="add-task-button"]').click()
    await page.getByPlaceholder('What needs doing?').fill('Call the dentist')
    await page.getByPlaceholder('What needs doing?').press('Enter')
    await page.locator('[data-component="due-mode-datetime"]').click()

    await expect(page.locator('[data-component="task-due-time"]')).toHaveValue('9:00 AM')
  })
})
