import { test, expect } from '@playwright/test'
import { clearState, seedAccount } from './fixtures/localstorage'

/**
 * Issue #205: Nextcloud stores a per-event color as an RFC 7986 `COLOR`
 * property holding a CSS3 color name. Calino ignored it, so events took their
 * category or calendar color instead of the one chosen in the other client.
 */

const COLLECTION = '/dav/calendars/user/ev-color/'

function resource(uid: string, summary: string, day: string, extra: string[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Nextcloud calendar v5//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART:${day}T120000Z`,
    `DTEND:${day}T130000Z`,
    `SUMMARY:${summary}`,
    ...extra,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n')
}

test.describe('per-event COLOR from the server', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await page.request.post(
      `${baseURL!}/mock-caldav/__test__/reset?prefix=${encodeURIComponent(COLLECTION)}`
    )
  })

  test('shows the server color and keeps it through an edit', async ({ page, baseURL }) => {
    await clearState(page)
    await seedAccount(page, {
      id: 'event-color-account',
      name: 'Mock Nextcloud',
      serverUrl: `${baseURL}/mock-caldav/dav/`,
      username: 'user',
      password: 'pass',
      calendars: [
        {
          name: 'Event Color',
          path: 'calendars/user/ev-color/',
          isDefault: true,
          color: '#0F9D58',
        },
      ],
    })

    const day = new Date().toISOString().slice(0, 10).replaceAll('-', '')
    const calendarUrl = `${baseURL}/mock-caldav/dav/calendars/user/ev-color/`
    await page.request.put(`${calendarUrl}named.ics`, {
      data: resource('color-named', 'Named color event', day, ['COLOR:dodgerblue']),
    })
    await page.request.put(`${calendarUrl}plain.ics`, {
      data: resource('color-plain', 'Uncolored event', day, []),
    })

    await page.goto('/month')
    await page.locator('[data-component="sync-all-calendars"]').click()

    const colorOf = async (title: string) =>
      page
        .locator('[data-component="event-card"]')
        .filter({ hasText: title })
        .first()
        .evaluate((el) => getComputedStyle(el).getPropertyValue('--event-color').trim())

    const named = page
      .locator('[data-component="event-card"]')
      .filter({ hasText: 'Named color event' })
      .first()
    await expect(named).toBeVisible({ timeout: 15_000 })

    // dodgerblue, not the calendar's green.
    await expect.poll(() => colorOf('Named color event')).toBe('#1e90ff')
    // No COLOR property: still the calendar color.
    await expect(
      page.locator('[data-component="event-card"]').filter({ hasText: 'Uncolored event' }).first()
    ).toBeVisible()
    await expect.poll(() => colorOf('Uncolored event')).toBe('#0F9D58')

    // Editing the event must not drop the property for other clients.
    await named.click()
    await page
      .locator('[data-component="event-preview"]')
      .getByRole('button', { name: /Open event/i })
      .click()
    await page.locator('[data-component="event-title-input"]').fill('Renamed colored event')
    await page.locator('[data-component="modal-save"]').click()

    await expect
      .poll(
        async () => {
          const r = await page.request.get(
            `${baseURL}/mock-caldav/__test__/dump?prefix=${encodeURIComponent(COLLECTION)}`
          )
          return Object.values((await r.json()) as Record<string, string>).join('\n')
        },
        { timeout: 15_000 }
      )
      .toContain('SUMMARY:Renamed colored event')

    const r = await page.request.get(
      `${baseURL}/mock-caldav/__test__/dump?prefix=${encodeURIComponent(COLLECTION)}`
    )
    const stored = Object.values((await r.json()) as Record<string, string>).join('\n')
    expect(stored).toContain('COLOR:dodgerblue')
  })
})
