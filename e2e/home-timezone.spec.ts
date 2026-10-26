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

async function seedStore(page: Page, events: unknown[] = [EVENT]): Promise<void> {
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
    { calendarKey: 'calino-storage', calendars: [CALENDAR], events }
  )
}

function column(page: Page, day: string) {
  return page.locator('[data-component="week-grid"] > div').filter({
    has: page.locator(`[data-date="${day}"]`),
  })
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

  test('a floating event and an all-day event stay on the home wall clock', async ({ page }) => {
    await seedStore(page, [
      {
        id: 'float',
        uid: 'float',
        type: 'event',
        calendarId: 'home-tz',
        title: 'Floating standup',
        start: '2026-07-08T09:00:00',
        end: '2026-07-08T10:00:00',
        isAllDay: false,
      },
      {
        id: 'all-day',
        uid: 'all-day',
        type: 'event',
        calendarId: 'home-tz',
        title: 'Bank holiday',
        start: '2026-07-08T00:00:00',
        end: '2026-07-08T23:59:59',
        isAllDay: true,
      },
    ])
    await seedHome(page, 'Pacific/Auckland')
    await page.goto('/week')

    const floating = page
      .locator('[data-component="event-card"]', { hasText: 'Floating standup' })
      .first()
    await expect(floating).toBeVisible({ timeout: 10_000 })
    await expect(floating).toContainText('09:00')
    await expect(floating).not.toContainText('21:00')
    await expect(floating).not.toContainText('22:00')

    const holiday = page.locator('[data-component="week-day-header"][data-date="2026-07-08"]', {
      hasText: 'Bank holiday',
    })
    await expect(holiday).toBeVisible()
    await expect(
      page.locator('[data-component="week-day-header"][data-date="2026-07-07"]', {
        hasText: 'Bank holiday',
      })
    ).toHaveCount(0)
  })

  test('a naive timed task stays on its due day from a zone ahead of the browser', async ({
    page,
  }) => {
    await seedStore(page, [
      {
        id: 'invoice',
        uid: 'invoice',
        type: 'task',
        calendarId: 'home-tz',
        title: 'Call Auckland',
        start: '2026-07-08T15:00:00',
        end: '2026-07-08T15:00:00',
        dueDate: '2026-07-08T15:00:00',
        isAllDay: false,
        completed: false,
      },
    ])
    await seedHome(page, 'Pacific/Auckland')
    await page.goto('/week')

    const day = column(page, '2026-07-08')
    const task = day.locator('[data-component="event-card"]', { hasText: 'Call Auckland' })
    await expect(task).toBeVisible({ timeout: 10_000 })
    await expect(task).toHaveAttribute('aria-label', /due 15:00/)
    await expect(
      column(page, '2026-07-09').locator('[data-component="event-card"]', {
        hasText: 'Call Auckland',
      })
    ).toHaveCount(0)
  })

  test('the settings picker filters zones by typing and saves the choice', async ({ page }) => {
    await page.goto('/settings')
    const picker = page.getByRole('combobox', { name: 'Home timezone' })
    await picker.click()
    await picker.fill('auckland')
    const options = page.locator('[data-component="timezone-select"]').getByRole('option')
    await expect(options).toHaveCount(1)
    await expect(options.first()).toContainText('Pacific/Auckland')

    await picker.fill('new york')
    await expect(options.first()).toContainText('New York')

    await picker.fill('no-such-place')
    await expect(options).toHaveCount(0)

    await picker.fill('auckland')
    await picker.press('Enter')
    await expect(picker).toHaveValue('Pacific/Auckland')
    await expect(page.locator('[data-setting="home-timezone"]')).toHaveAttribute(
      'data-value',
      'Pacific/Auckland'
    )

    await picker.click()
    await options.filter({ hasText: 'Automatic' }).click()
    await expect(page.locator('[data-setting="home-timezone"]')).toHaveAttribute('data-value', '')
  })

  test('week and day views label the home zone only while one is chosen', async ({ page }) => {
    await seedStore(page)
    await page.goto('/week')
    await expect(card(page)).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-component="home-zone-label"]')).toHaveCount(0)

    await seedHome(page, 'Asia/Shanghai')
    await page.goto('/week')
    const label = page.locator('[data-component="home-zone-label"]')
    await expect(label).toHaveText('GMT+8')
    await expect(label).toHaveAttribute('title', 'Times shown in Asia/Shanghai')

    await page.goto('/day')
    await expect(label).toHaveText('GMT+8')
  })
})
