import { test, expect, type Page } from '@playwright/test'
import { clearState, seedAccount } from './fixtures/localstorage'

/**
 * A comma inside an iCalendar TEXT value is escaped (RFC 5545 §3.3.11), and
 * in CATEGORIES, a list, only an unescaped comma separates two values: the
 * category "R, D" is written `CATEGORIES:R\, D`. ical.js already splits and
 * unescapes the list; Calino split each value again on commas, so "R, D"
 * became the two categories "R" and "D", and a save wrote them back that way.
 */

const COLLECTION = '/dav/calendars/user/text-esc/'

function resource(day: string): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Other Client//Their Product//EN',
    'BEGIN:VEVENT',
    'UID:text-escaping-uid',
    `DTSTART:${day}T120000Z`,
    `DTEND:${day}T130000Z`,
    'SUMMARY:Lunch\\, then review',
    'DESCRIPTION:Agenda:\\n1. Budget\\, Q3\\n2. Files in C:\\\\new',
    'LOCATION:Room 1\\, Building A',
    'CATEGORIES:R\\, D,Work',
    'ATTENDEE;CN="Martin, Jean";PARTSTAT=ACCEPTED:mailto:jean@example.com',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n')
}

async function stored(page: Page, baseURL: string): Promise<string> {
  const r = await page.request.get(
    `${baseURL}/mock-caldav/__test__/dump?prefix=${encodeURIComponent(COLLECTION)}`
  )
  return Object.values((await r.json()) as Record<string, string>).join('\n')
}

test.describe('iCalendar text escaping', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await page.request.post(
      `${baseURL!}/mock-caldav/__test__/reset?prefix=${encodeURIComponent(COLLECTION)}`
    )
  })

  test('keeps a category with a comma as one category through an edit', async ({
    page,
    baseURL,
  }) => {
    await clearState(page)
    await seedAccount(page, {
      id: 'text-escaping-account',
      name: 'Mock CalDAV',
      serverUrl: `${baseURL}/mock-caldav/dav/`,
      username: 'user',
      password: 'pass',
      calendars: [{ name: 'Text Escaping', path: 'calendars/user/text-esc/', isDefault: true }],
    })

    const day = new Date().toISOString().slice(0, 10).replaceAll('-', '')
    await page.request.put(`${baseURL}/mock-caldav${COLLECTION}text-escaping.ics`, {
      data: resource(day),
    })

    await page.goto('/month')
    await page.locator('[data-component="sync-all-calendars"]').click()

    const card = page
      .locator('[data-component="event-card"]')
      .filter({ hasText: 'Lunch, then review' })
      .first()
    await expect(card).toBeVisible({ timeout: 15_000 })
    const categories = () =>
      page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem('calino-storage') ?? '{}').state
        const event = (state?.events ?? []).find(
          (e: { uid?: string }) => e.uid === 'text-escaping-uid'
        )
        return event?.categories ?? null
      })
    await expect.poll(categories).toEqual(['R, D', 'Work'])

    await card.click()
    await page
      .locator('[data-component="event-preview"]')
      .getByRole('button', { name: /Open event/i })
      .click()
    await page.locator('[data-component="event-title-input"]').fill('Lunch, then demo')
    await page.locator('[data-component="modal-save"]').click()

    await expect
      .poll(() => stored(page, baseURL!), { timeout: 15_000 })
      .toContain('SUMMARY:Lunch\\, then demo')
    const ics = await stored(page, baseURL!)
    expect(ics).toContain('CATEGORIES:R\\, D,Work')
    expect(ics).toContain('LOCATION:Room 1\\, Building A')
    expect(ics).toContain('DESCRIPTION:Agenda:\\n1. Budget\\, Q3\\n2. Files in C:\\\\new')
    expect(ics).toContain('ATTENDEE;CN="Martin, Jean";PARTSTAT=ACCEPTED:mailto:jean@example.com')
  })
})
