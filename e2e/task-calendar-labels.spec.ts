import { test, expect, type Page, type Locator } from '@playwright/test'
import { clearState, seedStoreCalendars, STORAGE_KEYS } from './fixtures/localstorage'

interface TaskSeed {
  id: string
  title: string
  calendarId: string
  description?: string
  priority?: number
  rruleString?: string
}

const calendars = [
  { id: 'work', name: 'Work' },
  { id: 'home', name: 'Home' },
]
const tasks: TaskSeed[] = [
  { id: 'work-task', title: 'Prepare trip', calendarId: 'work' },
  { id: 'home-task', title: 'Water plants', calendarId: 'home' },
]
const labelSelector = '[data-component="task-calendar-label"]'

async function seed(page: Page, calendarSeeds = calendars, taskSeeds = tasks): Promise<void> {
  await seedStoreCalendars(page, calendarSeeds)
  await page.addInitScript(
    ({ keys, taskSeeds }) => {
      if (sessionStorage.getItem('__calino_test_task_labels')) return
      sessionStorage.setItem('__calino_test_task_labels', '1')
      const now = new Date()
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      const saved = JSON.parse(localStorage.getItem(keys.calendar)!)
      saved.state.events = taskSeeds.map((task) => ({
        ...task,
        type: 'task',
        start: `${date}T00:00:00`,
        end: `${date}T23:59:59`,
        dueDate: date,
        isAllDay: true,
        completed: false,
      }))
      localStorage.setItem(keys.calendar, JSON.stringify(saved))
      const settings = JSON.parse(localStorage.getItem(keys.settings)!)
      settings.state = { ...settings.state, language: 'en', sidebarWidth: 300 }
      localStorage.setItem(keys.settings, JSON.stringify(settings))
    },
    { keys: STORAGE_KEYS, taskSeeds }
  )
}

async function expandWidget(page: Page): Promise<Locator> {
  const widget = page.locator('[data-component="tasks-section"]')
  const header = widget.locator('[data-component="tasks-header"]')
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()
  return widget
}

function row(page: Page, id: string): Locator {
  return page.locator(`main [data-component="task-row"][data-task-id="${id}"]`)
}

async function expectNoRowOverlap(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const boxes = await page.locator('main [data-component="task-row"]').evaluateAll((rows) =>
        rows.map((row) => {
          const box = row.getBoundingClientRect()
          return { top: box.top, bottom: box.bottom }
        })
      )
      return (
        boxes.length > 1 &&
        boxes.every((box, index) => index === 0 || box.top >= boxes[index - 1].bottom - 1)
      )
    })
    .toBe(true)
}

test.describe('Task calendar labels', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
  })

  test('settings control both surfaces independently and persist after reload', async ({
    page,
  }) => {
    await seed(page)
    await page.goto('/settings?tab=tasks')
    const section = page.locator('[data-component="tasks-settings"]')
    const tasksToggle = section.locator(
      '[data-component="toggle"][data-setting="show-task-calendar-labels"]'
    )
    const sidebarToggle = section.locator(
      '[data-component="toggle"][data-setting="show-sidebar-task-calendar-labels"]'
    )
    await expect(section.getByLabel('Show calendar names in Tasks')).toBeChecked()
    await expect(section.getByLabel('Reveal calendar names in the sidebar')).toBeChecked()
    await tasksToggle.click()
    await page.reload()
    await expect(section.getByLabel('Show calendar names in Tasks')).not.toBeChecked()
    await expect(section.getByLabel('Reveal calendar names in the sidebar')).toBeChecked()
    await page.goto('/tasks')
    const widget = await expandWidget(page)
    await expect(row(page, 'work-task').locator(labelSelector)).toHaveCount(0)
    await widget.locator('[data-mini-task-id="work-task"]').hover()
    await expect(widget.locator(labelSelector)).toHaveText('Work')
    await page.goto('/settings?tab=tasks')
    await tasksToggle.click()
    await sidebarToggle.click()
    await page.reload()
    await expect(section.getByLabel('Show calendar names in Tasks')).toBeChecked()
    await expect(section.getByLabel('Reveal calendar names in the sidebar')).not.toBeChecked()
    await page.goto('/tasks')
    await expandWidget(page)
    await expect(row(page, 'work-task').locator(labelSelector)).toHaveText('Work')
    await widget.locator('[data-mini-task-id="work-task"]').hover()
    await expect(widget.locator(labelSelector)).toHaveCount(0)
  })

  test('sidebar labels reveal on hover and focus without hiding dates', async ({ page }) => {
    await seed(page)
    await page.goto('/tasks')
    const widget = await expandWidget(page)
    const work = widget.locator('[data-mini-task-id="work-task"]')
    const other = widget.locator('[data-mini-task-id="home-task"]')
    await expect(widget.locator(labelSelector)).toHaveCount(0)
    await work.hover()
    await expect(work.locator(labelSelector)).toHaveText('Work')
    await expect(work.locator('[data-component="task-due-date"]')).toBeVisible()
    await expect(other.locator(labelSelector)).toHaveCount(0)
    await widget.locator('[data-component="tasks-header"]').hover()
    await expect(widget.locator(labelSelector)).toHaveCount(0)
    await other.locator('button[type="button"]').focus()
    await expect(other.locator(labelSelector)).toHaveText('Home')
    await expect(other.locator('[data-component="task-due-date"]')).toBeVisible()
    await widget.locator('[data-component="tasks-header"]').focus()
    await expect(widget.locator(labelSelector)).toHaveCount(0)
  })

  test('mobile labels and indicators fit without overlapping virtualized rows', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 })
    const name = 'Work calendar with an exceptionally long name for the entire project team'
    const manyTasks = Array.from({ length: 35 }, (_, index) => ({
      id: `task-${index}`,
      title: `Mobile task ${index} with a long title that wraps onto multiple lines`,
      calendarId: index % 2 ? 'home' : 'work',
      description: `Description ${index}`,
      priority: index % 3 === 2 ? undefined : 1,
      rruleString: index % 3 === 0 ? 'FREQ=DAILY' : undefined,
    }))
    await seed(page, [{ ...calendars[0], name }, calendars[1]], manyTasks)
    await page.goto('/settings')
    await page.locator('[data-component="settings-category-item"][data-tab="tasks"]').click()
    await expect(page.locator('[data-component="tasks-settings"]')).toBeVisible()
    await page.goto('/tasks')
    const firstRow = row(page, 'task-0')
    await expect(firstRow.locator(labelSelector)).toHaveText(name)
    await expect(firstRow.locator(labelSelector)).toHaveAttribute('title', name)
    await expect(firstRow.locator('[data-component="task-priority-badge"]')).toBeVisible()
    await expect(firstRow.locator('[data-component="task-recurring-badge"]')).toBeVisible()
    await expect(row(page, 'task-2').locator('[data-component="task-indicators"]')).toHaveCount(0)
    await expectNoRowOverlap(page)
    const list = page.locator('[data-component="todo-task-list"]')
    await expect
      .poll(() => list.evaluate((element) => element.scrollWidth <= element.clientWidth))
      .toBe(true)
    await list.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await expect(row(page, 'task-34').locator(labelSelector)).toHaveText(name)
    await expectNoRowOverlap(page)
  })
})
