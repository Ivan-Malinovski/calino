/**
 * /tasks manual order (X-APPLE-SORT-ORDER).
 *
 * User flow on /tasks:
 *   - Dragging a task onto the top or bottom edge of another task in the same
 *     day reorders it. An insertion line marks the spot while dragging.
 *   - Dropping on the middle of a row still makes it a subtask
 *     (todo-drag-parent.spec.ts covers that).
 *   - "Move up" / "Move down" in the task's menu do the same one step at a
 *     time, and are only offered where the step exists.
 *   - The agenda reorders a day's tasks the same way.
 */
import { test, expect, type Page } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

interface TaskSeed {
  id: string
  title: string
  sortOrder?: number
  rruleString?: string
}

async function seedTasks(page: Page, tasks: TaskSeed[], day = '2026-07-10'): Promise<void> {
  await page.addInitScript(
    ({ calendarKey, tasks, day }: { calendarKey: string; tasks: TaskSeed[]; day: string }) => {
      try {
        if (sessionStorage.getItem('__calino_test_todo_reorder')) return
        sessionStorage.setItem('__calino_test_todo_reorder', '1')
        const raw = localStorage.getItem(calendarKey)
        const parsed = raw ? JSON.parse(raw) : { state: {}, version: 1 }
        // Untimed tasks on one day: the only ones a manual order applies to.
        const events = tasks.map((task) => ({
          id: task.id,
          uid: task.id,
          calendarId: 'default',
          title: task.title,
          type: 'task',
          start: `${day}T00:00:00`,
          end: `${day}T00:00:00`,
          dueDate: day,
          isAllDay: true,
          completed: false,
          sortOrder: task.sortOrder,
          rruleString: task.rruleString,
        }))
        parsed.state = {
          ...(parsed.state ?? {}),
          events: [...(parsed.state?.events ?? []), ...events],
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
        localStorage.setItem(calendarKey, JSON.stringify(parsed))
      } catch {
        /* noop */
      }
    },
    { calendarKey: 'calino-storage', tasks, day }
  )
}

const ROUTINE: TaskSeed[] = [
  { id: 'leave', title: 'Leave the house', sortOrder: 3000 },
  { id: 'brush', title: 'Brush teeth', sortOrder: 1000 },
  { id: 'pack', title: 'Pack bag', sortOrder: 2000 },
]

/** Today as the agenda files it: the local calendar date. */
function localToday(): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * `measure` once it gives the same answer twice in a row. On drag start the
 * agenda animates its between-day zones open, sliding the rows down; a target
 * measured mid-slide is already stale by the time the pointer gets there.
 */
async function settled(
  page: Page,
  measure: () => Promise<{ x: number; y: number }>
): Promise<{ x: number; y: number }> {
  let previous = await measure()
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(50)
    const next = await measure()
    if (next.x === previous.x && next.y === previous.y) return next
    previous = next
  }
  return previous
}

/**
 * Press on `from`, clear the 8px activation distance, then glide to `to`.
 * `to` can be worked out once the drag is live (see `settled`).
 */
async function dragTo(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number } | (() => Promise<{ x: number; y: number }>),
  whileOver?: () => Promise<void>
): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= 5; i++) await page.mouse.move(from.x + i * 3, from.y)
  const target = typeof to === 'function' ? await settled(page, to) : to
  await page.mouse.move(target.x, target.y, { steps: 20 })
  await whileOver?.()
  await page.mouse.up()
}

async function rowOrder(page: Page): Promise<string[]> {
  return page
    .locator('[data-component="task-row"]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-task-id') ?? ''))
}

test.describe('/tasks — manual order', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await seedTasks(page, ROUTINE)
    await page.goto('/tasks')
    await expect(page.locator('[data-task-id="leave"]')).toBeVisible()
  })

  test('lists tasks in their saved order', async ({ page }) => {
    await expect.poll(() => rowOrder(page)).toEqual(['brush', 'pack', 'leave'])
  })

  test('dropping on the top edge of a row puts the task above it', async ({ page }) => {
    const source = await page.locator('[data-task-id="leave"]').boundingBox()
    const target = await page.locator('[data-task-id="brush"]').boundingBox()
    if (!source || !target) throw new Error('rows not laid out')
    await dragTo(
      page,
      { x: source.x + source.width / 2, y: source.y + source.height / 2 },
      { x: target.x + target.width / 2, y: target.y + 3 },
      async () => {
        await expect(page.locator('[data-task-id="brush"]')).toHaveAttribute(
          'data-drop-insert',
          'before'
        )
      }
    )

    await expect.poll(() => rowOrder(page)).toEqual(['leave', 'brush', 'pack'])
    // A reorder is not a nest.
    await expect(page.locator('[data-task-id="leave"]')).toHaveAttribute('data-task-depth', '0')
  })

  test('Move up and Move down step one place, and only where possible', async ({ page }) => {
    await page.locator('[data-task-id="pack"]').click({ button: 'right' })
    await page.locator('[data-component="task-menu-move-up"]').click()
    await expect.poll(() => rowOrder(page)).toEqual(['pack', 'brush', 'leave'])

    // Now first: no Move up, but Move down is there.
    await page.locator('[data-task-id="pack"]').click({ button: 'right' })
    await expect(page.locator('[data-component="task-menu-move-up"]')).toHaveCount(0)
    await page.locator('[data-component="task-menu-move-down"]').click()
    await expect.poll(() => rowOrder(page)).toEqual(['brush', 'pack', 'leave'])
  })
})

