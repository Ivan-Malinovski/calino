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
  test('typing in the bar adds a task for the whole week', async ({ page }) => {
    const bar = page.locator('[data-component="week-tasks-bar"]')
    const input = bar.locator('[data-component="week-task-quick-add"]')
    await expect(input).toHaveCount(0)
    await bar.locator('[data-component="week-task-add"]').click()
    await input.fill('Sort the garage')
    await input.press('Enter')
    const pill = bar.locator('[data-component="week-task-pill"]', { hasText: 'Sort the garage' })
    await expect(pill).toBeVisible()
    await expect(pill).toHaveAttribute('data-week-start', '2026-09-28')
    await expect(input).toHaveValue('')
  })

  test('the + reveals a field whose … opens the task form pre-set to this week and saves it to the bar', async ({
    page,
  }) => {
    const bar = page.locator('[data-component="week-tasks-bar"]')
    await bar.locator('[data-component="week-task-add"]').click()
    await bar.locator('[data-component="week-task-quick-add"]').fill('Renew passport')
    await bar.locator('[data-component="week-task-add-details"]').click()

    const modal = page.getByRole('dialog')
    await expect(modal.locator('[data-component="event-title-input"]')).toHaveValue(
      'Renew passport'
    )
    await expect(modal.locator('#task-start-date')).toHaveValue('2026-09-28')
    await expect(modal.locator('#due-date')).toHaveValue('2026-10-04')
    await expect(modal.locator('[data-component="task-start-hint"]')).toContainText(
      'Sometime this week'
    )

    await modal.locator('[data-component="modal-save"]').click()
    await expect(
      bar.locator('[data-component="week-task-pill"]', { hasText: 'Renew passport' })
    ).toBeVisible()
  })

  test('the task form can turn a one-day task into a week task', async ({ page }) => {
    await page.getByText('Water plants').click()
    const modal = page.getByRole('dialog')
    await modal.locator('[data-component="task-sometime-this-week"]').click()
    await expect(modal.locator('#task-start-date')).toHaveValue('2026-09-28')
    await expect(modal.locator('#due-date')).toHaveValue('2026-10-04')
    await modal.locator('[data-component="modal-save"]').click()

    const bar = page.locator('[data-component="week-tasks-bar"]')
    await expect(
      bar.locator('[data-component="week-task-pill"]', { hasText: 'Water plants' })
    ).toBeVisible()
  })
  test('right-clicking a pill opens the task menu', async ({ page }) => {
    await page.locator('[data-testid="week-task-week-a"]').click({ button: 'right' })
    await expect(page.getByText('Move to next week')).toBeVisible()
    await page.getByText('Edit', { exact: true }).click()
    await expect(page.getByRole('dialog').locator('#task-start-date')).toHaveValue('2026-09-28')
  })

  test('the week-task form keeps priority beside the parent and the buttons beside the dates', async ({
    page,
  }) => {
    await page.locator('[data-testid="week-task-week-a"] button').click()
    const modal = page.getByRole('dialog')
    await modal.screenshot({ path: 'e2e/test-results/week-task-modal.png' })
    const parentBox = await modal.locator('#parent-task-select').boundingBox()
    const priorityBox = await modal.locator('#priority-select').boundingBox()
    const dueBox = await modal.locator('#due-date').boundingBox()
    const buttonBox = await modal
      .locator('[data-component="task-sometime-this-week"]')
      .boundingBox()
    expect(Math.abs(parentBox!.y - priorityBox!.y)).toBeLessThan(4)
    expect(Math.abs(dueBox!.y - buttonBox!.y)).toBeLessThan(12)
    expect(buttonBox!.x).toBeGreaterThan(dueBox!.x + dueBox!.width - 1)
  })

  test('the label is vertically centred on the pills', async ({ page }) => {
    const bar = page.locator('[data-component="week-tasks-bar"]')
    const label = await bar.getByText('Sometime this week').boundingBox()
    const pill = await bar.locator('[data-component="week-task-pill"]').first().boundingBox()
    const mid = (b: { y: number; height: number }) => b.y + b.height / 2
    expect(Math.abs(mid(label!) - mid(pill!))).toBeLessThan(1)
  })
})
