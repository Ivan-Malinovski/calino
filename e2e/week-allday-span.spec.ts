import { test, expect, type Page } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

const EVENT_ID = 'week-all-day-span'
const EVENT_TITLE = 'Three day conference'

function weekStartDate(offset = 0): string {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  const daysSinceMonday = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - daysSinceMonday + offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

async function seedEvent(page: Page): Promise<void> {
  const start = weekStartDate()
  const end = weekStartDate(2)
  await page.addInitScript(
    ({ event }) => {
      try {
        if (sessionStorage.getItem('__calino_test_week_all_day_span')) return
        sessionStorage.setItem('__calino_test_week_all_day_span', '1')
        const raw = localStorage.getItem('calino-storage')
        const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
        parsed.state = {
          ...(parsed.state ?? {}),
          events: [...(parsed.state?.events ?? []), event],
        }
        localStorage.setItem('calino-storage', JSON.stringify(parsed))
      } catch {
        /* noop */
      }
    },
    {
      event: {
        id: EVENT_ID,
        title: EVENT_TITLE,
        type: 'event',
        start: `${start}T00:00:00`,
        end: `${end}T23:59:59`,
        isAllDay: true,
        calendarId: 'default',
      },
    }
  )
}

async function dragCardToCell(page: Page, targetDate: string): Promise<void> {
  const card = page
    .locator('[data-component="event-card"]')
    .filter({ hasText: EVENT_TITLE })
    .first()
  await card.scrollIntoViewIfNeeded()
  const source = await card.boundingBox()
  const target = await page
    .locator(`[data-date="${targetDate}"][data-hour="10:00"]`)
    .first()
    .boundingBox()
  if (!source || !target) throw new Error('could not locate all-day card or target cell')

  const sourceX = source.x + source.width / 2
  const sourceY = source.y + source.height / 2
  const targetX = target.x + target.width / 2
  const targetY = target.y + target.height / 2
  await page.mouse.move(sourceX, sourceY)
  await page.mouse.down()
  for (let step = 1; step <= 5; step++) {
    await page.mouse.move(sourceX + step * 3, sourceY, { steps: 1 })
    await page.waitForTimeout(15)
  }
  await page.mouse.move(targetX, targetY, { steps: 20 })
  await page.mouse.up()
}

test.describe('Week view multi-day all-day events', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await seedEvent(page)
    await page.goto('/week')
  })

  test('renders one pill under each covered day header', async ({ page }) => {
    const cards = page.locator(
      `[class*="dayHeader"] [data-component="event-card"][aria-label*="${EVENT_TITLE}"]`
    )
    await expect(cards).toHaveCount(3)
  })

  test('dragging a fragment resolves the original event id', async ({ page }) => {
    await expect(
      page.locator('[data-component="event-card"]').filter({ hasText: EVENT_TITLE }).first()
    ).toBeVisible()
    await dragCardToCell(page, weekStartDate(1))

    const stored = await page.evaluate((id) => {
      const parsed = JSON.parse(localStorage.getItem('calino-storage') ?? '{}')
      return (parsed.state?.events ?? []).find((event: { id: string }) => event.id === id)
    }, EVENT_ID)

    expect(stored).toMatchObject({ id: EVENT_ID, isAllDay: false })
  })
})
