import { test, expect } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

test('renders imported subtasks beneath their parent', async ({ page }) => {
  await clearState(page)
  await page.addInitScript(() => {
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
          events: [
            {
              id: 'parent',
              calendarId: 'default',
              title: 'Plan trip',
              type: 'task',
              start: '2026-07-10T09:00:00.000Z',
              end: '2026-07-10T09:00:00.000Z',
              isAllDay: false,
              completed: false,
            },
            {
              id: 'child',
              calendarId: 'default',
              title: 'Book hotel',
              parentTaskId: 'parent',
              type: 'task',
              start: '2026-07-11T09:00:00.000Z',
              end: '2026-07-11T09:00:00.000Z',
              isAllDay: false,
              completed: false,
            },
            {
              id: 'grandchild',
              calendarId: 'default',
              title: 'Pack bags',
              parentTaskId: 'child',
              type: 'task',
              start: '2026-07-12T09:00:00.000Z',
              end: '2026-07-12T09:00:00.000Z',
              isAllDay: false,
              completed: false,
            },
          ],
        },
        version: 1,
      })
    )
  })

  await page.goto('/tasks')

  const parent = page.locator('main').getByText('Plan trip')
  const child = page.locator('main').getByText('Book hotel')
  const grandchild = page.getByText('Pack bags')
  await expect(parent).toBeVisible()
  await expect(child).toBeVisible()
  await expect(child.locator('xpath=ancestor::*[@data-component="task-row"]')).toHaveAttribute(
    'data-task-depth',
    '1'
  )
  await expect(grandchild.locator('xpath=ancestor::*[@data-component="task-row"]')).toHaveAttribute(
    'data-task-depth',
    '2'
  )

  await parent.click()
  await expect(
    page.locator('[data-component="modal-card"]').getByRole('button', { name: 'Book hotel' })
  ).toBeVisible()
})

test('month task cards and task surfaces expose subtask completion controls', async ({ page }) => {
  await clearState(page)
  await page.addInitScript(() => {
    if (sessionStorage.getItem('surface-seeded')) return
    sessionStorage.setItem('surface-seeded', '1')
    const now = new Date()
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
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
          events: [
            {
              id: 'surface-parent',
              calendarId: 'default',
              title: 'Surface parent',
              type: 'task',
              start: `${date}T00:00:00`,
              end: `${date}T23:59:59`,
              dueDate: date,
              isAllDay: true,
              completed: false,
            },
            {
              id: 'surface-child',
              calendarId: 'default',
              title: 'Surface child',
              type: 'task',
              parentTaskId: 'surface-parent',
              start: `${date}T00:00:00`,
              end: `${date}T23:59:59`,
              dueDate: date,
              isAllDay: true,
              completed: false,
            },
            {
              id: 'surface-grandchild',
              calendarId: 'default',
              title: 'Surface grandchild',
              type: 'task',
              parentTaskId: 'surface-child',
              start: `${date}T00:00:00`,
              end: `${date}T23:59:59`,
              dueDate: date,
              isAllDay: true,
              completed: false,
            },
          ],
        },
        version: 1,
      })
    )
  })

  await page.goto('/month')
  const childCard = page
    .locator('[data-component="event-card"]')
    .filter({ hasText: 'Surface child' })
  await expect(childCard).toHaveAttribute('aria-label', /subtask/i)

  const parentCard = page
    .locator('[data-component="event-card"]')
    .filter({ hasText: 'Surface parent' })
  await parentCard.click()

  const preview = page.locator('[data-component="event-preview"]')
  await expect(preview).toBeVisible()
  const previewChildCheckbox = preview.locator('[data-component="task-preview-subtask-checkbox"]')
  await previewChildCheckbox.check()
  await expect(previewChildCheckbox).toBeChecked()

  await preview.getByRole('button', { name: 'Open task' }).click()
  const modal = page.locator('[data-component="modal-card"]')
  await expect(modal.getByRole('button', { name: 'Surface child' })).toBeVisible()
  await expect(modal.getByRole('button', { name: 'Surface grandchild' })).toBeVisible()
  await expect(
    modal.getByRole('checkbox', { name: 'Mark "Surface grandchild" as incomplete' })
  ).toBeChecked()

  await page.reload()
  await page.goto('/tasks')
  await page.locator('main').getByRole('button', { name: 'Done' }).click()
  await expect(
    page
      .locator('[data-component="task-row"]')
      .filter({ hasText: 'Surface child' })
      .getByRole('button', { name: 'Mark as incomplete' })
  ).toBeVisible()
  await expect(
    page
      .locator('[data-component="task-row"]')
      .filter({ hasText: 'Surface grandchild' })
      .getByRole('button', { name: 'Mark as incomplete' })
  ).toBeVisible()
})

