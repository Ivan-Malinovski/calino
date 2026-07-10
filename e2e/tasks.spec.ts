import { test, expect } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

test('renders imported subtasks beneath their parent', async ({ page }) => {
  await clearState(page)
  await page.addInitScript(() => {
    localStorage.setItem('calino-storage', JSON.stringify({
      state: {
        calendars: [{ id: 'default', name: 'Offline calendar', color: '#4285F4', isVisible: true, isDefault: true, showTasksInViews: true }],
        events: [
          { id: 'parent', calendarId: 'default', title: 'Plan trip', type: 'task', start: '2026-07-10T09:00:00.000Z', end: '2026-07-10T09:00:00.000Z', isAllDay: false, completed: false },
          { id: 'child', calendarId: 'default', title: 'Book hotel', parentTaskId: 'parent', type: 'task', start: '2026-07-11T09:00:00.000Z', end: '2026-07-11T09:00:00.000Z', isAllDay: false, completed: false },
          { id: 'grandchild', calendarId: 'default', title: 'Pack bags', parentTaskId: 'child', type: 'task', start: '2026-07-12T09:00:00.000Z', end: '2026-07-12T09:00:00.000Z', isAllDay: false, completed: false },
        ],
      }, version: 1,
    }))
  })

  await page.goto('/tasks')

  const parent = page.getByText('Plan trip')
  const child = page.getByText('Book hotel')
  const grandchild = page.getByText('Pack bags')
  await expect(parent).toBeVisible()
  await expect(child).toBeVisible()
  await expect(child.locator('xpath=ancestor::*[@data-component="task-row"]')).toHaveAttribute('data-task-depth', '1')
  await expect(grandchild.locator('xpath=ancestor::*[@data-component="task-row"]')).toHaveAttribute('data-task-depth', '2')
})

test('shows only parent tasks in the sidebar', async ({ page }) => {
  await clearState(page)
  await page.addInitScript(() => {
    localStorage.setItem('calino-storage', JSON.stringify({
      state: {
        calendars: [{ id: 'default', name: 'Offline calendar', color: '#4285F4', isVisible: true, isDefault: true, showTasksInViews: true }],
        events: [
          { id: 'parent', calendarId: 'default', title: 'Plan trip', type: 'task', start: '2026-07-10T09:00:00.000Z', end: '2026-07-10T09:00:00.000Z', isAllDay: false, completed: false },
          { id: 'child', calendarId: 'default', title: 'Book hotel', parentTaskId: 'parent', type: 'task', start: '2026-07-10T09:00:00.000Z', end: '2026-07-10T09:00:00.000Z', isAllDay: false, completed: false },
        ],
      }, version: 1,
    }))
  })

  await page.goto('/month')
  const tasksHeader = page.locator('[data-component="tasks-header"]')
  if (await tasksHeader.getAttribute('aria-expanded') === 'false') await tasksHeader.click()

  const sidebarTasks = page.locator('[data-component="tasks-section"]')
  await expect(sidebarTasks.getByText('Plan trip')).toBeVisible()
  await expect(sidebarTasks.getByText('Book hotel')).not.toBeVisible()
})

test('hides tasks from disabled calendars in the sidebar', async ({ page }) => {
  await clearState(page)
  await page.addInitScript(() => {
    localStorage.setItem('calino-storage', JSON.stringify({
      state: {
        calendars: [
          { id: 'default', name: 'Offline calendar', color: '#4285F4', isVisible: true, isDefault: true, showTasksInViews: true },
          { id: 'hidden', name: 'Hidden calendar', color: '#EA4335', isVisible: false, isDefault: false, showTasksInViews: true },
        ],
        events: [
          { id: 'hidden-task', calendarId: 'hidden', title: 'Hidden sidebar task', type: 'task', start: '2026-07-10T09:00:00.000Z', end: '2026-07-10T09:00:00.000Z', isAllDay: false, completed: false },
        ],
      }, version: 1,
    }))
  })

  await page.goto('/month')
  const tasksHeader = page.locator('[data-component="tasks-header"]')
  if (await tasksHeader.getAttribute('aria-expanded') === 'false') await tasksHeader.click()

  await expect(page.locator('[data-component="tasks-section"]').getByText('Hidden sidebar task')).not.toBeVisible()
})
