import { test, expect, type Page } from '@playwright/test'
import { clearState, seedAccount } from './fixtures/localstorage'

/**
 * Issue #256. Tasks.org (via DAVx5) writes a recurring task with a `DUE;TZID`
 * and no DTSTART. Ticking an occurrence off makes Calino add a DTSTART to the
 * master as the recurrence anchor. It wrote that DTSTART floating, which a
 * server reads as UTC: after the DUE for a zone east of UTC, so sabre/vobject
 * (Nextcloud, Davis, Baikal) answered 415 "DUE must occur after DTSTART" and
 * the task stayed open on the server.
 *
 * The spec asserts on the bytes the mock CalDAV server stores.
 */

const COLLECTION = '/dav/calendars/user/due-only/'

// Browser zone matches the TZID below, as for the reporter.
test.use({ timezoneId: 'Europe/Brussels' })

const RESOURCE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:DAVx5/4.5.21-ose ical4j/4.3.0 (org.tasks)',
  'BEGIN:VTODO',
  'DTSTAMP:20261105T124417Z',
  'UID:due-only-uid',
  'SUMMARY:Water the plants',
  'DUE;TZID=Europe/Brussels:20261105T134501',
  'STATUS:NEEDS-ACTION',
  'RRULE:FREQ=DAILY;INTERVAL=1',
  'END:VTODO',
  'END:VCALENDAR',
  '',
].join('\r\n')

async function stored(page: Page, baseURL: string): Promise<string> {
  const r = await page.request.get(
    `${baseURL}/mock-caldav/__test__/dump?prefix=${encodeURIComponent(COLLECTION)}`
  )
  return Object.values((await r.json()) as Record<string, string>).join('\n')
}

test.describe('recurring task with only DUE;TZID', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await page.request.post(
      `${baseURL!}/mock-caldav/__test__/reset?prefix=${encodeURIComponent(COLLECTION)}`
    )
  })

  test('completing an occurrence writes DTSTART with the zone of DUE', async ({
    page,
    baseURL,
  }) => {
    await clearState(page)
    await seedAccount(page, {
      id: 'due-only-account',
      name: 'Mock CalDAV',
      serverUrl: `${baseURL}/mock-caldav/dav/`,
      username: 'user',
      password: 'pass',
      calendars: [{ name: 'Due Only', path: 'calendars/user/due-only/', isDefault: true }],
    })
    await page.request.put(`${baseURL}/mock-caldav${COLLECTION}due-only.ics`, { data: RESOURCE })

    await page.goto('/tasks')
    await page.locator('[data-component="sync-all-calendars"]').click()

    const row = page
      .locator('[data-component="task-row"]')
      .filter({ hasText: 'Water the plants' })
      .first()
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.getByLabel('Mark as complete').click()

    // The master gains a DTSTART as the recurrence anchor, in DUE's zone.
    await expect.poll(() => stored(page, baseURL!), { timeout: 15_000 }).toContain('RECURRENCE-ID')
    const ics = (await stored(page, baseURL!)).replace(/\r\n[ \t]/g, '')
    expect(ics).toContain('DUE;TZID=Europe/Brussels:20261105T134501')
    expect(ics).toContain('DTSTART;TZID=Europe/Brussels:20261105T134501')
    expect(ics).not.toMatch(/^DTSTART:20261105T134501$/m)
  })
})
