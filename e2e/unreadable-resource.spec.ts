import { test, expect } from '@playwright/test'
import { clearState, seedAccount } from './fixtures/localstorage'

/**
 * A resource the server returns but Calino cannot parse (#228). The rest of the
 * calendar must still sync, and the user is told once that something was left
 * as it is instead of the problem living only in the console.
 */

const COLLECTION = '/dav/calendars/user/unreadable/'

function event(uid: string, summary: string): string {
  const start = new Date()
  start.setUTCDate(start.getUTCDate() + 1)
  const day = start.toISOString().slice(0, 10).replaceAll('-', '')
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Other Client//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTAMP:20260101T000000Z',
    `DTSTART:${day}T100000Z`,
    `DTEND:${day}T110000Z`,
    `SUMMARY:${summary}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n')
}

test('an unreadable resource is reported once and does not block the rest', async ({
  page,
  baseURL,
}) => {
  await page.request.post(
    `${baseURL!}/mock-caldav/__test__/reset?prefix=${encodeURIComponent(COLLECTION)}`
  )
  await clearState(page)
  await seedAccount(page, {
    id: 'unreadable-account',
    name: 'Mock Radicale',
    serverUrl: `${baseURL}/mock-caldav/dav/`,
    username: 'user',
    password: 'pass',
    calendars: [{ name: 'Unreadable', path: 'calendars/user/unreadable/', isDefault: true }],
  })
  const base = `${baseURL}/mock-caldav/dav/calendars/user/unreadable`
  await page.request.put(`${base}/good.ics`, { data: event('good-event', 'Readable event') })
  await page.request.put(`${base}/broken.ics`, { data: 'this is not an iCalendar document' })

  await page.goto('/month')
  await page.locator('[data-component="sync-all-calendars"]').click()

  await expect(
    page.locator('[data-component="event-card"]').filter({ hasText: 'Readable event' }).first()
  ).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/could not be read and (was|were) left as/i)).toBeVisible({
    timeout: 10_000,
  })
})
