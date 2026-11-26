/**
 * Issue #281 — pick a time zone for an event.
 *
 * The browser (and so home) is UTC. A new event is typed as 14:00–15:00 in
 * Asia/Tokyo: the form says what that is at home, the event is stored as a
 * Tokyo wall clock, and reopening it shows the Tokyo times again.
 */
import { test, expect, type Page } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

test.use({ timezoneId: 'UTC', viewport: { width: 1280, height: 800 } })

const CALENDAR = {
  id: 'tz-picker',
  name: 'Trips',
  color: '#4285F4',
  isVisible: true,
  isDefault: true,
  showTasksInViews: true,
  supportedComponents: ['VEVENT', 'VTODO', 'VJOURNAL'],
}

async function seed(page: Page, events: object[] = []): Promise<void> {
  await page.addInitScript(
    ({ calendars, events }) => {
      try {
        if (sessionStorage.getItem('__calino_test_tz_picker')) return
        sessionStorage.setItem('__calino_test_tz_picker', '1')
        const raw = localStorage.getItem('calino-storage')
        const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
        parsed.state = { ...(parsed.state ?? {}), calendars, events }
        localStorage.setItem('calino-storage', JSON.stringify(parsed))
        const rawSettings = localStorage.getItem('calino-settings')
        const settings = rawSettings ? JSON.parse(rawSettings) : { state: {}, version: 4 }
        settings.state = { ...(settings.state ?? {}), timeFormat: '24h' }
        localStorage.setItem('calino-settings', JSON.stringify(settings))
      } catch {
        /* noop */
      }
    },
    { calendars: [CALENDAR], events }
  )
}

async function storedEvent(page: Page, title: string) {
  return page.evaluate((title) => {
    const parsed = JSON.parse(localStorage.getItem('calino-storage') ?? '{}')
    return (parsed.state?.events ?? []).find((event: { title: string }) => event.title === title)
  }, title)
}

