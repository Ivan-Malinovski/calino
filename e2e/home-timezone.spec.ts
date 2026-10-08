/**
 * A home-zone override replaces the browser clock.
 *
 * The browser is pinned to UTC. A 10:00 Europe/London event in July is
 * 09:00Z. With no override the card shows 09:00. With home set to
 * Europe/London it shows 10:00, and a one-hour drag stores 11:00 London.
 */
import { test, expect, type Page } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

const FIXED_INSTANT = new Date('2026-07-08T12:00:00Z')

test.use({ timezoneId: 'UTC' })

const CALENDAR = {
  id: 'home-tz',
  name: 'Home',
  color: '#4285F4',
  isVisible: true,
  isDefault: true,
  showTasksInViews: true,
  supportedComponents: ['VEVENT', 'VTODO', 'VJOURNAL'],
}

const EVENT = {
  id: 'home-london',
  uid: 'home-london',
  type: 'event',
  calendarId: 'home-tz',
  title: 'London Standup',
  start: '2026-07-08T10:00:00',
  end: '2026-07-08T11:00:00',
  isAllDay: false,
  timezone: 'Europe/London',
}

async function seedStore(page: Page): Promise<void> {
  await page.addInitScript(
    ({ calendarKey, events, calendars }) => {
      try {
        if (sessionStorage.getItem('__calino_test_home_tz')) return
        sessionStorage.setItem('__calino_test_home_tz', '1')
        const raw = localStorage.getItem(calendarKey)
        const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
        parsed.state = { ...(parsed.state ?? {}), calendars, events }
        localStorage.setItem(calendarKey, JSON.stringify(parsed))
      } catch {
        /* noop */
      }
    },
    { calendarKey: 'calino-storage', calendars: [CALENDAR], events: [EVENT] }
  )
}

async function seedHome(page: Page, homeTimezone: string | null): Promise<void> {
  await page.addInitScript((zone) => {
    try {
      const raw = localStorage.getItem('calino-settings')
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 4 }
      parsed.state = { ...(parsed.state ?? {}), homeTimezone: zone }
      parsed.version = 4
      localStorage.setItem('calino-settings', JSON.stringify(parsed))
    } catch {
      /* noop */
    }
  }, homeTimezone)
}

const card = (page: Page) =>
  page.locator('[data-component="event-card"]', { hasText: 'London Standup' }).first()

async function dragDownBy(page: Page, deltaY: number): Promise<void> {
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
  await page.mouse.up()
  await page.waitForTimeout(300)
}

test.describe('home timezone', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await page.clock.setFixedTime(FIXED_INSTANT)
  })

  test('a UTC browser shows the UTC wall clock when home is automatic', async ({ page }) => {
    await seedStore(page)
    await page.goto('/week')
    const london = card(page)
    await expect(london).toBeVisible({ timeout: 10_000 })
    await expect(london).toContainText('09:00')
    await expect(london.locator('[data-component="event-card-zone"]')).toHaveAttribute(
      'title',
      'Europe/London'
    )
  })

  test('home Europe/London shows and drags the London wall clock from a UTC browser', async ({
    page,
  }) => {
    await seedStore(page)
    await seedHome(page, 'Europe/London')
    await page.goto('/week')
    const london = card(page)
    await expect(london).toBeVisible({ timeout: 10_000 })
    await expect(london).toContainText('10:00')
    await expect(london.locator('[data-component="event-card-zone"]')).toHaveCount(0)

    await dragDownBy(page, 60)
    await expect(london).toContainText('11:00')

    const stored = await page.evaluate(() => {
      const parsed = JSON.parse(localStorage.getItem('calino-storage') ?? '{}')
      return (parsed.state?.events ?? []).find(
        (event: { id: string }) => event.id === 'home-london'
      )
    })
    expect(stored.start).toBe('2026-07-08T11:00:00')
    expect(stored.timezone).toBe('Europe/London')
  })
})
