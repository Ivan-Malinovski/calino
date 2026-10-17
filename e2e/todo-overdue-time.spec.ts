/**
 * /tasks grouping for a timed task due today.
 *
 * Grouping used to be date-only, so a task due today at a time that had
 * already passed stayed under "Today". It belongs under "Overdue" once its
 * time is behind the clock; a date-only task due today stays under "Today"
 * until the day is over.
 *
 * The list is virtualized and a group header is a sibling row, not a parent
 * of its tasks, so membership is read from vertical order: a task in the
 * overdue group sits between the "Overdue" and "Today" headings.
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { clearState, STORAGE_KEYS } from './fixtures/localstorage'

// Fixed "now": midday on a Wednesday.
const NOW = new Date('2026-09-23T12:00:00')
const TODAY = '2026-09-23'

function task(id: string, title: string, due: string, isAllDay: boolean) {
  return {
    id,
    uid: id,
    calendarId: 'default',
    title,
    start: due,
    end: due,
    dueDate: due,
    isAllDay,
    type: 'task',
    completed: false,
    taskStatus: 'NEEDS-ACTION',
  }
}

async function seedTasks(page: Page): Promise<void> {
  await page.addInitScript(
    ({ key, events }) => {
      try {
        if (sessionStorage.getItem('__calino_test_todo_overdue_time')) return
        sessionStorage.setItem('__calino_test_todo_overdue_time', '1')
        const raw = localStorage.getItem(key)
        const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
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
        localStorage.setItem(key, JSON.stringify(parsed))
      } catch {
        /* noop */
      }
    },
    {
      key: STORAGE_KEYS.calendar,
      events: [
        task('standup', 'Morning standup', `${TODAY}T09:00:00`, false),
        task('review', 'Evening review', `${TODAY}T17:00:00`, false),
        task('taxes', 'File the taxes', TODAY, true),
      ],
    }
  )
}

const top = async (locator: Locator): Promise<number> =>
  (await locator.boundingBox())?.y ?? Number.NaN

test.describe('/tasks — a timed task due today turns overdue once its time passes', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await page.clock.install({ time: NOW })
    await seedTasks(page)
  })

  test('groups by the time of day, not just the date', async ({ page }) => {
    await page.goto('/tasks')
    const list = page.locator('[data-component="todo-task-list"]')
    const overdueHeading = list.getByRole('heading', { name: 'Overdue', exact: true })
    const todayHeading = list.getByRole('heading', { name: 'Today', exact: true })
    const row = (title: string): Locator =>
      list.locator('[data-component="task-row"]').filter({ hasText: title })

    await expect(overdueHeading).toBeVisible()
    await expect(todayHeading).toBeVisible()
    await expect(row('Evening review')).toBeVisible()
    await expect(row('File the taxes')).toBeVisible()

    // 12:00 — the 09:00 task is overdue; the 17:00 and date-only ones are today's.
    expect(await top(overdueHeading)).toBeLessThan(await top(row('Morning standup')))
    expect(await top(row('Morning standup'))).toBeLessThan(await top(todayHeading))
    expect(await top(todayHeading)).toBeLessThan(await top(row('Evening review')))
    expect(await top(todayHeading)).toBeLessThan(await top(row('File the taxes')))

    // 17:01 — the evening task follows it; the date-only one stays under today.
    await page.clock.fastForward('05:01:00')
    await expect
      .poll(async () => (await top(row('Evening review'))) < (await top(todayHeading)))
      .toBe(true)
    expect(await top(overdueHeading)).toBeLessThan(await top(row('Evening review')))
    expect(await top(todayHeading)).toBeLessThan(await top(row('File the taxes')))
  })
})
