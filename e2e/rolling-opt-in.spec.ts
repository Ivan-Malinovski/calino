import { test, expect, type Page } from '@playwright/test'
import { clearState, STORAGE_KEYS } from './fixtures/localstorage'

// Opt-in guarantee: an EXISTING user's calendar has no `taskCompletionMode` key.
// Completing a repeat must keep the override shape and change nothing but the
// prompt (which only appears for a recognised Tasks.org/OpenTasks list).
const CALENDAR = {
  id: 'default',
  name: 'Offline calendar',
  color: '#4285F4',
  isVisible: true,
  isDefault: true,
  showTasksInViews: true,
}
const MASTER = {
  id: 'gym',
  uid: 'gym',
  calendarId: 'default',
  title: 'Exercise',
  type: 'task',
  start: '2026-03-03T00:00:00',
  end: '2026-03-03T23:59:59',
  dueDate: '2026-03-03',
  isAllDay: true,
  rruleString: 'FREQ=WEEKLY;BYDAY=TU',
  recurrence: { frequency: 'weekly', interval: 1, byWeekday: [2] },
  completed: false,
  taskStatus: 'NEEDS-ACTION',
}

async function seed(page: Page, master: Record<string, unknown>): Promise<void> {
  await clearState(page)
  await page.addInitScript(
    ({ calendar, events, keys }) => {
      if (sessionStorage.getItem('__seeded')) return
      sessionStorage.setItem('__seeded', '1')
      localStorage.setItem(
        keys.calendar,
        JSON.stringify({ state: { calendars: [calendar], events }, version: 1 })
      )
      const raw = localStorage.getItem(keys.settings)
      const saved = raw ? JSON.parse(raw) : { state: {}, version: 0 }
      saved.state = { ...(saved.state ?? {}), language: 'en' }
      localStorage.setItem(keys.settings, JSON.stringify(saved))
    },
    { calendar: CALENDAR, events: [master], keys: STORAGE_KEYS }
  )
}
const state = (page: Page) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).state, STORAGE_KEYS.calendar)

async function complete(page: Page): Promise<void> {
  await page.goto('/tasks')
  await page
    .locator('[data-component="task-row"]')
    .filter({ hasText: 'Exercise' })
    .first()
    .getByLabel('Mark as complete')
    .click()
}

test('field absent + Tasks.org PRODID: override shape, prompt only, nothing switched', async ({
  page,
}) => {
  await seed(page, { ...MASTER, clientProdid: '+//IDN tasks.org//android-151202//EN' })
  await complete(page)
  const prompt = page.locator('[data-sonner-toast]', { hasText: 'edited by Tasks.org' })
  await expect(prompt).toHaveCount(1)
  await page.waitForTimeout(1500)
  const s = await state(page)
  const tasks = s.events.filter((e: { type: string }) => e.type === 'task')
  const master = tasks.find((t: { recurrenceId?: string }) => !t.recurrenceId)
  const override = tasks.find((t: { recurrenceId?: string }) => t.recurrenceId)
  expect(master.start).toBe('2026-03-03T00:00:00') // master not rolled
  expect(override?.recurrenceId).toBe('2026-03-03T00:00:00') // override written
  expect(tasks).toHaveLength(2) // no extra completed copy
  expect(s.calendars[0].taskCompletionMode).toBeUndefined() // still unset
  expect(s.calendars[0].rollingPromptDismissed).toBeUndefined()
})

test('field absent + no recognised client: no prompt, override shape, mode untouched', async ({
  page,
}) => {
  await seed(page, MASTER)
  await complete(page)
  await page.waitForTimeout(1500)
  await expect(page.locator('[data-sonner-toast]', { hasText: 'Tasks.org' })).toHaveCount(0)
  const s = await state(page)
  const tasks = s.events.filter((e: { type: string }) => e.type === 'task')
  expect(tasks).toHaveLength(2)
  expect(tasks.some((t: { recurrenceId?: string }) => t.recurrenceId)).toBe(true)
  expect(s.calendars[0].taskCompletionMode).toBeUndefined()
})
