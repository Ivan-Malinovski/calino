import { test, expect, type Locator, type Page } from '@playwright/test'
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

async function seedEvent(
  page: Page,
  start = `${weekStartDate()}T00:00:00`,
  end = `${weekStartDate(2)}T23:59:59`
): Promise<void> {
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
        start,
        end,
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
  if (!source) throw new Error('could not locate all-day card')

  const sourceX = source.x + source.width / 2
  const sourceY = source.y + source.height / 2
  await page.mouse.move(sourceX, sourceY)
  await page.mouse.down()
  for (let step = 1; step <= 5; step++) {
    await page.mouse.move(sourceX + step * 3, sourceY, { steps: 1 })
    await page.waitForTimeout(15)
  }

  // The hour grid can still be scrolling (it jumps towards the current time on load, and
  // dragging near its top edge auto-scrolls it), so a target measured before the drag may
  // have moved. Re-measure on every attempt and only release once the drop preview confirms
  // that dnd-kit resolved the target under the pointer.
  const target = page.locator(`[data-date="${targetDate}"][data-hour="10:00"]`).first()
  const preview = page.locator('[data-component="drop-preview"]').first()
  await expect(async () => {
    await target.scrollIntoViewIfNeeded()
    const box = await target.boundingBox()
    if (!box) throw new Error('could not locate drop target cell')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 })
    await expect(preview).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15_000 })
  await page.mouse.up()
}

async function dragToHeader(page: Page, card: Locator, targetDate: string): Promise<void> {
  const header = page.locator(`[data-component="week-day-header"][data-date="${targetDate}"]`)
  const from = (await card.boundingBox())!
  const to = (await header.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2, { steps: 5 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 })
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

  test('dragging a fragment onto another day header moves the whole span', async ({ page }) => {
    // Grab the second day's fragment and drop it on the fourth day: the event
    // starts two days later and keeps its three-day length.
    const fragment = page.locator(
      `[data-component="week-day-header"][data-date="${weekStartDate(1)}"] [data-component="event-card"][aria-label*="${EVENT_TITLE}"]`
    )
    await dragToHeader(page, fragment, weekStartDate(3))

    await expect
      .poll(async () =>
        page.evaluate((id) => {
          const parsed = JSON.parse(localStorage.getItem('calino-storage') ?? '{}')
          const event = (parsed.state?.events ?? []).find((e: { id: string }) => e.id === id)
          return event && { start: event.start, end: event.end, isAllDay: event.isAllDay }
        }, EVENT_ID)
      )
      .toEqual({
        start: `${weekStartDate(2)}T00:00:00`,
        end: `${weekStartDate(4)}T23:59:59`,
        isAllDay: true,
      })
  })
})

test.describe('Week view legacy all-day events', () => {
  test.use({ timezoneId: 'America/New_York' })

  test('dropping an all-day event stored at UTC midnight uses the selected header date', async ({
    page,
  }) => {
    await clearState(page)
    await page.clock.setFixedTime(new Date('2026-11-25T12:00:00-05:00'))
    await seedEvent(page, '2026-11-25T00:00:00.000Z', '2026-11-25T00:00:00.000Z')
    await page.goto('/week')

    const card = page.locator('[data-component="week-day-header"]').getByText(EVENT_TITLE)
    await dragToHeader(page, card, '2026-11-26')
    await expect(
      page
        .locator('[data-component="week-day-header"][data-date="2026-11-26"]')
        .getByText(EVENT_TITLE)
    ).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate((id) => {
          const { state } = JSON.parse(localStorage.getItem('calino-storage')!)
          const event = state.events.find((item: { id: string }) => item.id === id)
          return [event.start, event.end]
        }, EVENT_ID)
      )
      .toEqual(['2026-11-26', '2026-11-26'])
  })
})