test('large subtask trees collapse with a chevron across task views', async ({ page }) => {
  await clearState(page)
  await page.addInitScript(() => {
    const now = new Date()
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
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
          events: [
            {
              id: 'collapse-parent',
              calendarId: 'default',
              title: 'Collapse parent',
              type: 'task',
              start: `${date}T00:00:00`,
              end: `${date}T23:59:59`,
              dueDate: date,
              isAllDay: true,
              completed: false,
            },
            ...['one', 'two', 'three', 'four'].map((suffix) => ({
              id: `collapse-${suffix}`,
              calendarId: 'default',
              title: `Collapse child ${suffix}`,
              parentTaskId: 'collapse-parent',
              type: 'task',
              start: `${date}T00:00:00`,
              end: `${date}T23:59:59`,
              dueDate: date,
              isAllDay: true,
              completed: false,
            })),
          ],
        },
        version: 1,
      })
    )
  })

  const assertTaskState = async (route: string, expanded: boolean): Promise<void> => {
    const parent = page
      .locator(
        route === '/agenda' ? '[data-component="agenda-task"]' : '[data-component="event-card"]'
      )
      .filter({ hasText: 'Collapse parent' })
      .last()
    await expect(parent).toBeVisible()
    const toggle = parent.locator('[data-component="task-collapse-toggle"]')
    await expect(toggle).toBeVisible()
    await expect(toggle.locator('svg')).toBeVisible()
    const toggleBox = await toggle.boundingBox()
    expect(toggleBox?.width).toBeGreaterThan(0)
    expect(toggleBox?.height).toBeGreaterThan(0)
    await expect(toggle).toHaveAttribute('aria-expanded', expanded ? 'true' : 'false')
    if (expanded) {
      await expect(page.getByText('Collapse child one')).toBeVisible()
    } else {
      await expect(page.getByText('Collapse child one')).not.toBeVisible()
    }
  }

  await page.goto('/month')
  await assertTaskState('/month', false)
  await page
    .locator('[data-component="event-card"]')
    .filter({ hasText: 'Collapse parent' })
    .last()
    .locator('[data-component="task-collapse-toggle"]')
    .click()
  await assertTaskState('/month', true)

  // The setting is shared by all task surfaces, so the expansion made in the
  // month view is immediately visible in the week view.
  await page.goto('/week')
  await assertTaskState('/week', true)
  await page
    .locator('[data-component="event-card"]')
    .filter({ hasText: 'Collapse parent' })
    .last()
    .locator('[data-component="task-collapse-toggle"]')
    .click()

  for (const route of ['/month', '/agenda', '/day']) {
    await page.goto(route)
    await assertTaskState(route, false)
  }

  await page.goto('/tasks')
  const taskRow = page.locator('[data-component="task-row"]').filter({ hasText: 'Collapse parent' })
  const taskToggle = taskRow.getByRole('button', { name: /Expand subtasks for "Collapse parent"/ })
  const taskChevron = taskRow.locator('[data-component="task-collapse-toggle"] svg')
  const collapsedTransform = await taskChevron.evaluate(
    (element) => getComputedStyle(element).transform
  )
  await expect(taskToggle).toHaveAttribute('aria-expanded', 'false')
  await taskToggle.click()
  await expect(taskChevron).not.toHaveCSS('transform', collapsedTransform)
  await expect(
    page.locator('[data-component="task-row"]').filter({ hasText: 'Collapse child one' })
  ).toBeVisible()

  // A hard refresh keeps the explicit expansion in the persisted settings.
  await page.reload()
  await expect(
    page
      .locator('[data-component="task-row"]')
      .filter({ hasText: 'Collapse parent' })
      .getByRole('button', { name: /Collapse subtasks for "Collapse parent"/ })
  ).toHaveAttribute('aria-expanded', 'true')

  await taskRow.getByText('Collapse parent').click()
  const modal = page.locator('[data-component="modal-card"]')
  const modalToggle = modal.getByRole('button', { name: /Collapse subtasks for "Collapse parent"/ })
  await expect(modalToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(modal.getByRole('button', { name: 'Collapse child one' })).toBeVisible()
})

