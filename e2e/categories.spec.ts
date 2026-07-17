import { test, expect } from '@playwright/test'
import { clearState, seedRecurringEvent } from './fixtures/localstorage'

async function setColorInputValue(
  page: import('@playwright/test').Page,
  label: string,
  color: string
): Promise<void> {
  await page.getByLabel(label).evaluate((input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, color)
}

test.describe('category colors', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
  })

  test('creates a category with a custom color and preserves it when editing', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Categories' }).click()

    await page.locator('[data-action="add-category"]').click()
    await page.getByLabel('New category name').fill('Personal')
    await setColorInputValue(page, 'Custom color for new category', '#123456')
    await page
      .locator('[data-component="add-category-form"]')
      .getByRole('button', { name: 'Add' })
      .click()

    const category = page.locator('[data-component="category-row"]', { hasText: 'Personal' })
    await expect(category).toBeVisible()
    await category.getByText('Personal', { exact: true }).click()
    const customColor = page.getByLabel('Custom color for category Personal')
    await expect(customColor).toHaveValue('#123456')
    await customColor.click()
    await customColor.dispatchEvent('focusout', { relatedTarget: null })
    await expect(page.getByLabel('Category name')).toBeVisible()
    await setColorInputValue(page, 'Custom color for category Personal', '#654321')
    await expect(page.getByLabel('Category name')).toBeHidden()
    await expect(category).toHaveAttribute('data-category-color', '#654321')

    await page.reload()
    await page.getByRole('button', { name: 'Categories' }).click()
    const persistedCategory = page.locator('[data-component="category-row"]', { hasText: 'Personal' })
    await persistedCategory.getByText('Personal', { exact: true }).click()
    await expect(page.getByLabel('Custom color for category Personal')).toHaveValue('#654321')
  })

  test('keeps a category when re-editing one occurrence of a recurring event', async ({ page }) => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const fmt = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

    await seedRecurringEvent(page, {
      id: 'categorized-series', title: 'Recurring category test',
      startDate: fmt(yesterday), endDate: fmt(yesterday), startTime: '10:00', endTime: '11:00',
      frequency: 'daily', interval: 1,
    })
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Categories' }).click()
    await page.locator('[data-action="add-category"]').click()
    await page.getByLabel('New category name').fill('Work')
    await page.locator('[data-component="add-category-form"]').getByRole('button', { name: 'Add' }).click()

    await page.goto('/day')
    const occurrence = page.getByRole('button', { name: /Recurring category test/ }).first()
    await occurrence.click()
    await page.locator('[data-component="event-preview"]').getByRole('button', { name: /Open event/ }).click()
    await page.locator('[data-component="event-title-input"]').fill('Detached category test')
    await page.locator('[data-component="modal-save"]').click()
    await page.getByRole('dialog').filter({ hasText: /Edit recurring event/ })
      .getByRole('button', { name: /This event only/ }).click()

    const detached = page.getByRole('button', { name: /Detached category test/ }).first()
    await detached.click()
    const preview = page.locator('[data-component="event-preview"]')
    await preview.getByText('Detached category test', { exact: true }).click()
    await preview.locator('input[type="text"]').fill('Detached category test updated')
    await preview.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Edit recurring event')).toBeHidden()
    await expect(preview.getByText('Detached category test updated', { exact: true })).toBeVisible()

    await preview.getByRole('button', { name: /Open event/ }).click()
    await page.getByRole('button', { name: 'Work' }).click()
    await page.locator('[data-component="modal-save"]').click()

    await page.getByRole('button', { name: /Detached category test updated/ }).first().click()
    await page.locator('[data-component="event-preview"]').getByRole('button', { name: /Open event/ }).click()
    await expect(page.getByRole('button', { name: 'Work' })).toHaveAttribute('aria-pressed', 'true')
  })
})
