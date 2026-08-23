import { test, expect, type Page } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

function localDate(offset = 0): string {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

async function seedAgendaItems(page: Page): Promise<void> {
  const today = localDate()
  await page.addInitScript(
    ({ calendarKey, today }: { calendarKey: string; today: string }) => {
      try {
        if (sessionStorage.getItem('__calino_test_agenda_items')) return
        sessionStorage.setItem('__calino_test_agenda_items', '1')
        const raw = localStorage.getItem(calendarKey)
        const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
        parsed.state = {
          ...(parsed.state ?? {}),
          events: [
            ...(parsed.state?.events ?? []),
            {
              id: 'agenda-event',
              title: 'Agenda event',
              type: 'event',
              start: `${today}T09:00:00`,
              end: `${today}T10:00:00`,
              isAllDay: false,
              calendarId: 'default',
            },
            {
              id: 'agenda-parent',
              title: 'Agenda parent',
              type: 'task',
              start: `${today}T00:00:00`,
              end: `${today}T00:00:00`,
              dueDate: today,
              isAllDay: true,
              calendarId: 'default',
              completed: false,
            },
            {
              id: 'agenda-child',
              title: 'Agenda subtask',
              type: 'task',
              start: `${today}T00:00:00`,
              end: `${today}T00:00:00`,
              dueDate: today,
              isAllDay: true,
              calendarId: 'default',
              parentTaskId: 'agenda-parent',
              completed: false,
            },
            {
              id: 'agenda-task',
              title: 'Agenda task',
              type: 'task',
              start: `${today}T00:00:00`,
              end: `${today}T00:00:00`,
              dueDate: today,
              isAllDay: true,
              calendarId: 'default',
              completed: false,
            },
          ],
        }
        localStorage.setItem(calendarKey, JSON.stringify(parsed))
      } catch {
        /* noop */
      }
    },
    { calendarKey: 'calino-storage', today }
  )
}

async function dragToDate(page: Page, title: string, date: string): Promise<void> {
  const source = page
    .locator('[data-component="agenda-task"], [data-component="agenda-event"]')
    .filter({ hasText: title })
    .first()
  await expect(source).toBeVisible()
  const target = page.locator(`[data-component="agenda-day-drop-zone"][data-date="${date}"]`)
  await expect(target).toBeVisible()

  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  if (!sourceBox || !targetBox) throw new Error('could not locate agenda drag source and target')

  const sourceX = sourceBox.x + sourceBox.width / 2
  const sourceY = sourceBox.y + sourceBox.height / 2
  const targetX = targetBox.x + targetBox.width / 2
  const targetY = targetBox.y + targetBox.height / 2
  await page.mouse.move(sourceX, sourceY)
  await page.mouse.down()
  await page.mouse.move(sourceX + 12, sourceY, { steps: 3 })
  await page.mouse.move(targetX, targetY, { steps: 12 })
  await page.mouse.up()
}

async function dragTaskToTask(
  page: Page,
  sourceTitle: string,
  targetTitle: string,
  onTarget?: () => Promise<void>
): Promise<void> {
  const source = page
    .locator('[data-component="agenda-task"]')
    .filter({ hasText: sourceTitle })
    .first()
  const target = page
    .locator('[data-component="agenda-task"]')
    .filter({ hasText: targetTitle })
    .first()
  await expect(source).toBeVisible()
  await expect(target).toBeVisible()

  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  if (!sourceBox || !targetBox)
    throw new Error('could not locate agenda task drag source and target')

  const sourceX = sourceBox.x + sourceBox.width / 2
  const sourceY = sourceBox.y + sourceBox.height / 2
  const targetX = targetBox.x + targetBox.width / 2
  const targetY = targetBox.y + targetBox.height / 2
  await page.mouse.move(sourceX, sourceY)
  await page.mouse.down()
  await page.mouse.move(sourceX + 12, sourceY, { steps: 3 })
  await page.mouse.move(targetX, targetY, { steps: 12 })
  await onTarget?.()
  await page.mouse.up()
}

test('agenda indents subtasks and moves tasks and events between days', async ({ page }) => {
  await clearState(page)
  await seedAgendaItems(page)
  await page.goto('/agenda')

  const today = localDate()
  const tomorrow = localDate(1)
  const parentBody = page
    .locator('[data-component="agenda-task"]')
    .filter({ hasText: 'Agenda parent' })
    .locator('[data-task-depth]')
  const childBody = page
    .locator('[data-component="agenda-task"]')
    .filter({ hasText: 'Agenda subtask' })
    .locator('[data-task-depth]')
  await expect(parentBody).toHaveAttribute('data-task-depth', '0')
  await expect(childBody).toHaveAttribute('data-task-depth', '1')
  const parentBox = await parentBody.boundingBox()
  const childBox = await childBody.boundingBox()
  expect(childBox?.x).toBeGreaterThan(parentBox?.x ?? 0)

  const parentTask = page
    .locator('[data-component="agenda-task"]')
    .filter({ hasText: 'Agenda parent' })
    .first()
  await dragTaskToTask(page, 'Agenda task', 'Agenda parent', async () => {
    await expect(parentTask).toContainText('Make subtask')
    await expect(parentTask).toHaveAttribute('data-drop-state', 'make-subtask')
  })
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const events =
          JSON.parse(localStorage.getItem('calino-storage') ?? '{}').state?.events ?? []
        return events.find((event: { id: string }) => event.id === 'agenda-task')?.parentTaskId
      })
    )
    .toBe('agenda-parent')

  await dragToDate(page, 'Agenda event', tomorrow)
  await dragToDate(page, 'Agenda task', tomorrow)

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const events =
          JSON.parse(localStorage.getItem('calino-storage') ?? '{}').state?.events ?? []
        return events
          .filter(
            (event: { id: string }) => event.id === 'agenda-event' || event.id === 'agenda-task'
          )
          .map((event: { id: string; start: string; dueDate?: string; parentTaskId?: string }) =>
            event.id === 'agenda-event'
              ? { id: event.id, start: event.start.slice(0, 10) }
              : { id: event.id, dueDate: event.dueDate, parentTaskId: event.parentTaskId }
          )
          .sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id))
      })
    )
    .toEqual([
      { id: 'agenda-event', start: tomorrow },
      { id: 'agenda-task', dueDate: tomorrow, parentTaskId: undefined },
    ])

  await expect(page.locator(`[data-date="${today}"]`)).toBeVisible()

  const agendaEvent = page
    .locator('[data-component="agenda-event"]')
    .filter({ hasText: 'Agenda event' })
    .first()
  await agendaEvent.hover()
  await expect
    .poll(() =>
      agendaEvent.evaluate((element) => getComputedStyle(element.parentElement as Element).overflow)
    )
    .toBe('visible')
})

test('agenda collapses consecutive empty dates into a free-range row', async ({ page }) => {
  await clearState(page)
  await seedAgendaItems(page)
  await page.goto('/agenda')

  const freeRanges = page.locator('[data-component="agenda-free-range"]')
  await expect(freeRanges.first()).toContainText(/free$/)
  await expect.poll(() => freeRanges.count()).toBeGreaterThan(0)
})
