/**
 * Regression spec for 15-minute drop granularity in the week and day views.
 *
 * Background: the time grid is built from per-hour droppable cells, and
 * `handleDragEnd` used to derive the new start time solely by parsing the
 * cell's id (`yyyy-MM-dd-HH:mm`). That threw away where inside the cell the
 * card was dropped, so a 1-hour event could only ever land on :00.
 *
 * Fix: the droppable id now supplies only the day; the time of day comes from
 * dnd-kit's vertical drag delta, snapped to the nearest quarter hour by
 * `snapMinuteOfDay` (src/features/calendar/lib/dragSnap.ts).
 *
 * The dragged card itself is NOT snapped (that felt stuttery); instead a
 * DropPreviewBand marks the target quarter hour while the drag is in flight.
 *
 * The event is seeded at the current hour so it sits where both views
 * auto-scroll to on mount — fighting that auto-scroll from the test makes
 * drags start from a stale card position.
 */
import { test, expect, type Page } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

const HOUR_HEIGHT = 60
const EVENT_ID = 'quarter-snap-event'
const EVENT_TITLE = 'Quarter Snap Event'

// Keep the event (and a 1-hour drag below it) inside the grid.
const START_HOUR = Math.min(new Date().getHours(), 20)
const START_MINUTE_OF_DAY = START_HOUR * 60

function todayLocal(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * Seed a 1-hour *local* event today (local, not UTC, so the assertions below
 * can talk about wall-clock minutes regardless of the runner's timezone).
 */
async function seedEvent(page: Page): Promise<void> {
  const day = todayLocal()
  const hh = String(START_HOUR).padStart(2, '0')
  const endHh = String(START_HOUR + 1).padStart(2, '0')
  await page.addInitScript(
    ({ calendarKey, event }) => {
      try {
        if (sessionStorage.getItem('__calino_test_quarter_snap')) return
        sessionStorage.setItem('__calino_test_quarter_snap', '1')
        const raw = localStorage.getItem(calendarKey)
        const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
        const events = parsed.state?.events ?? []
        events.push(event)
        parsed.state = { ...(parsed.state ?? {}), events }
        localStorage.setItem(calendarKey, JSON.stringify(parsed))
      } catch {
        /* noop */
      }
    },
    {
      calendarKey: 'calino-storage',
      event: {
        id: EVENT_ID,
        title: EVENT_TITLE,
        type: 'event',
        start: `${day}T${hh}:00:00`,
        end: `${day}T${endHh}:00:00`,
        allDay: false,
        calendarId: 'default',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }
  )
}

const card = (page: Page) =>
  page.locator('[data-component="event-card"]', { hasText: EVENT_TITLE }).first()

/**
 * Drag the card down by `deltaY`, with the activation nudge dnd-kit's
 * PointerSensor needs (8px threshold). The nudge is horizontal so it doesn't
 * perturb the vertical delta under test. `beforeDrop` runs with the pointer
 * still down, for mid-drag assertions.
 */
async function dragDownBy(
  page: Page,
  deltaY: number,
  beforeDrop?: () => Promise<void>
): Promise<void> {
  await card(page).scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)

  const box = await card(page).boundingBox()
  if (!box) throw new Error('event card not found')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2

  await page.mouse.move(x, y)
  await page.waitForTimeout(30)
  await page.mouse.down()
  for (let i = 1; i <= 5; i++) {
    await page.mouse.move(x + i * 3, y, { steps: 1 })
    await page.waitForTimeout(15)
  }
  await page.mouse.move(x, y + deltaY, { steps: 20 })
  await page.waitForTimeout(50)
  if (beforeDrop) await beforeDrop()
  await page.mouse.up()
  await page.waitForTimeout(300)
}

/** The persisted event, read back out of the calendar store's localStorage. */
async function readEvent(page: Page): Promise<{ start: string; end: string }> {
  return page.evaluate((id: string) => {
    const parsed = JSON.parse(localStorage.getItem('calino-storage') ?? '{}')
    const event = (parsed.state?.events ?? []).find((e: { id: string }) => e.id === id)
    if (!event) throw new Error('event missing from store')
    return { start: event.start, end: event.end }
  }, EVENT_ID)
}

function minuteOfDay(iso: string): number {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

function durationMinutes(start: string, end: string): number {
  return (new Date(end).getTime() - new Date(start).getTime()) / 60_000
}

for (const view of ['/week', '/day'] as const) {
  test.describe(`${view} — drops snap to 15-minute increments`, () => {
    test.beforeEach(async ({ page }) => {
      await clearState(page)
      await seedEvent(page)
      await page.goto(view)
      await expect(page.locator('[data-component="header"]')).toBeVisible()
      // The view is lazy-loaded; under parallel workers on a cold dev server
      // the first paint can take a while, so don't hold it to the 5s default.
      await expect(card(page)).toBeVisible({ timeout: 20_000 })
    })

    test('an off-grid drag lands on the nearest quarter hour', async ({ page }) => {
      // 50px at 60px/hour = +50min → snaps back to +45min.
      // Under the old whole-hour behaviour this landed a full hour later.
      await dragDownBy(page, 50, async () => {
        // Mid-drag: the preview band marks the quarter hour the drop will use.
        const band = page.locator('[data-component="drop-preview"]')
        await expect(band).toHaveCount(1)
        await expect(band).toHaveAttribute(
          'data-minute-of-day',
          String(START_MINUTE_OF_DAY + 45)
        )
      })

      // The band is torn down once the drag finishes.
      await expect(page.locator('[data-component="drop-preview"]')).toHaveCount(0)

      const moved = await readEvent(page)
      expect(minuteOfDay(moved.start)).toBe(START_MINUTE_OF_DAY + 45)
      expect(durationMinutes(moved.start, moved.end)).toBe(60)
    })

    test('a drag of exactly one hour still lands on the hour', async ({ page }) => {
      await dragDownBy(page, HOUR_HEIGHT)

      const moved = await readEvent(page)
      expect(minuteOfDay(moved.start)).toBe(START_MINUTE_OF_DAY + 60)
      expect(durationMinutes(moved.start, moved.end)).toBe(60)
    })
  })
}
