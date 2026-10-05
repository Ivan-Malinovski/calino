import { test, expect, type Locator, type Page } from '@playwright/test'
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

const storedTask = (page: Page, id: string) =>
  page.evaluate((taskId) => {
    const raw = JSON.parse(localStorage.getItem('calino-storage') ?? '{}')
    return raw.state.events.find((e: { id: string }) => e.id === taskId)
  }, id)

const seed = async (page: Page, settings: Record<string, unknown> = {}) => {
  await clearState(page)
  await page.clock.setFixedTime(NOW)
  await page.addInitScript(
    ({ events, settings }) => {
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
      // Merge over what `clearState` wrote, which already marks onboarding done.
      const existing = JSON.parse(localStorage.getItem('calino-settings') ?? '{"state":{}}')
      localStorage.setItem(
        'calino-settings',
        JSON.stringify({
          ...existing,
          state: { ...existing.state, firstDayOfWeek: 1, showWeekNumbers: true, ...settings },
        })
      )
    },
    {
      events: [
        task('week-a', 'Call the plumber', '2026-09-28', '2026-10-04'),
        task('partial', 'Book flights', '2026-09-29', '2026-10-02'),
        task('one-day', 'Water plants', '2026-10-01', '2026-10-01'),
      ],
      settings,
    }
  )
  await page.goto('/month')
}

// Week 40 (28 Sep – 4 Oct) is the fifth row of a September month grid.
const badge = (page: Page) => page.locator('[data-week-badge="count"]')