test.describe('/agenda — manual order', () => {
  test('dropping on the bottom edge of a task puts the task below it', async ({ page }) => {
    await clearState(page)
    await seedTasks(page, ROUTINE, localToday())
    await page.goto('/agenda')

    const row = (title: string) =>
      page.locator('[data-component="agenda-task"]').filter({ hasText: title }).first()
    const titles = (): Promise<string[]> =>
      page
        .locator('[data-component="agenda-task"]')
        .evaluateAll((rows) => rows.map((r) => r.textContent ?? ''))
        .then((texts) =>
          texts.flatMap((text) =>
            ['Brush teeth', 'Pack bag', 'Leave the house'].filter((title) => text.includes(title))
          )
        )
    await expect(row('Leave the house')).toBeVisible()
    await expect.poll(titles).toEqual(['Brush teeth', 'Pack bag', 'Leave the house'])

    const source = await row('Brush teeth').boundingBox()
    if (!source) throw new Error('rows not laid out')
    await dragTo(
      page,
      { x: source.x + source.width / 2, y: source.y + source.height / 2 },
      async () => {
        const target = await row('Pack bag').boundingBox()
        if (!target) throw new Error('Pack bag not laid out')
        return { x: target.x + target.width / 2, y: target.y + target.height - 3 }
      },
      async () => {
        await expect(row('Pack bag')).toHaveAttribute('data-drop-state', 'insert-after')
      }
    )

    await expect.poll(titles).toEqual(['Pack bag', 'Brush teeth', 'Leave the house'])
  })

  test('a repeating task reorders its day but cannot take or become a subtask', async ({
    page,
  }) => {
    await clearState(page)
    await seedTasks(
      page,
      [...ROUTINE, { id: 'plants', title: 'Water plants', sortOrder: 1500, rruleString: 'FREQ=DAILY' }],
      localToday()
    )
    await page.goto('/agenda')

    const row = (title: string) =>
      page.locator('[data-component="agenda-task"]').filter({ hasText: title }).first()
    await expect(row('Water plants')).toBeVisible()
    const centre = async (title: string): Promise<{ x: number; y: number }> => {
      const box = await row(title).boundingBox()
      if (!box) throw new Error(`${title} not laid out`)
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }

    // Onto the middle of the repeating task: refused, and the row says why.
    await dragTo(page, await centre('Leave the house'), () => centre('Water plants'), async () => {
      await expect(row('Water plants')).toHaveAttribute('data-drop-state', 'cannot-make-subtask')
      await expect(page.locator('[data-component="agenda-drag-overlay"]')).toContainText(
        "Repeating tasks can't have subtasks"
      )
    })
    await expect(row('Leave the house').locator('[data-task-depth]')).toHaveAttribute(
      'data-task-depth',
      '0'
    )

    // The repeating task itself drags to a new place in the day. Downwards, to
    // the bottom of today's list: aiming at the top of the list would set off
    // the scroller's auto-scroll, which moves the target under a fixed pointer.
    await dragTo(page, await centre('Water plants'), async () => {
      const leave = await row('Leave the house').boundingBox()
      if (!leave) throw new Error('Leave the house not laid out')
      return { x: leave.x + leave.width / 2, y: leave.y + leave.height - 3 }
    })
    await expect
      .poll(async () => {
        const texts = await page
          .locator('[data-component="agenda-task"]')
          .evaluateAll((rows) => rows.map((r) => r.textContent ?? ''))
        // Today's group comes first; later days only hold more Water plants.
        return texts
          .flatMap((text) =>
            ['Water plants', 'Brush teeth', 'Pack bag', 'Leave the house'].filter((t) =>
              text.includes(t)
            )
          )
          .slice(0, 4)
      })
      .toEqual(['Brush teeth', 'Pack bag', 'Leave the house', 'Water plants'])
  })
})
