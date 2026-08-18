import { test, expect, type Page } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

const HOUR_HEIGHT = 60
const EVENT_ID = 'tz-snap-event'
const EVENT_TITLE = 'TZ Snap Event'

const START_HOUR = Math.min(new Date().getHours(), 20)
const START_MINUTE_OF_DAY = START_HOUR * 60

function todayLocal(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

async function seedEvent(page: Page): Promise<void> {
  const day = todayLocal()
  const hh = String(START_HOUR).padStart(2, '0')
  const endHh = String(START_HOUR + 1).padStart(2, '0')
  await page.addInitScript(
    ({ calendarKey, event }) => {
      try {
        if (sessionStorage.getItem('__calino_test_tz_snap')) return
        sessionStorage.setItem('__calino_test_tz_snap', '1')
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

test.describe('Secondary Timezone', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
  })

  test('configures secondary timezone in settings and verifies week/day views', async ({
    page,
  }) => {
    await page.goto('/settings?tab=calendar')
    await expect(page.locator('[data-component="calendar-settings"]')).toBeVisible()

    const toggleLabel = page.locator('[data-component="toggle"][data-setting="secondary-timezone-enabled"]')
    const toggleInput = page.getByLabel('Show secondary timezone')
    await expect(toggleLabel).toBeVisible()
    await expect(toggleInput).not.toBeChecked()

    // Enable secondary timezone
    await toggleLabel.click()
    await expect(toggleInput).toBeChecked()

    // Dropdown and custom label input appear
    const select = page.getByLabel('Secondary timezone', { exact: true })
    await expect(select).toBeVisible()
    await select.selectOption('America/New_York')

    const labelInput = page.getByLabel('Secondary timezone label')
    await expect(labelInput).toBeVisible()
    await labelInput.fill('NYC')

    // Check persistence across reload
    await page.reload()
    await expect(page.locator('[data-component="calendar-settings"]')).toBeVisible()
    await expect(page.getByLabel('Show secondary timezone')).toBeChecked()
    await expect(page.getByLabel('Secondary timezone', { exact: true })).toHaveValue('America/New_York')
    await expect(page.getByLabel('Secondary timezone label')).toHaveValue('NYC')

    // Navigate to Week View
    await page.goto('/week')
    await expect(page.locator('[data-component="header"]')).toBeVisible()

    // Week header should contain the custom label 'NYC'
    await expect(page.getByText('NYC')).toBeVisible()

    // Navigate to Day View
    await page.goto('/day')
    await expect(page.locator('[data-component="header"]')).toBeVisible()
    await expect(page.getByText('NYC')).toBeVisible()

    // Disable secondary timezone in settings
    await page.goto('/settings?tab=calendar')
    await expect(page.locator('[data-component="calendar-settings"]')).toBeVisible()
    const toggleLabelToDisable = page.locator('[data-component="toggle"][data-setting="secondary-timezone-enabled"]')
    await toggleLabelToDisable.click()
    await expect(page.getByLabel('Show secondary timezone')).not.toBeChecked()

    // Navigate to Week View and verify 'NYC' is no longer in the header
    await page.goto('/week')
    await expect(page.locator('[data-component="header"]')).toBeVisible()
    await expect(page.getByText('NYC')).toHaveCount(0)
  })

  test('drag-and-drop snapping is accurate when secondary timezone is enabled in week view', async ({
    page,
  }) => {
    await seedEvent(page)

    // Pre-enable secondary timezone in settings localStorage
    await page.addInitScript(() => {
      const raw = localStorage.getItem('calino-settings')
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 1 }
      parsed.state = {
        ...(parsed.state ?? {}),
        secondaryTimezoneEnabled: true,
        secondaryTimezone: 'UTC',
        secondaryTimezoneLabel: 'UTC',
      }
      localStorage.setItem('calino-settings', JSON.stringify(parsed))
    })

    await page.goto('/week')
    await expect(page.locator('[data-component="header"]')).toBeVisible()
    await expect(card(page)).toBeVisible({ timeout: 20_000 })

    // Perform an off-grid drag (+50px snaps to +45min)
    await dragDownBy(page, 50, async () => {
      const band = page.locator('[data-component="drop-preview"]')
      await expect(band).toHaveCount(1)
      await expect(band).toHaveAttribute(
        'data-minute-of-day',
        String(START_MINUTE_OF_DAY + 45)
      )
    })

    const moved = await readEvent(page)
    expect(minuteOfDay(moved.start)).toBe(START_MINUTE_OF_DAY + 45)
  })

  test('drag-and-drop snapping is accurate when secondary timezone is enabled in day view', async ({
    page,
  }) => {
    await seedEvent(page)

    // Pre-enable secondary timezone in settings localStorage
    await page.addInitScript(() => {
      const raw = localStorage.getItem('calino-settings')
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 1 }
      parsed.state = {
        ...(parsed.state ?? {}),
        secondaryTimezoneEnabled: true,
        secondaryTimezone: 'America/New_York',
        secondaryTimezoneLabel: 'NYC',
      }
      localStorage.setItem('calino-settings', JSON.stringify(parsed))
    })

    await page.goto('/day')
    await expect(page.locator('[data-component="header"]')).toBeVisible()
    await expect(card(page)).toBeVisible({ timeout: 20_000 })

    // Perform a 1-hour drag
    await dragDownBy(page, HOUR_HEIGHT)

    const moved = await readEvent(page)
    expect(minuteOfDay(moved.start)).toBe(START_MINUTE_OF_DAY + 60)
  })
})
