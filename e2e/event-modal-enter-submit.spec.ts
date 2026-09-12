/**
 * Enter in the event/task title submits the form.
 *
 * The title input lives in the modal header, above the <form>, so it used to
 * be a stray control: Enter in it did nothing and the only way to save was
 * to click Create. It is now tied to the form by id (issue #150).
 */
import { test, expect } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

test.describe('event modal — Enter in the title submits', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test.beforeEach(async ({ page }) => {
    await clearState(page)
  })

  test('creates an event from the title field alone', async ({ page }) => {
    await page.goto('/month')
    await expect(page.locator('[data-component="header"]')).toBeVisible()

    await page.keyboard.press('c')
    const modal = page.locator('[data-component="modal-card"]')
    await expect(modal).toBeVisible()

    const title = modal.locator('[data-component="event-title-input"]')
    await expect(title).toBeFocused()
    await title.fill('Enter creates me')
    await title.press('Enter')

    await expect(modal).not.toBeVisible()
    await expect(
      page.locator('[data-component="calendar-grid"]').getByText('Enter creates me')
    ).toBeVisible()
  })

  test('creates a task from the composer with two Enters', async ({ page }) => {
    await page.goto('/tasks')
    await page.locator('[data-component="add-task-button"]').click()

    const composer = page.getByPlaceholder('What needs doing?')
    await composer.fill('Enter creates a task')
    await composer.press('Enter')

    const modal = page.locator('[data-component="modal-card"]')
    await expect(modal).toBeVisible()
    const title = modal.locator('[data-component="event-title-input"]')
    await expect(title).toHaveValue('Enter creates a task')
    await expect(title).toBeFocused()
    await title.press('Enter')

    await expect(modal).not.toBeVisible()
    await expect(page.locator('main').getByText('Enter creates a task')).toBeVisible()
  })
})
