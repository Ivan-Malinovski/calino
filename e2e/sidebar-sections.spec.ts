import { test, expect } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

test.describe('Sidebar sections', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
  })

  test('calendar and category filters are revealed by their section buttons', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'calino-storage',
        JSON.stringify({
          state: {
            calendars: [
              {
                id: 'default',
                name: 'Offline calendar',
                color: '#4285F4',
                isVisible: true,
                isDefault: true,
                showTasksInViews: true,
              },
            ],
            categories: [
              {
                id: 'work',
                name: 'Work',
                color: '#EA4335',
              },
            ],
          },
          version: 1,
        })
      )
    })

    await page.goto('/month')

    const calendarSection = page.locator('[data-component="calendar-section-toggle"]')
    await expect(calendarSection).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByText('Offline calendar')).not.toBeVisible()

    await calendarSection.click()
    await expect(calendarSection).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByText('Offline calendar')).toBeVisible()

    const categorySection = page.locator('[data-component="category-section-toggle"]')
    await expect(categorySection).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('button', { name: 'Work' })).not.toBeVisible()

    await categorySection.click()
    await expect(categorySection).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('button', { name: 'Work' })).toBeVisible()
  })

  test('calendar color picker applies a preset color', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'calino-storage',
        JSON.stringify({
          state: {
            calendars: [
              {
                id: 'default',
                name: 'Offline calendar',
                color: '#4285F4',
                isVisible: true,
                isDefault: true,
                showTasksInViews: true,
              },
            ],
          },
          version: 1,
        })
      )
    })

    await page.goto('/month')
    await page.locator('[data-component="calendar-section-toggle"]').click()

    const colorButton = page.getByRole('button', { name: 'Change Offline calendar color' })
    await colorButton.click()
    const picker = page.locator('[data-component="calendar-color-picker"]')
    await expect(picker).toBeVisible()
    const customColor = picker.getByLabel('Custom color for Offline calendar').locator('..')
    await expect(customColor).toBeVisible()
    const firstPreset = picker.getByRole('button', { name: 'Use #4285F4 for Offline calendar' })
    const [firstPresetBox, customColorBox] = await Promise.all([firstPreset.boundingBox(), customColor.boundingBox()])
    expect(firstPresetBox?.y).toBe(customColorBox?.y)

    await picker.getByRole('button', { name: 'Use #EA4335 for Offline calendar' }).click()
    await expect(picker).toBeHidden()
    await expect(colorButton).toHaveCSS('background-color', 'rgb(234, 67, 53)')
  })

  test('calendar color picker selects only the matching preset for lowercase colors', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'calino-storage',
        JSON.stringify({
          state: {
            calendars: [
              {
                id: 'default',
                name: 'Offline calendar',
                color: '#ea4335',
                isVisible: true,
                isDefault: true,
                showTasksInViews: true,
              },
            ],
          },
          version: 1,
        })
      )
    })

    await page.goto('/month')
    await page.locator('[data-component="calendar-section-toggle"]').click()
    await page.getByRole('button', { name: 'Change Offline calendar color' }).click()

    const preset = page.getByRole('button', { name: 'Use #EA4335 for Offline calendar' })
    const customColor = page.getByLabel('Custom color for Offline calendar').locator('..')
    await expect
      .poll(() => preset.evaluate((element) => getComputedStyle(element, '::after').content))
      .toBe('"✓"')
    await expect
      .poll(() => customColor.evaluate((element) => getComputedStyle(element, '::after').content))
      .toBe('none')
  })
})
