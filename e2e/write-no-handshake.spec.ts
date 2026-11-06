import { test, expect, type Page, type Request } from '@playwright/test'
import { clearState, seedAccount } from './fixtures/localstorage'

/**
 * Issue #257. Over a 200 ms link every save felt slow because each write built
 * a new CalDAV client: it walked the server's discovery chain (`/dav/`, the
 * principal, the calendar home), listed every calendar again, and only then
 * sent its PUT. Two quick edits queued those handshakes one behind the other.
 *
 * Once the account has synced, a save must go straight to its PUT.
 */

const COLLECTION = '/dav/calendars/user/write-handshake/'
const NOW = new Date('2026-11-03T10:00:00+01:00')

const ics = (uid: string, day: string, title: string): string =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTAMP:20261101T000000Z',
    `DTSTART:${day}T100000Z`,
    `DTEND:${day}T110000Z`,
    `SUMMARY:${title}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n')

/** Requests to the mock server, in order. */
function recordRequests(page: Page): string[] {
  const seen: string[] = []
  page.on('request', (request: Request) => {
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/mock-caldav/') || url.pathname.includes('__test__')) return
    seen.push(`${request.method()} ${url.pathname.replace('/mock-caldav', '')}`)
  })
  return seen
}

async function editTitle(page: Page, from: string, to: string): Promise<void> {
  await page.locator('[data-component="event-card"]').filter({ hasText: from }).first().click()
  await page
    .locator('[data-component="event-preview"]')
    .getByRole('button', { name: /Open event/i })
    .click()
  await page.locator('[data-component="event-title-input"]').fill(to)
  await page.locator('[data-component="modal-save"]').click()
}

test.describe('saving an event after the account has synced (#257)', () => {
  test('goes straight to the PUT, with no discovery in front of it', async ({ page, baseURL }) => {
    await clearState(page)
    await page.clock.setFixedTime(NOW)
    await page.request.post(
      `${baseURL}/mock-caldav/__test__/reset?prefix=${encodeURIComponent(COLLECTION)}`
    )
    for (const [uid, day, title] of [
      ['hs-a', '20261104', 'First event'],
      ['hs-b', '20261105', 'Second event'],
    ]) {
      await page.request.put(`${baseURL}/mock-caldav${COLLECTION}${uid}.ics`, {
        data: ics(uid, day, title),
      })
    }
    await seedAccount(page, {
      id: 'write-handshake-account',
      name: 'Mock',
      serverUrl: `${baseURL}/mock-caldav/dav/`,
      username: 'user',
      password: 'pass',
      calendars: [
        {
          id: 'cal-write-handshake',
          name: 'Write Handshake',
          path: 'calendars/user/write-handshake/',
          isDefault: true,
        },
      ],
    })

    const requests = recordRequests(page)
    await page.goto('/month')
    await expect(
      page.locator('[data-component="event-card"]').filter({ hasText: 'First event' }).first()
    ).toBeVisible({ timeout: 15_000 })

    // Let the initial sync finish: no request for a while.
    let quietSince = requests.length
    await expect
      .poll(
        async () => {
          await page.waitForTimeout(700)
          const quiet = requests.length === quietSince
          quietSince = requests.length
          return quiet
        },
        { timeout: 20_000 }
      )
      .toBe(true)

    // Two edits back to back, as in the report.
    const before = requests.length
    await editTitle(page, 'First event', 'First event edited')
    await expect
      .poll(() => requests.slice(before).filter((r) => r.startsWith('PUT ')).length)
      .toBe(1)
    const mid = requests.length
    await editTitle(page, 'Second event', 'Second event edited')
    await expect
      .poll(() => requests.slice(before).filter((r) => r.startsWith('PUT ')).length)
      .toBe(2)

    const made = requests.slice(before)
    expect(made.filter((r) => r.startsWith('PUT '))).toEqual([
      `PUT ${COLLECTION}hs-a.ics`,
      `PUT ${COLLECTION}hs-b.ics`,
    ])
    // The handshake is what these two saves used to repeat each time.
    expect(made.filter((r) => r.startsWith('PROPFIND '))).toEqual([])
    expect(requests.slice(mid).filter((r) => r.startsWith('PROPFIND '))).toEqual([])

    // And the server really has both edits.
    const dump = await page.request.get(
      `${baseURL}/mock-caldav/__test__/dump?prefix=${encodeURIComponent(COLLECTION)}`
    )
    const stored = Object.values((await dump.json()) as Record<string, string>).join('\n')
    expect(stored).toContain('SUMMARY:First event edited')
    expect(stored).toContain('SUMMARY:Second event edited')
  })
})
