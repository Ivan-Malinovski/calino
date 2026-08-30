/**
 * Phase 2 (C5) - timezone correctness through the UI.
 *
 * A Copenhagen-zoned event viewed from a New York browser must show the NY
 * wall clock (not the event-zone wall clock), carry a timezone badge when
 * the zones differ, and - when dragged - the NY wall clock must move by
 * exactly the drag (no device/event offset shift) while the event stays
 * in its own zone. Server-byte assertions for the same serialization path
 * live in the icalTypeMapping unit tests.
 *
 * Events are seeded directly into the calendar store (like
 * drag-quarter-hour.spec.ts) with no CalDAV account, so nothing can race
 * or replace them: the boot sync would otherwise import every mock
 * collection and rewrite the store.
 */
import { test, expect, type Page } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

// 2026-02-10 12:00Z = 07:00 America/New_York - a winter Tuesday, CET (+01).
const FIXED_INSTANT = new Date('2026-02-10T12:00:00Z')

test.use({ timezoneId: 'America/New_York' })

const CALENDAR = {
  id: 'tzc',
  name: 'Timezone',
  color: '#EA4335',
  isVisible: true,
  isDefault: true,
  showTasksInViews: true,
  supportedComponents: ['VEVENT', 'VTODO', 'VJOURNAL'],
}

/** Seed the calendar store directly with the Timezone calendar + events. */
async function seedStore(page: Page, events: Record<string, unknown>[]): Promise<void> {
  await page.addInitScript(
    ({ calendarKey, events, calendars }) => {
      try {
        if (sessionStorage.getItem('__calino_test_tz_correct')) return
        sessionStorage.setItem('__calino_test_tz_correct', '1')
        const raw = localStorage.getItem(calendarKey)
        const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
        parsed.state = { ...(parsed.state ?? {}), calendars, events }
        localStorage.setItem(calendarKey, JSON.stringify(parsed))
      } catch {
        /* noop */
      }
    },
    {
      calendarKey: 'calino-storage',
      calendars: [CALENDAR],
      events,
    }
  )
}

/** A daily Copenhagen series at 10:00 CET starting Mon Feb 9 2026. */
const seriesMaster = {
  id: 'tz-series',
  uid: 'tz-series',
  type: 'event',
  calendarId: 'tzc',
  title: 'Copenhagen Daily',
  start: '2026-02-09T10:00:00',
  end: '2026-02-09T11:00:00',
  isAllDay: false,
  timezone: 'Europe/Copenhagen',
  rruleString: 'FREQ=DAILY;COUNT=5',
}

/** A single Copenhagen event, 10:00 CET = 09:00Z = 04:00 EST. */
const singleEvent = {
  id: 'tz-single',
  uid: 'tz-single',
  type: 'event',
  calendarId: 'tzc',
  title: 'Copenhagen Standup',
  start: '2026-02-10T10:00:00',
  end: '2026-02-10T11:00:00',
  isAllDay: false,
  timezone: 'Europe/Copenhagen',
}

const card = (page: Page, title: string) =>
  page.locator('[data-component="event-card"]', { hasText: title }).first()

async function dragDownBy(
  page: Page,
  title: string,
  deltaY: number,
  midDrag?: () => Promise<void>
): Promise<void> {
  await card(page, title).scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  const box = await card(page, title).boundingBox()
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
  if (midDrag) await midDrag()
  await page.mouse.up()
  await page.waitForTimeout(300)
}

