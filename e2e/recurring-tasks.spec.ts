import { readFile } from 'node:fs/promises'
import { test, expect, type Page } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

// R2.7 — Recurring tasks (recurring VTODOs), issue #96.
//
// A repeating task is one master carrying an RRULE; each completed occurrence
// is a separate component with the same UID and a RECURRENCE-ID. The Tasks list
// collapses the series to a single row on its next open occurrence.
//
// 2026-03-03 is a Tuesday, so FREQ=WEEKLY;BYDAY=TU falls on the 3rd, 10th,
// 17th... These dates are deliberately fixed — the whole point of the feature
// is landing on the right calendar day.

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
  // Shaped the way EventModal writes an all-day task: end is the SAME day at
  // 23:59:59, which is what previously pushed occurrences onto the next day.
  start: '2026-03-03T00:00:00',
  end: '2026-03-03T23:59:59',
  dueDate: '2026-03-03',
  isAllDay: true,
  rruleString: 'FREQ=WEEKLY;BYDAY=TU',
  recurrence: { frequency: 'weekly', interval: 1, byWeekday: [2] },
  completed: false,
  taskStatus: 'NEEDS-ACTION',
}

async function seed(page: Page, events: unknown[]): Promise<void> {
  await clearState(page)
  await page.addInitScript(
    ({ calendar, events }) => {
      localStorage.setItem(
        'calino-storage',
        JSON.stringify({ state: { calendars: [calendar], events }, version: 1 })
      )
    },
    { calendar: CALENDAR, events }
  )
}

async function searchTask(page: Page, title: string) {
  await page.getByRole('button', { name: 'Search or commands' }).click()
  const palette = page.locator('[data-component="command-palette"]')
  await palette.getByRole('combobox').fill(title)
  return { palette, result: palette.getByRole('option', { name: new RegExp(`^${title}`) }) }
}

test('search opens the overdue monthly occurrence and its download retains the open task', async ({
  page,
}) => {
  const monthly = {
    ...MASTER,
    title: 'Monthly boiler check',
    rruleString: 'FREQ=MONTHLY',
    recurrence: { frequency: 'monthly', interval: 1 },
  }
  await page.clock.setFixedTime(new Date('2026-03-02T12:00:00Z'))
  await seed(page, [monthly])
  await page.goto('/month')

  const { result } = await searchTask(page, monthly.title)
  await expect(result).toContainText('3 Mar 2026')

  await page.clock.setFixedTime(new Date('2026-03-06T12:00:00Z'))
  await page.goto('/tasks')
  await expect(page.getByRole('heading', { name: 'Overdue', exact: true })).toBeVisible()
  await expect(
    page
      .locator('[data-component="task-row"]')
      .filter({ hasText: monthly.title })
      .getByLabel('Mark as complete')
  ).toBeVisible()

  await page.goto('/month')
  await searchTask(page, monthly.title)
  await expect(result).toContainText('3 Mar 2026')
  await result.click()
  await expect(page.locator('#due-date')).toHaveValue('03/03/2026')

  const footer = page.locator('[data-component="modal-footer"]')
  await footer.locator('[data-component="event-actions-menu-btn"]').click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    footer.locator('[data-component="export-event-ics"]').click(),
  ])
  const ics = await readFile((await download.path())!, 'utf8')
  expect(ics).toContain('DUE;VALUE=DATE:20260303')
  expect(ics).toContain('RRULE:FREQ=MONTHLY')
  expect(ics).toContain('STATUS:NEEDS-ACTION')
})