test.describe('event time zone picker', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await page.clock.setFixedTime(new Date('2026-07-08T08:00:00Z'))
  })

  test('creates an event in a picked zone and reopens it in that zone', async ({ page }) => {
    await seed(page)
    await page.goto('/week')
    await expect(page.locator('[data-component="header"]')).toBeVisible()
    await page.keyboard.press('c')

    const modal = page.locator('[data-component="modal-card"]')
    await expect(modal).toBeVisible()
    await modal.getByPlaceholder('Event title').fill('Tokyo dinner')

    const start = modal.getByLabel('Start time')
    const end = modal.getByLabel('End time')
    await start.fill('14:00')
    await start.blur()
    await end.fill('15:00')
    await end.blur()

    const toggle = modal.getByRole('button', { name: 'Time zone' })
    const picker = modal.getByRole('combobox', { name: 'Time zone' })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(picker).toBeHidden()
    const endBox = (await end.boundingBox())!
    expect((await toggle.boundingBox())!.x).toBeGreaterThan(endBox.x + endBox.width)

    await toggle.focus()
    await page.keyboard.press('Space')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(
      await picker.evaluate(
        (input) =>
          input.getBoundingClientRect().top -
          input
            .closest('[data-component="modal-card"]')!
            .querySelector('[data-component="event-end-time"]')!
            .getBoundingClientRect().bottom
      )
    ).toBeGreaterThan(0)
    // A new event starts in the home zone, with nothing extra to say.
    await expect(picker).toHaveValue('UTC')
    await expect(modal.locator('[data-component="event-home-zone-times"]')).toHaveCount(0)

    await picker.click()
    await picker.fill('tokyo')
    await page.keyboard.press('Enter')
    await expect(picker).toHaveValue('Tokyo (JST)')
    await toggle.click()
    await expect(picker).toBeHidden()

    // The fields keep what was typed; the line below reads it on the home clock.
    await expect(start).toHaveValue('14:00')
    await expect(modal.locator('[data-component="event-home-zone-times"]')).toHaveText(
      '05:00–06:00 in UTC'
    )

    await modal.getByRole('button', { name: 'Create' }).click()
    await expect(modal).toBeHidden()

    await expect
      .poll(() => storedEvent(page, 'Tokyo dinner'))
      .toMatchObject({
        start: '2026-07-08T14:00:00',
        end: '2026-07-08T15:00:00',
        timezone: 'Asia/Tokyo',
      })

    // The week grid is on the home clock and tags the event's own zone.
    const card = page.locator('[data-component="event-card"]', { hasText: 'Tokyo dinner' }).first()
    await expect(card).toContainText('05:00')
    await expect(card.locator('[data-component="event-card-zone"]')).toHaveAttribute(
      'title',
      'Asia/Tokyo'
    )

    await card.click()
    const preview = page.locator('[data-component="event-preview"]')
    await expect(preview).toBeVisible()
    await preview.getByRole('button', { name: 'Open event' }).click()
    await expect(modal).toBeVisible()
    await expect(modal.getByLabel('Start time')).toHaveValue('14:00')
    await expect(toggle).toBeHidden()
    await expect(modal.getByRole('combobox', { name: 'Time zone' })).toHaveValue('Tokyo (JST)')
  })

  test('places the globe beside the end time on a narrow screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await seed(page)
    await page.goto('/week')
    await expect(page.locator('[data-component="header"]')).toBeVisible()
    await page.keyboard.press('c')

    const modal = page.locator('[data-component="modal-card"]')
    const toggle = modal.getByRole('button', { name: 'Time zone' })
    const picker = modal.getByRole('combobox', { name: 'Time zone' })
    await expect(toggle).toBeVisible()
    await expect(picker).toBeHidden()
    const position = await toggle.evaluate((button) => {
      const globe = button.getBoundingClientRect()
      const end = button
        .parentElement!.querySelector('[data-component="event-end-time"]')!
        .getBoundingClientRect()
      return { gap: globe.left - end.right, offset: globe.top - end.top, right: globe.right }
    })
    expect(position.gap).toBeGreaterThan(0)
    expect(position.offset).toBeCloseTo(0, 0)
    expect(position.right).toBeLessThanOrEqual(390)

    await toggle.click()
    await expect(picker).toBeVisible()
    await toggle.click()
    await expect(picker).toBeHidden()
    await modal.getByLabel('All day').check()
    await expect(toggle).toBeHidden()
    await expect(picker).toBeHidden()
  })

  test('keeps the dropdown clickable in a short event editor', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 510 })
    await seed(page)
    await page.goto('/week')
    await expect(page.locator('[data-component="header"]')).toBeVisible()
    await page.keyboard.press('c')

    const modal = page.locator('[data-component="modal-card"]')
    await modal.getByRole('button', { name: 'Time zone' }).click()
    const picker = modal.getByRole('combobox', { name: 'Time zone' })
    await picker.click()
    const list = page.getByRole('listbox', { name: 'Time zone' })
    await expect(list).toBeVisible()
    await expect
      .poll(() =>
        list.evaluate((menu) => {
          const { left, right, top, bottom } = menu.getBoundingClientRect()
          const center = (left + right) / 2
          return (
            menu.contains(document.elementFromPoint(center, top + 4)) &&
            menu.contains(document.elementFromPoint(center, bottom - 4))
          )
        })
      )
      .toBe(true)

    await picker.fill('tokyo')
    await list.getByRole('option', { name: /Tokyo/ }).click()
    await expect(picker).toHaveValue('Tokyo (JST)')
    await expect(list).toBeHidden()
  })

  test('keeps a recurring occurrence on its local date when renaming it', async ({ page }) => {
    await seed(page, [
      {
        id: 'tokyo-standup',
        title: 'Tokyo standup',
        calendarId: CALENDAR.id,
        type: 'event',
        start: '2026-07-09T07:00:00',
        end: '2026-07-09T07:30:00',
        timezone: 'Asia/Tokyo',
        recurrence: { frequency: 'daily', interval: 1, count: 2 },
      },
    ])
    await page.goto('/week')
    const cards = page.locator('[data-component="event-card"]', { hasText: 'Tokyo standup' })
    await expect(cards).toHaveCount(2)
    await cards.last().click()
    await page.getByRole('button', { name: 'Open event' }).click()

    const modal = page.locator('[data-component="modal-card"]')
    await expect(modal.getByLabel('Start time')).toHaveValue('07:00')
    await modal.getByPlaceholder('Event title').fill('Renamed Tokyo standup')
    await modal.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByRole('button', { name: 'This event only' }).click()

    await expect
      .poll(() => storedEvent(page, 'Renamed Tokyo standup'))
      .toMatchObject({
        start: '2026-07-10T07:00:00',
        end: '2026-07-10T07:30:00',
        timezone: 'Asia/Tokyo',
      })
    await expect(cards.filter({ hasNotText: 'Renamed' })).toHaveCount(1)
  })
})
