import { test, expect, type Page } from '@playwright/test'
import { clearState, STORAGE_KEYS } from './fixtures/localstorage'

// Fixed "now": midday on a Wednesday. A date-only task is announced at 9:00, so
// one due today is already three hours late and is picked up by the 12h catch-up.
const NOW = new Date('2026-09-23T12:00:00')

interface Seed {
  taskDueDateReminders: boolean
  overdueTaskBadge: boolean
}

type TestWindow = Window & {
  shownNotifications: Array<{ title: string; body: string }>
  badgeCalls: Array<number | null>
}

function task(id: string, title: string, dueDate: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    uid: id,
    calendarId: 'default',
    title,
    start: `${dueDate}T00:00:00`,
    end: `${dueDate}T00:00:00`,
    dueDate,
    isAllDay: true,
    type: 'task',
    completed: false,
    taskStatus: 'NEEDS-ACTION',
    ...extra,
  }
}

async function seed(page: Page, { taskDueDateReminders, overdueTaskBadge }: Seed): Promise<void> {
  await clearState(page)
  await page.clock.install({ time: NOW })
  await page.addInitScript(
    ({ keys, settings, events }) => {
      const read = (key: string, fallback: unknown): { state: Record<string, unknown> } => {
        const raw = localStorage.getItem(key)
        return raw ? JSON.parse(raw) : (fallback as { state: Record<string, unknown> })
      }
      const savedSettings = read(keys.settings, { state: {}, version: 0 })
      savedSettings.state = {
        ...savedSettings.state,
        language: 'en',
        enableDesktopNotifications: true,
        ...settings,
      }
      localStorage.setItem(keys.settings, JSON.stringify(savedSettings))

      const savedCalendar = read(keys.calendar, { state: {}, version: 2 })
      savedCalendar.state = { ...savedCalendar.state, events }
      localStorage.setItem(keys.calendar, JSON.stringify(savedCalendar))

      const w = window as unknown as TestWindow
      w.shownNotifications = []
      w.badgeCalls = []
      class MockNotification {
        static permission = 'granted'
        onclick: (() => void) | null = null
        constructor(title: string, options: { body: string }) {
          w.shownNotifications.push({ title, body: options.body })
        }
        close() {}
      }
      Object.defineProperty(window, 'Notification', { value: MockNotification, configurable: true })
      Object.defineProperty(navigator, 'setAppBadge', {
        value: (count?: number) => {
          w.badgeCalls.push(count ?? null)
          return Promise.resolve()
        },
        configurable: true,
      })
      Object.defineProperty(navigator, 'clearAppBadge', {
        value: () => {
          w.badgeCalls.push(0)
          return Promise.resolve()
        },
        configurable: true,
      })
    },
    {
      keys: STORAGE_KEYS,
      settings: { taskDueDateReminders, overdueTaskBadge },
      events: [
        task('due-today', 'File the taxes', '2026-09-23'),
        task('overdue-1', 'Renew passport', '2026-09-20'),
        task('overdue-2', 'Call the plumber', '2026-09-22'),
        task('overdue-done', 'Already done', '2026-09-10', { completed: true, taskStatus: 'COMPLETED' }),
        task('later', 'Next month', '2026-10-30'),
      ],
    }
  )
}

const shown = (page: Page): Promise<Array<{ title: string; body: string }>> =>
  page.evaluate(() => (window as unknown as TestWindow).shownNotifications)
const lastBadge = (page: Page): Promise<number | null | undefined> =>
  page.evaluate(() => (window as unknown as TestWindow).badgeCalls.at(-1))

test.describe('Task due-date reminders', () => {
  test('announce a task that is due today, and only that one', async ({ page }) => {
    await seed(page, { taskDueDateReminders: true, overdueTaskBadge: false })
    await page.goto('/')
    await expect.poll(() => shown(page)).toContainEqual({ title: 'File the taxes', body: 'Due today' })
    const titles = (await shown(page)).map((n) => n.title)
    expect(titles).not.toContain('Already done')
    expect(titles).not.toContain('Next month')
  })

  test('stay quiet when the setting is off', async ({ page }) => {
    await seed(page, { taskDueDateReminders: false, overdueTaskBadge: false })
    await page.goto('/')
    await page.clock.runFor(2 * 60_000)
    await expect(page.locator('[data-component="calendar-grid"], main').first()).toBeVisible()
    expect(await shown(page)).toEqual([])
  })
})

test.describe('Overdue task badge', () => {
  test('puts the number of overdue open tasks on the app icon', async ({ page }) => {
    await seed(page, { taskDueDateReminders: false, overdueTaskBadge: true })
    await page.goto('/')
    // Two open tasks are past due; today's, the completed one and next month's are not.
    await expect.poll(() => lastBadge(page)).toBe(2)
  })

  test('leaves the icon alone when the setting is off', async ({ page }) => {
    await seed(page, { taskDueDateReminders: false, overdueTaskBadge: false })
    await page.goto('/')
    await page.clock.runFor(2 * 60_000)
    expect((await lastBadge(page)) ?? 0).toBe(0)
  })

  test('counts a task as overdue once its day has passed', async ({ page }) => {
    await seed(page, { taskDueDateReminders: false, overdueTaskBadge: true })
    await page.goto('/')
    await expect.poll(() => lastBadge(page)).toBe(2)
    // Midnight rolls over: today's task joins the overdue ones.
    await page.clock.fastForward(13 * 60 * 60_000)
    await expect.poll(() => lastBadge(page)).toBe(3)
  })

  test('follows the Tasks settings toggle, including when it is switched off', async ({ page }) => {
    await seed(page, { taskDueDateReminders: false, overdueTaskBadge: false })
    await page.goto('/settings?tab=tasks')
    const toggle = page.locator('[data-component="toggle"][data-setting="overdue-task-badge"]')
    // The Settings page is not the calendar: the badge must still react here.
    await toggle.click()
    await expect.poll(() => lastBadge(page)).toBe(2)
    await toggle.click()
    await expect.poll(() => lastBadge(page)).toBe(0)
  })
})
