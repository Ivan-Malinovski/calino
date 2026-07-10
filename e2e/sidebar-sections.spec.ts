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
})
