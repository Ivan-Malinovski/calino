import { test, expect } from '@playwright/test'
import { clearState, STORAGE_KEYS } from './fixtures/localstorage'

// Issue #220 — the task editor showed its dates in the browser's locale
// (10/17/2026) and ignored the "Date format" setting. The fields must type and
// display in the configured format while the stored date stays yyyy-MM-dd.

const CALENDAR = {
  id: 'default',
  name: 'Offline calendar',
  color: '#4285F4',
  isVisible: true,
  isDefault: true,
  showTasksInViews: true,
}

const TASK = {
  id: 'report',
  uid: 'report',
  calendarId: 'default',
  title: 'File report',
  type: 'task',
  start: '2026-10-17T00:00:00',
  end: '2026-10-17T23:59:59',
  dueDate: '2026-10-17',
  isAllDay: true,
  completed: false,
  taskStatus: 'NEEDS-ACTION',
}

async function openTask(page: import('@playwright/test').Page, dateFormat: string): Promise<void> {
  await clearState(page)
  await page.addInitScript(
    ({ calendar, task, dateFormat, settingsKey }) => {
      localStorage.setItem(
        'calino-storage',
        JSON.stringify({ state: { calendars: [calendar], events: [task] }, version: 1 })
      )
      localStorage.setItem(
        settingsKey,
        JSON.stringify({ state: { dateFormat, hasCompletedOnboarding: true }, version: 4 })
      )
    },
    { calendar: CALENDAR, task: TASK, dateFormat, settingsKey: STORAGE_KEYS.settings }
  )
  await page.goto('/tasks')
  await page.locator('[data-component="task-row"]').filter({ hasText: 'File report' }).click()
  await expect(page.locator('[data-component="modal-card"]')).toBeVisible()
}

const FORMATS = [
  ['dd/MM/yyyy', '17/10/2026'],
  ['MM/dd/yyyy', '10/17/2026'],
  ['yyyy-MM-dd', '2026-10-17'],
] as const

for (const [dateFormat, shown] of FORMATS) {
  test(`task due date is shown as ${dateFormat}`, async ({ page }) => {
    await openTask(page, dateFormat)
    await expect(page.locator('#due-date')).toHaveValue(shown)
  })
}

test('typing a due date in the configured format changes the task date', async ({ page }) => {
  await openTask(page, 'dd/MM/yyyy')
  const due = page.locator('#due-date')

  await due.fill('05/11/2026')
  await due.blur()
  await expect(due).toHaveValue('05/11/2026')

  // An impossible date is rejected and the field falls back to the last good one.
  await due.fill('31/02/2026')
  await due.blur()
  await expect(due).toHaveValue('05/11/2026')

  await due.press('ArrowUp')
  await expect(due).toHaveValue('06/11/2026')
})

test('the mouse wheel over the focused due date steps it a day', async ({ page }) => {
  await openTask(page, 'dd/MM/yyyy')
  const due = page.locator('#due-date')

  await due.focus()
  await due.hover()
  await page.mouse.wheel(0, -100)
  await expect(due).toHaveValue('18/10/2026')

  await page.mouse.wheel(0, 100)
  await expect(due).toHaveValue('17/10/2026')
})

test('the calendar picker is anchored to the date field', async ({ page }) => {
  await openTask(page, 'dd/MM/yyyy')

  // A zero-size anchor makes the browser open the picker at the top-left of the
  // screen. Both rects are read in one call so the modal's open animation can't
  // move one between the two reads.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const field = document.querySelector('#due-date')!.getBoundingClientRect()
        const anchor = document
          .querySelector('#due-date')!
          .parentElement!.querySelector('input[type="date"]')!
          .getBoundingClientRect()
        return {
          sized: anchor.width > 0 && anchor.height > 0,
          dx: Math.abs(anchor.x - field.x),
          dy: Math.abs(anchor.y - field.y),
        }
      })
    )
    .toEqual({ sized: true, dx: 0, dy: 0 })
})