test.describe('Month view: sometime-this-week tasks', () => {
  test.beforeEach(async ({ page }) => {
    await seed(page)
  })

  test('shows a count badge in the week row and no card on the due day', async ({ page }) => {
    await expect(badge(page)).toHaveCount(1)
    await expect(badge(page)).toHaveText(/^2/)
    await expect(badge(page)).toHaveAccessibleName('2 tasks this week')
    await expect(page.locator('[data-date="2026-10-04"]')).not.toContainText('Call the plumber')
    await expect(page.locator('[data-date="2026-10-02"]')).not.toContainText('Book flights')
    await expect(page.locator('[data-date="2026-10-01"]')).toContainText('Water plants')
  })

  test('hovering the badge names what it is, and the label goes once it is open', async ({
    page,
  }) => {
    const tip = badge(page).getByText('Sometime this week')
    // The label fades via opacity; Playwright considers transparent elements
    // visible, so check the fade itself before and after hovering.
    await expect(tip).toHaveCSS('opacity', '0')
    await badge(page).hover()
    await expect(tip).toHaveCSS('opacity', '1')
    await badge(page).click()
    await expect(page.locator('[data-component="week-tasks-popover"]')).toBeVisible()
    await expect(tip).toBeHidden()
  })

  test('clicking the badge opens the list without jumping to the week view', async ({ page }) => {
    await badge(page).click()
    const popover = page.locator('[data-component="week-tasks-popover"]')
    await expect(popover).toBeVisible()
    await expect(popover.locator('[data-component="week-task-pill"]')).toHaveCount(2)
    await expect(page).toHaveURL(/\/month/)
    // Only the partial-week task carries a range.
    await expect(popover.locator('[data-testid="week-task-partial"]')).toContainText('Tue – Fri')
    await expect(popover.locator('[data-testid="week-task-week-a"]')).not.toContainText(/–/)
    await page.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)
  })

  test('clicking the week number still opens the week view', async ({ page }) => {
    await page.getByText('40', { exact: true }).click()
    await expect(page).toHaveURL(/\/week/)
  })

  test('ticking a task persists and updates the list', async ({ page }) => {
    await badge(page).click()
    const row = page.locator('[data-testid="week-task-week-a"]')
    await row.getByRole('checkbox').click()
    await expect.poll(async () => (await storedTask(page, 'week-a')).completed).toBe(true)
    // Completed tasks leave the month's lists, but the popover stays open.
    await expect(row).toHaveCount(0)
    await expect(badge(page)).toHaveText(/^1/)
    await expect(page.locator('[data-component="week-tasks-popover"]')).toBeVisible()
  })

  test('quick-add stores a Monday-to-Sunday all-day task for that row', async ({ page }) => {
    await badge(page).click()
    const popover = page.locator('[data-component="week-tasks-popover"]')
    await popover.locator('[data-component="week-task-add"]').click()
    const input = popover.locator('[data-component="week-task-quick-add"]')
    await input.fill('Sort the garage')
    await input.press('Enter')

    await expect(
      popover.locator('[data-component="week-task-pill"]', { hasText: 'Sort the garage' })
    ).toBeVisible()
    await expect(badge(page)).toHaveText(/^3/)
    const stored = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('calino-storage') ?? '{}')
      return raw.state.events.find((e: { title: string }) => e.title === 'Sort the garage')
    })
    expect(stored.start).toBe('2026-09-28T00:00:00')
    expect(stored.dueDate).toBe('2026-10-04')
    expect(stored.isAllDay).toBe(true)
  })

  // dnd-kit's mouse sensor needs a real press, an 8px move, then the target.
  const drag = async (page: Page, from: Locator, to: Locator) => {
    const a = (await from.boundingBox())!
    const b = (await to.boundingBox())!
    await page.mouse.move(a.x + 40, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(a.x + 60, a.y + a.height / 2 + 12, { steps: 4 })
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
    await page.mouse.up()
  }

  test('dragging a task out of the list onto a day makes it an all-day task there', async ({
    page,
  }) => {
    await badge(page).click()
    const popover = page.locator('[data-component="week-tasks-popover"]')
    await drag(
      page,
      popover.locator('[data-testid="week-task-week-a"]'),
      page.locator('[data-date="2026-10-01"]')
    )

    await expect
      .poll(() => storedTask(page, 'week-a'))
      .toMatchObject({
        start: '2026-10-01T00:00:00',
        dueDate: '2026-10-01',
        isAllDay: true,
      })
    await expect(badge(page)).toHaveText(/^1/)
    await expect(page.locator('[data-date="2026-10-01"]')).toContainText('Call the plumber')
    // The list stays open for the rest of the week's tasks.
    await expect(popover).toBeVisible()
    await expect(popover.locator('[data-component="week-task-pill"]')).toHaveCount(1)
  })

  test('dragging a day task onto the week gutter makes it a week task', async ({ page }) => {
    const card = page.locator('[data-date="2026-10-01"]').getByText('Water plants')
    const gutter = page.locator('[class*="weekNumber"]').filter({ hasText: '40' })
    await drag(page, card, gutter)

    await expect
      .poll(() => storedTask(page, 'one-day'))
      .toMatchObject({
        start: '2026-09-28T00:00:00',
        end: '2026-10-04T23:59:59',
        dueDate: '2026-10-04',
        isAllDay: true,
      })
    await expect(badge(page)).toHaveText(/^3/)
    await expect(page.locator('[data-date="2026-10-01"]')).not.toContainText('Water plants')
  })
})

test.describe('Month view: week tasks without week numbers', () => {
  test('keeps a slim gutter holding the badge', async ({ page }) => {
    await seed(page, { showWeekNumbers: false })
    await expect(badge(page)).toHaveText(/^2/)
    const row = page.locator('[class*="weekRowSlim"]').first()
    const box = (await row.locator('[class*="weekNumber"]').first().boundingBox())!
    expect(box.width).toBeLessThan(40)
    await expect(page.locator('[class*="weekNumHeader"]')).toHaveText('')
  })
})

test.describe('Month view: week tasks on a phone', () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true })

  test('fits the count in the narrow gutter and keeps the popover on screen', async ({ page }) => {
    await seed(page)
    await expect(badge(page)).toBeVisible()
    await badge(page).click()
    const popover = page.locator('[data-component="week-tasks-popover"]')
    await expect(popover).toBeVisible()
    const box = (await popover.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    expect(box.y + box.height).toBeLessThanOrEqual(800)
  })
})