test('recurring task search skips completed and cancelled occurrences without skipping overdue work', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-03-12T12:00:00Z'))
  const detached = (date: string, taskStatus: 'COMPLETED' | 'CANCELLED') => ({
    ...MASTER,
    id: `${MASTER.id}-${date}T00:00:00`,
    recurrenceId: `${date}T00:00:00`,
    recurrenceMasterId: MASTER.id,
    start: `${date}T00:00:00`,
    end: `${date}T23:59:59`,
    dueDate: date,
    rruleString: undefined,
    recurrence: undefined,
    completed: true,
    taskStatus,
  })
  await seed(page, [
    MASTER,
    detached('2026-03-03', 'COMPLETED'),
    detached('2026-03-17', 'CANCELLED'),
  ])
  await page.goto('/month')

  const { palette, result } = await searchTask(page, MASTER.title)
  await expect(result).toContainText('10 Mar 2026')
  await palette.getByRole('button', { name: 'Filter events' }).click()
  await expect(result).toContainText('10 Mar 2026')
  await result.click()
  await expect(page.locator('#due-date')).toHaveValue('10/03/2026')

  await page.goto('/month')
  await searchTask(page, MASTER.title)
  await palette.getByRole('button', { name: 'Filter events' }).click()
  await palette.getByLabel('From').fill('24/03/2026')
  await palette.getByLabel('To').fill('24/03/2026')
  await expect(result).toContainText('24 Mar 2026')
  await result.click()
  await expect(page.locator('#due-date')).toHaveValue('24/03/2026')

  await page.goto('/tasks')
  const openTask = page
    .locator('[data-component="task-row"]')
    .filter({ hasText: MASTER.title, has: page.getByLabel('Mark as complete') })
  const repeatBadge = openTask.locator('[data-component="task-recurring-badge"]')
  await expect(repeatBadge).toHaveAttribute('aria-label', /10 Mar 2026/)
  await openTask.getByLabel('Mark as complete').click()
  await expect(repeatBadge).toHaveAttribute('aria-label', /24 Mar 2026/)
})

test('collapses a repeating task to one row and marks it as repeating', async ({ page }) => {
  await seed(page, [MASTER])
  await page.goto('/tasks')

  const rows = page.locator('main').getByText('Exercise')
  await expect(rows).toHaveCount(1)
  await expect(page.locator('[data-component="task-recurring-badge"]')).toBeVisible()
})

test('the repeat badge explains the series on hover', async ({ page }) => {
  await seed(page, [MASTER])
  await page.goto('/tasks')

  await page.locator('[data-component="task-recurring-badge"]').hover()

  const tip = page.getByRole('tooltip')
  await expect(tip).toBeVisible()
  // Reuses describeRecurrence, so the wording matches recurring events.
  await expect(tip).toContainText(/[Ee]very week/)
  await expect(tip).toContainText('Next:')
})

test('advances to the next occurrence when one is ticked, keeping the series', async ({ page }) => {
  await seed(page, [MASTER])
  await page.goto('/tasks')

  const row = page.locator('[data-component="task-row"]').filter({ hasText: 'Exercise' }).first()
  await expect(row).toBeVisible()
  await row.getByLabel('Mark as complete').click()

  // The row must NOT disappear: completing one occurrence leaves the rest of
  // the series outstanding. It should still be there, still marked repeating.
  await expect(page.locator('[data-component="task-recurring-badge"]')).toBeVisible()

  // And the completed occurrence is recorded as its own component sharing the
  // master's UID — the master itself is never marked complete.
  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('calino-storage')
    const events = raw ? JSON.parse(raw).state.events : []
    return events
      .filter((e: { type?: string }) => e.type === 'task')
      .map((e: { id: string; uid?: string; recurrenceId?: string; completed?: boolean }) => ({
        id: e.id,
        uid: e.uid,
        recurrenceId: e.recurrenceId,
        completed: e.completed,
      }))
  })

  const master = stored.find((e: { recurrenceId?: string }) => !e.recurrenceId)
  const override = stored.find((e: { recurrenceId?: string }) => e.recurrenceId)
  expect(master.completed).toBeFalsy()
  expect(override).toBeTruthy()
  expect(override.uid).toBe(master.uid)
  expect(override.completed).toBe(true)
})