test.describe('timezone correctness through the UI', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    // Installed before any navigation so the app first new Date() sees it.
    await page.clock.setFixedTime(FIXED_INSTANT)
  })

  test('a Copenhagen series viewed from New York shows the NY wall clock and a zone badge', async ({
    page,
  }) => {
    await seedStore(page, [seriesMaster])
    await page.goto('/week')

    // Tue Feb 10 occurrence of the series: 10:00 CET = 09:00Z = 04:00 EST.
    const cph = card(page, 'Copenhagen Daily')
    await expect(cph).toBeVisible({ timeout: 10_000 })
    await expect(cph).toContainText('04:00')
    // The zone badge appears because the event zone differs from the device
    // zone. It shows the city alone so it fits on the time line (4e7606a); the
    // full TZID stays on the title attribute, which is what actually has to
    // survive — a card reading "Copenhagen" with the wrong zone behind it would
    // pass a text check.
    const zone = cph.locator('[data-component="event-card-zone"]')
    await expect(zone).toHaveText('Copenhagen')
    await expect(zone).toHaveAttribute('title', 'Europe/Copenhagen')
  })

  test('dragging a TZID event keeps the series zone and the NY wall clock moves with the drag', async ({
    page,
  }) => {
    await seedStore(page, [singleEvent])
    await page.goto('/week')
    const cph = card(page, 'Copenhagen Standup')
    await expect(cph).toBeVisible({ timeout: 10_000 })
    await expect(cph).toContainText('04:00')

    // Drag down 2 hours: 04:00 -> 06:00 EST = 11:00Z = 12:00 CET. The event
    // stays Copenhagen-zoned (badge still shown) and the card wall clock
    // moves by exactly the drag - proving the drag did not shift the event
    // by the device/event offset. Server-byte assertions for the same
    // serialization path live in the icalTypeMapping unit tests.
    await dragDownBy(page, 'Copenhagen Standup', 120, async () => {
      // The drop-preview band must start from the DEVICE-frame minute (04:00 =
      // 240), not the event-zone wall clock (10:00 = 600) — otherwise the band
      // floats above the card. 120px at 60px/h = +120min -> 360 (06:00).
      const band = page.locator('[data-component="drop-preview"]')
      await expect(band).toHaveCount(1)
      await expect(band).toHaveAttribute('data-minute-of-day', '360')
    })
    await expect(cph).toContainText('06:00')
    // Still Copenhagen-zoned after the drag — the point of the test. Asserted
    // on the title, since the visible badge is only the city (see above).
    const zone = cph.locator('[data-component="event-card-zone"]')
    await expect(zone).toHaveAttribute('title', 'Europe/Copenhagen')
  })

  test('the preview popup shows the NY wall clock and edit fields initialise in the device frame', async ({
    page,
  }) => {
    await seedStore(page, [singleEvent])
    await page.goto('/week')
    const cph = card(page, 'Copenhagen Standup')
    await expect(cph).toBeVisible({ timeout: 10_000 })

    await cph.click()
    const preview = page.locator('[data-component="event-preview"]')
    await expect(preview).toBeVisible({ timeout: 10_000 })

    // 10:00 CET = 09:00Z = 04:00 EST. The preview must render the device
    // frame (like the card), not the event-zone wall clock (10:00).
    await expect(preview).toContainText('04:00')
    await expect(preview).toContainText('05:00')

    // Opening the time editor must initialise the fields in the device frame.
    await preview.getByText('04:00 - 05:00').click()
    await expect(page.getByLabel('Start time')).toHaveValue('04:00')
    await expect(page.getByLabel('End time')).toHaveValue('05:00')

    // The preview is itself a z-indexed popover. The time picker must remain
    // clickable above it when portaled to the document body.
    const startTime = page.getByLabel('Start time')
    await startTime.click()
    const options = page.locator('[data-component="time-picker-options"]')
    await expect(options).toBeVisible()
    await options.getByRole('option', { name: '04:15' }).click()
    await expect(startTime).toHaveValue('04:15')
  })

  test('a cross-midnight TZID event stays on a single device day', async ({ page }) => {
    await seedStore(page, [
      {
        id: 'tz-late',
        uid: 'tz-late',
        type: 'event',
        calendarId: 'tzc',
        title: 'Late Night Copenhagen',
        start: '2026-02-10T23:30:00',
        end: '2026-02-11T01:00:00',
        isAllDay: false,
        timezone: 'Europe/Copenhagen',
      },
    ])
    await page.goto('/week')
    const late = card(page, 'Late Night Copenhagen')
    await expect(late).toBeVisible({ timeout: 10_000 })

    // 23:30 CPH = 17:30 EST on Feb 10; 01:00 CPH Feb 11 = 19:00 EST Feb 10:
    // one device day, so the card must NOT be flagged multi-day (the naive
    // parse saw two calendar dates and added the multi-day styling).
    await expect(late).not.toHaveAttribute('data-multi-day', '')
    await expect(late).toContainText('17:30')
  })
})
