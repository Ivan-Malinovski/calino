import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

const ICS_URL = 'https://example.com/deadlines.ics'

// Floating local times on today, so the events land in today's column
// whatever the browser's zone.
const today = new Date()
const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(
  today.getDate()
).padStart(2, '0')}`

// RFC 5545 §3.6.1: a timed VEVENT with only DTSTART ends when it starts.
// Also cover feeds that explicitly repeat the start time in DTEND.
const deadline = (uid: string, summary: string, time: string, endTime?: string): string[] => [
  'BEGIN:VEVENT',
  `UID:${uid}`,
  'DTSTAMP:20260101T000000Z',
  `DTSTART:${ymd}T${time}`,
  ...(endTime ? [`DTEND:${ymd}T${endTime}`] : []),
  `SUMMARY:${summary}`,
  'END:VEVENT',
]

const ICS_FIXTURE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Test//EN',
  ...deadline('deadline-1@example.com', 'Deadline one', '235900'),
  ...deadline('deadline-2@example.com', 'Deadline two', '235900', '235900'),
  ...deadline('deadline-3@example.com', 'Deadline noon', '120000'),
  'END:VCALENDAR',
  '',
].join('\r\n')

async function subscribe(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Add calendar' }).click()
  await page.getByText('Subscribe to Calendar (.ics)').click()
  const dialog = page.getByRole('dialog', { name: 'Subscribe to Calendar' })
  await dialog.getByRole('textbox', { name: 'Calendar URL' }).fill(ICS_URL)
  await dialog.getByRole('button', { name: 'Subscribe' }).click()
  await expect(dialog).not.toBeVisible()
}

/** Bottom edge of the nearest scrolling ancestor, the visible end of the day. */
async function scrollerBottom(page: Page, name: string): Promise<number> {
  return page
    .locator('[data-component="event-card"]', { hasText: name })
    .first()
    .evaluate((el) => {
      let node = el.parentElement
      while (node && node.scrollHeight <= node.clientHeight) node = node.parentElement
      return node ? node.getBoundingClientRect().bottom : Infinity
    })
}

test.describe('Zero-duration events on the timeline', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await page.route('**/deadlines.ics', (route) =>
      route.fulfill({ status: 200, contentType: 'text/calendar', body: ICS_FIXTURE })
    )
    await page.goto('/')
    await subscribe(page)
  })

  for (const view of ['week', 'day']) {
    test(`${view} view draws deadlines as readable pills inside the day`, async ({ page }) => {
      await page.goto(`/${view}`)
      const card = (name: string) =>
        page.locator('[data-component="event-card"]', { hasText: name }).first()

      const noon = card('Deadline noon')
      await noon.scrollIntoViewIfNeeded()
      expect((await noon.boundingBox())?.height).toBeGreaterThan(15)

      const one = card('Deadline one')
      await one.scrollIntoViewIfNeeded()
      const oneBox = await one.boundingBox()
      const twoBox = await card('Deadline two').boundingBox()
      if (!oneBox || !twoBox) throw new Error('deadline cards are not rendered')

      expect(oneBox.height).toBeGreaterThan(15)
      expect(twoBox.height).toBeGreaterThan(15)
      // Same time, separate columns.
      expect(Math.abs(oneBox.x - twoBox.x)).toBeGreaterThan(10)
      // 23:59 ends above the bottom of the grid rather than past it.
      const bottom = await scrollerBottom(page, 'Deadline one')
      expect(oneBox.y + oneBox.height).toBeLessThanOrEqual(bottom)
      expect(twoBox.y + twoBox.height).toBeLessThanOrEqual(bottom)
    })
  }
})
