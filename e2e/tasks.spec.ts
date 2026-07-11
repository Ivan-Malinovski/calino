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

  const parent = page.locator('main').getByText('Plan trip')
  const child = page.locator('main').getByText('Book hotel')
  const grandchild = page.getByText('Pack bags')
  await expect(parent).toBeVisible()
  await expect(child).toBeVisible()
  await expect(child.locator('xpath=ancestor::*[@data-component="task-row"]')).toHaveAttribute('data-task-depth', '1')
  await expect(grandchild.locator('xpath=ancestor::*[@data-component="task-row"]')).toHaveAttribute('data-task-depth', '2')

  await parent.click()
  await expect(page.locator('[data-component="modal-card"]').getByRole('button', { name: 'Book hotel' })).toBeVisible()
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

test('keeps undated imported tasks out of calendar and agenda views', async ({ page }) => {
  await clearState(page)
  const today = new Date().toISOString()
  await page.addInitScript((today) => {
    localStorage.setItem('calino-storage', JSON.stringify({
      state: {
        calendars: [{ id: 'default', name: 'Offline calendar', color: '#4285F4', isVisible: true, isDefault: true, showTasksInViews: true }],
        events: [
          { id: 'undated', calendarId: 'default', title: 'Imported without due date', type: 'task', start: today, end: today, isAllDay: false, completed: false },
        ],
      }, version: 1,
    }))
  }, today)

  await page.goto('/tasks')
  await expect(page.locator('main').getByText('Imported without due date')).toBeVisible()

  await page.goto('/month')
  await expect(page.locator('[data-component="calendar-grid"]').getByText('Imported without due date')).not.toBeVisible()

  await page.goto('/agenda')
  await expect(page.locator('main').getByText('Imported without due date')).not.toBeVisible()
})

test('filters all tasks by project without changing calendar visibility', async ({ page }) => {
  await clearState(page)
  await page.addInitScript(() => {
    localStorage.setItem('calino-storage', JSON.stringify({
      state: {
        calendars: [
          { id: 'default', name: 'Personal', color: '#4285F4', isVisible: true, isDefault: true, showTasksInViews: true },
          { id: 'work', name: 'Work', color: '#EA4335', isVisible: true, isDefault: false, showTasksInViews: true },
          { id: 'events-only', name: 'Events only', color: '#34A853', isVisible: true, isDefault: false, showTasksInViews: true, supportedComponents: ['VEVENT'] },
        ],
        events: [
          { id: 'personal-task', calendarId: 'default', title: 'Personal task', type: 'task', start: '2026-07-10T09:00:00.000Z', end: '2026-07-10T09:00:00.000Z', isAllDay: false, completed: false },
          { id: 'work-task', calendarId: 'work', title: 'Work task', type: 'task', start: '2026-07-10T09:00:00.000Z', end: '2026-07-10T09:00:00.000Z', isAllDay: false, completed: false },
        ],
      }, version: 1,
    }))
  })

  await page.goto('/tasks')
  const projectFilter = page.locator('[data-component="task-project-filter"]')
  await expect(projectFilter).toBeVisible()
  await projectFilter.click()
  const projectMenu = page.locator('[data-component="task-project-menu"]')
  await expect(projectMenu.getByRole('menuitem', { name: 'Events only' })).not.toBeVisible()
  await projectMenu.getByRole('menuitem', { name: 'Work' }).click()

  const taskList = page.locator('main')
  await expect(taskList.getByText('Work task')).toBeVisible()
  await expect(taskList.getByText('Personal task')).not.toBeVisible()

  await page.locator('[data-component="add-task-button"]').click()
  const composer = page.getByPlaceholder('What needs doing?')
  await composer.fill('New work task')
  await composer.press('Enter')
  await expect(page.locator('[data-component="event-calendar-select"]')).toHaveValue('work')
})
