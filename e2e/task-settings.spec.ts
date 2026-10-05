import { test, expect, type Page } from '@playwright/test'
import { clearState, STORAGE_KEYS } from './fixtures/localstorage'

const movedSettings = [
  {
    setting: 'hide-completed-tasks',
    label: 'Hide Completed Tasks',
    key: 'hideCompletedTasksInMonthView',
    initial: true,
  },
  {
    setting: 'task-due-date-reminders',
    label: 'Task Due Date Reminders',
    key: 'taskDueDateReminders',
    initial: true,
  },
  {
    setting: 'overdue-task-badge',
    label: 'Overdue Task Badge',
    key: 'overdueTaskBadge',
    initial: false,
  },
] as const

async function seedEnglish(page: Page): Promise<void> {
  await page.addInitScript((keys) => {
    const raw = localStorage.getItem(keys.settings)
    const saved = raw ? JSON.parse(raw) : { state: {}, version: 0 }
    saved.state = { ...saved.state, language: 'en' }
    localStorage.setItem(keys.settings, JSON.stringify(saved))
  }, STORAGE_KEYS)
}

async function storedSetting(page: Page, key: string): Promise<unknown> {
  return page.evaluate(
    ({ storageKey, key }) => JSON.parse(localStorage.getItem(storageKey)!).state[key],
    { storageKey: STORAGE_KEYS.settings, key }
  )
}

test.describe('Task settings', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await seedEnglish(page)
  })

  test('Tasks tab groups display and reminder settings', async ({ page }) => {
    await page.goto('/settings?tab=tasks')
    const section = page.locator('[data-component="tasks-settings"]')
    await expect(section.locator('[data-component="setting-row"]')).toHaveCount(5)
    for (const { setting, label, initial } of movedSettings) {
      const row = section.locator(`[data-component="setting-row"][data-setting="${setting}"]`)
      await expect(row).toHaveAttribute('data-value', String(initial))
      await expect(row.getByLabel(label)).toBeChecked({ checked: initial })
    }
    await expect(section.getByText('Reminders', { exact: true })).toBeVisible()
  })

  for (const { setting, label, key, initial } of movedSettings) {
    test(`${label} toggles from the Tasks tab and persists`, async ({ page }) => {
      await page.goto('/settings?tab=tasks')
      const section = page.locator('[data-component="tasks-settings"]')
      await section.locator(`[data-component="toggle"][data-setting="${setting}"]`).click()
      await expect.poll(() => storedSetting(page, key)).toBe(!initial)
      await page.reload()
      await expect(section.getByLabel(label)).toBeChecked({ checked: !initial })
    })
  }

  test('Calendar and Notifications tabs no longer list the task settings', async ({ page }) => {
    for (const tab of ['calendar', 'notifications']) {
      await page.goto(`/settings?tab=${tab}`)
      await expect(page.locator('[data-component="setting-row"]').first()).toBeVisible()
      for (const { setting } of movedSettings) {
        await expect(
          page.locator(`[data-component="setting-row"][data-setting="${setting}"]`)
        ).toHaveCount(0)
      }
    }
  })
})
