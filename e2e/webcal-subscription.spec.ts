/**
 * Webcal (.ics URL) subscription flow.
 *
 * Subscribing fetches the URL once via fetchWebcalIcs (plain GET, no proxy
 * in this test), parses it with the same ICS parser CalDAV uses, and adds
 * a read-only calendar populated with the parsed events. Read-only means
 * the event card can't be dragged/resized and the event modal hides
 * save/delete for events in that calendar.
 */
import { test, expect } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

const ICS_URL = 'https://example.com/test-calendar.ics'

// Use "today" so the event lands in the month view's default range without
// needing date-specific navigation (Calino's URL routes don't carry a date).
const today = new Date()
const y = today.getUTCFullYear()
const m = String(today.getUTCMonth() + 1).padStart(2, '0')
const d = String(today.getUTCDate()).padStart(2, '0')

const ICS_FIXTURE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Test//EN',
  'BEGIN:VEVENT',
  'UID:webcal-test-event-1@example.com',
  'DTSTAMP:20260101T000000Z',
  `DTSTART:${y}${m}${d}T090000Z`,
  `DTEND:${y}${m}${d}T100000Z`,
  'SUMMARY:Webcal Test Event',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:Reminder',
  'TRIGGER:-PT10M',
  'END:VALARM',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n')

async function subscribeTestFeed(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Add calendar' }).click()
  await page.getByText('Subscribe to Calendar (.ics)').click()

  const dialog = page.getByRole('dialog', { name: 'Subscribe to Calendar' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Name (optional)').fill('Test Feed')
  await dialog.getByRole('textbox', { name: 'Calendar URL' }).fill(ICS_URL)
  await expect(dialog.getByRole('textbox', { name: 'Calendar URL' })).toHaveValue(ICS_URL)
  await dialog.getByRole('button', { name: 'Subscribe' }).click()
  await expect(dialog).not.toBeVisible()
}

test.describe('Webcal calendar subscription', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await page.route('**/test-calendar.ics', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/calendar', body: ICS_FIXTURE })
    })
  })

  test("subscribing adds a read-only calendar with the feed's events", async ({ page }) => {
    await page.goto('/')
    await subscribeTestFeed(page)

    // Today's month view is already showing (default), and the fixture
    // event is dated today, so it's in the visible range without navigation.
    const eventCard = page.locator('[data-component="event-card"]', {
      hasText: 'Webcal Test Event',
    })
    await expect(eventCard).toBeVisible()

    // Read-only: dragging is disabled via data-no-drag on the card.
    await expect(eventCard).toHaveAttribute('data-no-drag', '')

    // Click opens the hover preview; "Open event" opens the full edit modal.
    await eventCard.click()
    await page.getByRole('button', { name: 'Open event' }).click()
    await expect(page.locator('[data-component="readonly-calendar-notice"]')).toBeVisible()
    await expect(page.locator('[data-component="modal-save"]')).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Delete' })).not.toBeVisible()

    await page.locator('[data-component="event-advanced-toggle"]').click()
    await expect(page.locator('[data-component="reminders-muted-notice"]')).toBeVisible()
    await expect(page.getByRole('button', { name: /add reminder/i })).toHaveCount(0)
  })

  test('settings can edit a subscription and mute is on by default', async ({ page }) => {
    await page.goto('/')
    await subscribeTestFeed(page)

    await page.goto('/settings?tab=caldav')
    const row = page.locator('[data-component="subscription-row"]', { hasText: 'Test Feed' })
    await expect(row).toBeVisible()
    await row.locator('[data-action="edit-subscription"]').click()

    const dialog = page.getByRole('dialog', { name: 'Edit subscription' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('checkbox', { name: /mute reminders/i })).toBeChecked()
    await dialog.getByLabel('Name (optional)').fill('School overlay')
    await dialog.locator('[data-component="modal-save"]').click()
    await expect(dialog).not.toBeVisible()
    await expect(
      page.locator('[data-component="subscription-row"]', { hasText: 'School overlay' })
    ).toBeVisible()
  })
})
