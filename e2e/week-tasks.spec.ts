import { test, expect } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

// Wednesday 30 Sep 2026; the Monday-start week is 28 Sep – 4 Oct.
const NOW = new Date('2026-09-30T10:00:00')

const task = (id: string, title: string, start: string, due: string, extra = {}) => ({
  id,
  calendarId: 'default',
  title,
  type: 'task',
  start: `${start}T00:00:00`,
  end: `${due}T00:00:00`,
  dueDate: `${due}T00:00:00`,
  isAllDay: true,
  completed: false,
  ...extra,
})

test.describe('Week view: sometime-this-week tasks', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await page.clock.setFixedTime(NOW)
    await page.addInitScript(
      (events) => {
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
              events,
            },
            version: 1,
          })
        )
      },
      [
        task('week-a', 'Call the plumber', '2026-09-28', '2026-10-04'),
        task('week-b', 'Book flights', '2026-09-30', '2026-10-04'),
        task('two-day', 'Two day thing', '2026-09-29', '2026-09-30'),
        task('one-day', 'Water plants', '2026-10-01', '2026-10-01'),
      ]
    )
    await page.goto('/week')
  })

  test('lists multi-day tasks in the bar, ordered by start date', async ({ page }) => {
    const bar = page.locator('[data-component="week-tasks-bar"]')
    await expect(bar).toContainText('Sometime this week')
    const pills = bar.locator('[data-component="week-task-pill"]')
    await expect(pills).toHaveText(['Call the plumber', 'Book flights'])
    await expect(pills.first()).toHaveAttribute('title', /Call the plumber/)
  })

  test('keeps one- and two-day tasks in their day column, not the bar', async ({ page }) => {
    const bar = page.locator('[data-component="week-tasks-bar"]')
    await expect(bar.getByText('Water plants')).toHaveCount(0)
    await expect(bar.getByText('Two day thing')).toHaveCount(0)
    await expect(page.getByText('Water plants')).toBeVisible()
  })

  test('ticking a pill completes the task', async ({ page }) => {
    const pill = page.locator('[data-testid="week-task-week-a"]')
    await pill.getByRole('checkbox').check()
    await expect(pill.getByRole('checkbox')).toBeChecked()
  })

  test('multi-day tasks do not appear a second time under their due day', async ({ page }) => {
    await expect(page.getByText('Call the plumber')).toHaveCount(1)
  })
})