test('shows the occurrence on its own day in month view, not only the anchor', async ({ page }) => {
  await seed(page, [MASTER])
  // 17 March 2026 is the third Tuesday — an occurrence the rule generates but
  // the master's own due date is not.
  await page.goto('/month?date=2026-03-17')

  await expect(page.locator('main').getByText('Exercise').first()).toBeVisible()
})

test('opens a series row on the occurrence it is showing, not the anchor', async ({ page }) => {
  // The master's anchor is 3 March. With that occurrence already completed, the
  // row shows 10 March — and opening it must target 10 March, or "this
  // occurrence" edits and deletes silently act on the anchor instead.
  await seed(page, [
    MASTER,
    {
      ...MASTER,
      id: 'gym-2026-03-03T00:00:00',
      recurrenceId: '2026-03-03T00:00:00',
      recurrenceMasterId: 'gym',
      rruleString: undefined,
      recurrence: undefined,
      completed: true,
      taskStatus: 'COMPLETED',
    },
  ])
  await page.goto('/tasks')

  await page.locator('[data-component="task-row"]').filter({ hasText: 'Exercise' }).first().click()

  const modal = page.locator('[data-component="modal-card"]')
  await expect(modal).toBeVisible()
  // The due date field carries the occurrence the row was showing.
  await expect(modal.locator('#due-date')).toHaveValue('10/03/2026')
})

test('offers recurrence on a dated task and explains why it is unavailable on a subtask', async ({
  page,
}) => {
  await seed(page, [
    {
      id: 'plain',
      uid: 'plain',
      calendarId: 'default',
      title: 'Buy milk',
      type: 'task',
      start: '2026-03-05T00:00:00',
      end: '2026-03-05T23:59:59',
      dueDate: '2026-03-05',
      isAllDay: true,
      completed: false,
    },
    {
      id: 'sub',
      uid: 'sub',
      calendarId: 'default',
      title: 'Find a shop',
      type: 'task',
      parentTaskId: 'plain',
      start: '2026-03-05T00:00:00',
      end: '2026-03-05T23:59:59',
      dueDate: '2026-03-05',
      isAllDay: true,
      completed: false,
    },
  ])
  await page.goto('/tasks')

  // The parent has a subtask, so recurrence is offered but disabled with a
  // stated reason rather than silently missing — RELATED-TO has no
  // per-occurrence form.
  await page.locator('main').getByText('Buy milk').click()
  const modal = page.locator('[data-component="modal-card"]')
  await expect(modal.locator('[data-component="task-recurrence"]')).toContainText('Recurring')
  await expect(modal.locator('[data-component="task-recurrence"]')).toContainText('subtasks')
  await expect(
    modal.locator('[data-component="task-recurrence"]').getByRole('checkbox')
  ).toBeDisabled()
})

// Issue #275 — a missed occurrence must go overdue, not vanish. RFC 5545
// §3.8.5.3 counts DTSTART as the first occurrence even when it is off the
// rule's pattern, which is what a task looks like after another client moves
// its due date (here: "monthly on the 15th", due moved to the 18th).
test('a missed repeat whose due date is off the pattern shows as overdue', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-26T12:00:00') })
  await seed(page, [
    {
      ...MASTER,
      id: 'rent',
      uid: 'rent',
      title: 'Pay rent',
      start: '2026-11-18T00:00:00',
      end: '2026-11-18T23:59:59',
      dueDate: '2026-11-18',
      rruleString: 'FREQ=MONTHLY;BYMONTHDAY=15',
      recurrence: { frequency: 'monthly', interval: 1, byMonthDay: [15] },
    },
  ])
  await page.goto('/tasks')

  const row = page.locator('[data-component="task-row"]').filter({ hasText: 'Pay rent' })
  await expect(row).toHaveCount(1)
  // Before the fix the row skipped to 15 December, the next on-pattern slot.
  await expect(row.locator('[data-component="task-due-date"]')).toHaveText('Nov 18')
  await expect(page.getByRole('heading', { name: 'Overdue' })).toBeVisible()
})