test.describe('mobile task surfaces', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })

  test('keeps inline task controls within usable mobile sheets', async ({ page }) => {
    await clearState(page)
    await page.addInitScript(() => {
      const now = new Date()
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
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
            events: [
              {
                id: 'mobile-parent',
                calendarId: 'default',
                title: 'Mobile parent',
                type: 'task',
                start: `${date}T00:00:00`,
                end: `${date}T23:59:59`,
                dueDate: date,
                isAllDay: true,
                completed: false,
              },
              {
                id: 'mobile-child',
                calendarId: 'default',
                title: 'Mobile child',
                type: 'task',
                parentTaskId: 'mobile-parent',
                start: `${date}T00:00:00`,
                end: `${date}T23:59:59`,
                dueDate: date,
                isAllDay: true,
                completed: false,
              },
              {
                id: 'mobile-grandchild',
                calendarId: 'default',
                title: 'Mobile grandchild',
                type: 'task',
                parentTaskId: 'mobile-child',
                start: `${date}T00:00:00`,
                end: `${date}T23:59:59`,
                dueDate: date,
                isAllDay: true,
                completed: false,
              },
            ],
          },
          version: 1,
        })
      )
    })

    await page.goto('/month')
    const parentCard = page.locator('[data-component="event-card"][aria-label^="Mobile parent"]')
    const childCard = page.locator('[data-component="event-card"][aria-label^="Mobile child"]')
    await expect(parentCard).toBeVisible()
    await expect(childCard).toHaveAttribute('aria-label', /subtask/i)
    await expect(parentCard.locator('[data-component="task-collapse-toggle"]')).toBeVisible()

    // Compact mobile month cards are intentionally density indicators and pass
    // taps through to the day cell. Use the week surface for the preview check,
    // where the task card remains an actionable target.
    await page.goto('/week')
    const weekParentCard = page.locator(
      '[data-component="event-card"][aria-label^="Mobile parent"]'
    )
    await expect(weekParentCard).toBeVisible()
    await weekParentCard.getByText('Mobile parent').click()

    const preview = page.locator('[data-component="event-preview"]')
    await expect(preview).toBeVisible()
    await expect(preview.locator('[data-component="task-preview-subtask-checkbox"]')).toHaveCSS(
      'width',
      '20px'
    )
    const previewRow = preview
      .locator('[data-component="task-preview-subtask-checkbox"]')
      .locator('..')
    expect((await previewRow.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true)

    await preview.getByRole('button', { name: 'Open task' }).click()
    const modal = page.locator('[data-component="modal-card"]')
    await expect(modal).toBeVisible()
    const modalBox = await modal.boundingBox()
    expect(modalBox?.width).toBeLessThanOrEqual(390)
    const grandchildRow = modal
      .locator('[data-component="subtask-row"]')
      .filter({ hasText: 'Mobile grandchild' })
    await expect(grandchildRow).toHaveAttribute('data-task-depth', '1')
    expect((await grandchildRow.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true)
  })
})

test('shows only parent tasks in the sidebar', async ({ page }) => {
  await clearState(page)
  await page.addInitScript(() => {
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
          events: [
            {
              id: 'parent',
              calendarId: 'default',
              title: 'Plan trip',
              type: 'task',
              start: '2026-07-10T09:00:00.000Z',
              end: '2026-07-10T09:00:00.000Z',
              isAllDay: false,
              completed: false,
            },
            {
              id: 'child',
              calendarId: 'default',
              title: 'Book hotel',
              parentTaskId: 'parent',
              type: 'task',
              start: '2026-07-10T09:00:00.000Z',
              end: '2026-07-10T09:00:00.000Z',
              isAllDay: false,
              completed: false,
            },
          ],
        },
        version: 1,
      })
    )
  })

  await page.goto('/month')
  const tasksHeader = page.locator('[data-component="tasks-header"]')
  if ((await tasksHeader.getAttribute('aria-expanded')) === 'false') await tasksHeader.click()

  const sidebarTasks = page.locator('[data-component="tasks-section"]')
  await expect(sidebarTasks.getByText('Plan trip')).toBeVisible()
  await expect(sidebarTasks.getByText('Book hotel')).not.toBeVisible()
})

