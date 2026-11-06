import { test, expect, type Page } from '@playwright/test'
import { clearState, seedAccount } from './fixtures/localstorage'

/**
 * Dragging an all-day event to another day must write that day.
 *
 * The drop used to rebuild the start as local midnight and send it as
 * `toISOString()`; the all-day serializer then keeps the date part of that UTC
 * string. East of UTC, local midnight is still the previous day in UTC, so the
 * event was written back on its original day (and a two-day drag moved it by
 * one). The browser runs in Paris for that reason, and the assertions are on
 * the mock server's stored bytes, not on what the card shows.
 */

test.use({ timezoneId: 'Europe/Paris' })

const COLLECTION = '/dav/calendars/user/allday-drag/'
const CAL_ID = 'cal-allday-drag'
// A Tuesday; the drag goes to Wednesday 11 November, same week row.
const NOW = new Date('2026-11-03T10:00:00+01:00')

async function dump(page: Page, baseURL: string): Promise<Record<string, string> | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await page.request.get(
        `${baseURL}/mock-caldav/__test__/dump?prefix=${encodeURIComponent(COLLECTION)}`
      )
      return (await response.json()) as Record<string, string>
    } catch {
      if (attempt === 2) return null
      await page.waitForTimeout(250)
    }
  }
  return null
}

const stored = async (page: Page, baseURL: string, uid: string): Promise<string> =>
  Object.values((await dump(page, baseURL)) ?? {}).find((ics) => ics.includes(`UID:${uid}`)) ?? ''

async function seed(page: Page, baseURL: string, uid: string, start: string, end: string) {
  await clearState(page)
  await page.clock.setFixedTime(NOW)
  await page.request.post(
    `${baseURL}/mock-caldav/__test__/reset?prefix=${encodeURIComponent(COLLECTION)}`
  )
  await page.request.put(`${baseURL}/mock-caldav${COLLECTION}${uid}.ics`, {
    data:
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\n' +
      `UID:${uid}\r\nDTSTART;VALUE=DATE:${start}\r\nDTEND;VALUE=DATE:${end}\r\n` +
      'SUMMARY:Training day\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
  })
  await seedAccount(page, {
    id: 'allday-drag-account',
    name: 'Mock',
    serverUrl: `${baseURL}/mock-caldav/dav/`,
    username: 'user',
    password: 'pass',
    calendars: [
      {
        id: CAL_ID,
        name: 'All-day Drag',
        path: 'calendars/user/allday-drag/',
        isDefault: true,
        color: '#16A34A',
        supportedComponents: ['VEVENT', 'VTODO', 'VJOURNAL'],
      },
    ],
  })
  await page.goto('/month')
}

async function dragTo(page: Page, targetDate: string): Promise<void> {
  const card = page.locator('[data-component="event-card"]').filter({ hasText: 'Training day' })
  await expect(card.first()).toBeVisible({ timeout: 15_000 })
  const from = (await card.first().boundingBox())!
  const to = (await page.locator(`[data-date="${targetDate}"]`).first().boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 6, { steps: 4 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
  await page.mouse.up()
}

test.describe('dragging an all-day event in the month view', () => {
  test.describe.configure({ mode: 'serial' })

  test('a one-day event dropped on the next day is written on that day', async ({
    page,
    baseURL,
  }) => {
    await seed(page, baseURL!, 'allday-one', '20261110', '20261111')
    await dragTo(page, '2026-11-11')
    await expect
      .poll(() => stored(page, baseURL!, 'allday-one'), { timeout: 15_000 })
      .toContain('DTSTART;VALUE=DATE:20261111')
    expect(await stored(page, baseURL!, 'allday-one')).toContain('DTEND;VALUE=DATE:20261112')
  })

  test('a three-day event keeps its length when dropped two days later', async ({
    page,
    baseURL,
  }) => {
    await seed(page, baseURL!, 'allday-three', '20261110', '20261113')
    // Grabbed by its first day (the card on the 10th).
    await dragTo(page, '2026-11-12')
    await expect
      .poll(() => stored(page, baseURL!, 'allday-three'), { timeout: 15_000 })
      .toContain('DTSTART;VALUE=DATE:20261112')
    expect(await stored(page, baseURL!, 'allday-three')).toContain('DTEND;VALUE=DATE:20261115')
  })
})
