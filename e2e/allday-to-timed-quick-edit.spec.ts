/**
 * Issue #190 — editing the time of an all-day event in the quick preview
 * popup left the event flagged all-day. The new time was written into an
 * event that still rendered as "All day" until the user opened the full
 * modal and unticked the checkbox.
 */
import { test, expect, type Page } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

const CALENDAR = {
  id: 'default',
  name: 'Default',
  color: '#EA4335',
  isVisible: true,
  isDefault: true,
  showTasksInViews: true,
  supportedComponents: ['VEVENT', 'VTODO', 'VJOURNAL'],
}

function localDate(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

async function seedAllDayEvent(page: Page): Promise<void> {
  const date = localDate()
  await page.addInitScript(
    ({ calendarKey, calendars, event }) => {
      try {
        if (sessionStorage.getItem('__calino_test_allday_quick_edit')) return
        sessionStorage.setItem('__calino_test_allday_quick_edit', '1')
        const raw = localStorage.getItem(calendarKey)
        const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
        parsed.state = { ...(parsed.state ?? {}), calendars, events: [event] }
        localStorage.setItem(calendarKey, JSON.stringify(parsed))
      } catch {
        /* noop */
      }
    },
    {
      calendarKey: 'calino-storage',
      calendars: [CALENDAR],
      event: {
        id: 'allday-quick-edit',
        uid: 'allday-quick-edit',
        type: 'event',
        calendarId: 'default',
        title: 'Dentist',
        start: `${date}T00:00:00`,
        end: `${date}T23:59:59`,
        isAllDay: true,
      },
    }
  )
}

test.describe('All-day event → timed via the quick preview (#190)', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await seedAllDayEvent(page)
  })

  test('setting a start and end time makes the event timed', async ({ page }) => {
    await page.goto('/week')
    const allDayCard = page
      .locator('[data-component="event-card"]')
      .filter({ hasText: 'Dentist' })
      .first()
    await expect(allDayCard).toBeVisible({ timeout: 10_000 })
    await allDayCard.click()

    const preview = page.locator('[data-component="event-preview"]')
    await expect(preview).toBeVisible()
    await preview.getByText('All day', { exact: true }).click()

    await page.getByLabel('Start time').fill('14:00')
    await page.getByLabel('Start time').press('Tab')
    await page.getByLabel('End time').fill('15:30')
    await page.getByLabel('End time').press('Tab')

    await preview.getByRole('button', { name: 'Save changes' }).click()

    // The popup now describes a timed event, not an all-day one.
    await expect(preview).toContainText('14:00')
    await expect(preview).toContainText('15:30')
    await expect(preview.getByText('All day', { exact: true })).toHaveCount(0)

    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('calino-storage')
      const events = raw ? (JSON.parse(raw).state?.events ?? []) : []
      return events.find((e: { id: string }) => e.id === 'allday-quick-edit')
    })
    expect(stored.isAllDay).toBe(false)
    expect(stored.start).toContain('T')
    expect(new Date(stored.end).getTime() - new Date(stored.start).getTime()).toBe(90 * 60_000)
  })

  test('pressing Enter in the time field saves the new time', async ({ page }) => {
    await page.goto('/week')
    const allDayCard = page
      .locator('[data-component="event-card"]')
      .filter({ hasText: 'Dentist' })
      .first()
    await expect(allDayCard).toBeVisible({ timeout: 10_000 })
    await allDayCard.click()

    const preview = page.locator('[data-component="event-preview"]')
    await expect(preview).toBeVisible()
    await preview.getByText('All day', { exact: true }).click()

    await page.getByLabel('Start time').fill('14:00')
    await page.getByLabel('Start time').press('Enter')

    await expect(preview).toContainText('14:00')
    await expect(preview.getByText('All day', { exact: true })).toHaveCount(0)
  })
})