test('parents with hidden subtasks show a subtask-count badge in the sidebar', async ({ page }) => {
  // Subtasks are intentionally hidden from the sidebar (the parent represents
  // the whole subtree). But without a counter, users think their child task
  // has vanished. The badge "↳ 1" on the parent row makes the indirection
  // discoverable.
  await clearState(page)
  await page.addInitScript(() => {
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
          events: [
            {
              id: 'parent',
              calendarId: 'default',
              title: 'Plan trip',
              type: 'task',
              start: '2026-07-10T09:00:00.000Z',
              end: '2026-07-10T09:00:00.000Z',
              isAllDay: false,
              completed: false,
            },
            {
              id: 'child',
              calendarId: 'default',
              title: 'Book hotel',
              parentTaskId: 'parent',
              type: 'task',
              start: '2026-07-10T09:00:00.000Z',
              end: '2026-07-10T09:00:00.000Z',
              isAllDay: false,
              completed: false,
            },
          ],
        },
        version: 1,
      })
    )
  })

  await page.goto('/month')
  const tasksHeader = page.locator('[data-component="tasks-header"]')
  if ((await tasksHeader.getAttribute('aria-expanded')) === 'false') await tasksHeader.click()

  const parentRow = page
    .locator('[data-component="tasks-section"]')
    .getByText('Plan trip')
    .locator('..')
    .locator('..')
  await expect(parentRow.locator('[data-component="task-subtask-count"]')).toBeVisible()
  await expect(parentRow.locator('[data-component="task-subtask-count"]')).toHaveAttribute(
    'data-subtask-count',
    '1'
  )
})

test('subtask count badge includes grandchildren and drops completed work', async ({ page }) => {
  // The badge should count the whole open subtree, not just direct children.
  // A completed grandchild must NOT inflate the badge — the badge tells the
  // user about *open* work under the row.
  await clearState(page)
  await page.addInitScript(() => {
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
          events: [
            {
              id: 'parent',
              calendarId: 'default',
              title: 'Plan trip',
              type: 'task',
              start: '2026-07-10T09:00:00.000Z',
              end: '2026-07-10T09:00:00.000Z',
              isAllDay: false,
              completed: false,
            },
            // Open child → counted.
            {
              id: 'child-open',
              calendarId: 'default',
              title: 'Book hotel',
              parentTaskId: 'parent',
              type: 'task',
              start: '2026-07-10T09:00:00.000Z',
              end: '2026-07-10T09:00:00.000Z',
              isAllDay: false,
              completed: false,
            },
            // Completed child → not counted.
            {
              id: 'child-done',
              calendarId: 'default',
              title: 'Renew passport',
              parentTaskId: 'parent',
              type: 'task',
              start: '2026-07-10T09:00:00.000Z',
              end: '2026-07-10T09:00:00.000Z',
              isAllDay: false,
              completed: true,
            },
            // Open grandchild → counted under the parent (total open = 2).
            {
              id: 'grand-open',
              calendarId: 'default',
              title: 'Pack charger',
              parentTaskId: 'child-open',
              type: 'task',
              start: '2026-07-10T09:00:00.000Z',
              end: '2026-07-10T09:00:00.000Z',
              isAllDay: false,
              completed: false,
            },
          ],
        },
        version: 1,
      })
    )
  })

  await page.goto('/month')
  const tasksHeader = page.locator('[data-component="tasks-header"]')
  if ((await tasksHeader.getAttribute('aria-expanded')) === 'false') await tasksHeader.click()

  const parentRow = page
    .locator('[data-component="tasks-section"]')
    .getByText('Plan trip')
    .locator('..')
    .locator('..')
  await expect(parentRow.locator('[data-component="task-subtask-count"]')).toHaveAttribute(
    'data-subtask-count',
    '2'
  )
})

