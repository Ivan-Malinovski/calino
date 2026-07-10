/**
 * TodoView composer flow — R1.5 regression net.
 *
 * Pre-R1.5: typing in the TodoView inline composer and pressing Enter
 * opened the task modal with an empty title, forcing the user to retype.
 *
 * Post-R1.5: the modal opens with the composer's text pre-filled in the
 * Title field.
 */
import { test, expect } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

test.describe('TodoView composer forwards title into modal', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
  })

  test('typing a task and pressing Enter pre-fills the modal title', async ({
    page,
  }) => {
    // TodoView is mounted at /tasks (see App.tsx VIEW_ROUTES).
    await page.goto('/tasks')

    // Open the inline composer by clicking "Add task".
    await page.locator('[data-component="add-task-button"]').click()

    // The composer input is identified by its placeholder.
    const composer = page.getByPlaceholder('What needs doing?')
    await expect(composer).toBeVisible()
    await composer.fill('Buy milk')
    await composer.press('Enter')

    // The task modal should now be open with our text in the title input.
    const modal = page.locator('[data-component="modal-card"]')
    await expect(modal).toBeVisible()
    const titleInput = page.locator('[data-component="event-title-input"]')
    await expect(titleInput).toHaveValue('Buy milk')
  })

  test('clearing the composer input and pressing Enter does not open the modal', async ({
    page,
  }) => {
    await page.goto('/tasks')
    await page.locator('[data-component="add-task-button"]').click()

    const composer = page.getByPlaceholder('What needs doing?')
    await expect(composer).toBeVisible()
    // Press Enter with empty content — should NOT open the modal.
    await composer.press('Enter')

    await expect(page.locator('[data-component="modal-card"]')).not.toBeVisible()
  })

  test('Escape on the composer closes composing without opening the modal', async ({
    page,
  }) => {
    await page.goto('/tasks')
    await page.locator('[data-component="add-task-button"]').click()

    const composer = page.getByPlaceholder('What needs doing?')
    await expect(composer).toBeVisible()
    await composer.fill('temporary text')
    await composer.press('Escape')

    await expect(page.locator('[data-component="modal-card"]')).not.toBeVisible()
  })

  test('hides tasks when their calendar is disabled', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'calino-storage',
        JSON.stringify({
          state: {
            calendars: [
              {
                id: 'default',
                name: 'Personal',
                color: '#4285F4',
                isVisible: true,
                isDefault: true,
                showTasksInViews: true,
              },
              {
                id: 'work',
                name: 'Work',
                color: '#EA4335',
                isVisible: true,
                isDefault: false,
                showTasksInViews: true,
              },
            ],
            events: [
              {
                id: 'work-task',
                calendarId: 'work',
                title: 'Hidden work task',
                type: 'task',
                start: '2026-07-10T09:00:00.000Z',
                end: '2026-07-10T09:00:00.000Z',
                isAllDay: false,
                completed: false,
              },
            ],
          },
          version: 1,
        })
      )
    })

    await page.goto('/tasks')
    const todoTask = page.locator('main').getByText('Hidden work task')
    await expect(todoTask).toBeVisible()

    await page.locator('[data-component="calendar-section-toggle"]').click()
    await page.locator('label').filter({ hasText: 'Work' }).getByRole('checkbox').click()

    await expect(todoTask).not.toBeVisible()
  })
})
