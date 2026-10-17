/**
 * Right-clicking while a context menu is already open.
 *
 * User flow on /tasks:
 *   - Right-click a task: its menu opens.
 *   - Right-click another task (or the same one again) while that menu is
 *     open: the menu moves to the new spot and stays open. It must not flash
 *     open and then close by itself.
 */
import { test, expect, type Page } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

async function seedTasks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      if (sessionStorage.getItem('__calino_test_menu_reopen')) return
      sessionStorage.setItem('__calino_test_menu_reopen', '1')
      const day = '2026-07-10'
      const events = ['One', 'Two', 'Three'].map((title, i) => ({
        id: `t${i}`,
        uid: `t${i}`,
        calendarId: 'default',
        title,
        type: 'task',
        start: `${day}T00:00:00`,
        end: `${day}T00:00:00`,
        dueDate: day,
        isAllDay: true,
        completed: false,
        sortOrder: (i + 1) * 1000,
      }))
      const raw = localStorage.getItem('calino-storage')
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 1 }
      parsed.state = {
        ...(parsed.state ?? {}),
        events,
        calendars: [
          {
            id: 'default',
            name: 'Personal',
            color: '#4285F4',
            isVisible: true,
            isDefault: true,
            showTasksInViews: true,
          },
        ],
      }
      localStorage.setItem('calino-storage', JSON.stringify(parsed))
    } catch {
      /* noop */
    }
  })
}

test.describe('Task context menu: right-click while open', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await seedTasks(page)
    await page.goto('/tasks')
    await expect(page.locator('[data-task-id="t0"]')).toBeVisible()
  })

  test('right-clicking another task keeps the menu open', async ({ page }) => {
    const menu = page.getByRole('button', { name: 'Edit', exact: true })
    await page.locator('[data-task-id="t0"]').click({ button: 'right' })
    await expect(menu).toBeVisible()

    // Left edge: the open menu is drawn from the cursor rightwards and would
    // otherwise cover the middle of the next row.
    await page
      .locator('[data-task-id="t1"]')
      .click({ button: 'right', position: { x: 40, y: 10 } })
    // Longer than the 100ms close animation: a menu that is going to close
    // itself has done so by now.
    await page.waitForTimeout(400)
    await expect(menu).toBeVisible()
    await expect(menu).toHaveCount(1)
  })

  test('right-clicking the same task again keeps the menu open', async ({ page }) => {
    const menu = page.getByRole('button', { name: 'Edit', exact: true })
    const row = page.locator('[data-task-id="t0"]')
    await row.click({ button: 'right' })
    await expect(menu).toBeVisible()

    await row.click({ button: 'right', position: { x: 40, y: 10 } })
    await page.waitForTimeout(400)
    await expect(menu).toBeVisible()
  })

  test('clicking elsewhere still closes the menu', async ({ page }) => {
    const menu = page.getByRole('button', { name: 'Edit', exact: true })
    await page.locator('[data-task-id="t0"]').click({ button: 'right' })
    await expect(menu).toBeVisible()
    await page.mouse.click(5, 5)
    await expect(menu).toHaveCount(0)
  })
})