test('hides tasks from disabled calendars in the sidebar', async ({ page }) => {
  await clearState(page)
  await page.addInitScript(() => {
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
            {
              id: 'hidden',
              name: 'Hidden calendar',
              color: '#EA4335',
              isVisible: false,
              isDefault: false,
              showTasksInViews: true,
            },
          ],
          events: [
            {
              id: 'hidden-task',
              calendarId: 'hidden',
              title: 'Hidden sidebar task',
              type: 'task',
              start: '2026-07-10T09:00:00.000Z',
              end: '2026-07-10T09:00:00.000Z',
              isAllDay: false,
              completed: false,
            },
          ],
        },
        version: 1,
      })
    )
  })

  await page.goto('/month')
  const tasksHeader = page.locator('[data-component="tasks-header"]')
  if ((await tasksHeader.getAttribute('aria-expanded')) === 'false') await tasksHeader.click()

  await expect(
    page.locator('[data-component="tasks-section"]').getByText('Hidden sidebar task')
  ).not.toBeVisible()
})

test('keeps undated imported tasks out of calendar and agenda views', async ({ page }) => {
  await clearState(page)
  const today = new Date().toISOString()
  await page.addInitScript((today) => {
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
          events: [
            {
              id: 'undated',
              calendarId: 'default',
              title: 'Imported without due date',
              type: 'task',
              start: today,
              end: today,
              isAllDay: false,
              completed: false,
            },
          ],
        },
        version: 1,
      })
    )
  }, today)

  await page.goto('/tasks')
  await expect(page.locator('main').getByText('Imported without due date')).toBeVisible()

  await page.goto('/month')
  await expect(
    page.locator('[data-component="calendar-grid"]').getByText('Imported without due date')
  ).not.toBeVisible()

  await page.goto('/agenda')
  await expect(page.locator('main').getByText('Imported without due date')).not.toBeVisible()
})

test('filters all tasks by project without changing calendar visibility', async ({ page }) => {
  await clearState(page)
  await page.addInitScript(() => {
    localStorage.setItem(
      'calino-storage',
      JSON.stringify({
        state: {
          calendars: [
            {
              id: 'default',
              name: 'Personal',
              color: '#4285F4',
              isVisible: true,
              isDefault: true,
              showTasksInViews: true,
            },
            {
              id: 'work',
              name: 'Work',
              color: '#EA4335',
              isVisible: true,
              isDefault: false,
              showTasksInViews: true,
            },
            {
              id: 'events-only',
              name: 'Events only',
              color: '#34A853',
              isVisible: true,
              isDefault: false,
              showTasksInViews: true,
              supportedComponents: ['VEVENT'],
            },
          ],
          events: [
            {
              id: 'personal-task',
              calendarId: 'default',
              title: 'Personal task',
              type: 'task',
              start: '2026-07-10T09:00:00.000Z',
              end: '2026-07-10T09:00:00.000Z',
              isAllDay: false,
              completed: false,
            },
            {
              id: 'work-task',
              calendarId: 'work',
              title: 'Work task',
              type: 'task',
              start: '2026-07-10T09:00:00.000Z',
              end: '2026-07-10T09:00:00.000Z',
              isAllDay: false,
              completed: false,
            },
          ],
        },
        version: 1,
      })
    )
  })

  await page.goto('/tasks')
  const projectFilter = page.locator('[data-component="task-project-filter"]')
  await expect(projectFilter).toBeVisible()
  await projectFilter.click()
  const projectMenu = page.locator('[data-component="task-project-menu"]')
  await expect(projectMenu.getByRole('menuitem', { name: 'Events only' })).not.toBeVisible()
  await projectMenu.getByRole('menuitem', { name: 'Work' }).click()

  const taskList = page.locator('main')
  await expect(taskList.getByText('Work task')).toBeVisible()
  await expect(taskList.getByText('Personal task')).not.toBeVisible()

  await page.locator('[data-component="add-task-button"]').click()
  const composer = page.getByPlaceholder('What needs doing?')
  await composer.fill('New work task')
  await composer.press('Enter')
  await expect(page.locator('[data-component="event-calendar-select"]')).toHaveValue('work')
})
