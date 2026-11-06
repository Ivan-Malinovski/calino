import { writeFileSync } from 'node:fs'
import { test, type Page } from '@playwright/test'
import { clearState, seedAccount } from './fixtures/localstorage'

// THROWAWAY profiling harness for issue #257 — not committed.
const COLLECTION = '/dav/calendars/user/due-only/'
const LATENCY = Number(process.env.LAT ?? 200)
const NOW = new Date('2026-11-03T10:00:00+01:00')
test.use({ timezoneId: 'Europe/Paris' })

const ev = (uid: string, day: string, title: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:20261101T000000Z\r\nDTSTART:${day}T100000Z\r\nDTEND:${day}T110000Z\r\nSUMMARY:${title}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`
const todo = (uid: string, title: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:${uid}\r\nDTSTAMP:20261101T000000Z\r\nSUMMARY:${title}\r\nDUE:20261104T120000Z\r\nSTATUS:NEEDS-ACTION\r\nEND:VTODO\r\nEND:VCALENDAR\r\n`

let t0 = 0
const log: string[] = []
const now = () => Math.round(performance.now() - t0)
const mark = (s: string) => log.push(`${String(now()).padStart(6)}ms  ${s}`)

async function setup(page: Page, baseURL: string) {
  await clearState(page)
  await page.clock.setFixedTime(NOW)
  await page.request.post(`${baseURL}/mock-caldav/__test__/reset?prefix=${encodeURIComponent(COLLECTION)}`)
  const put = (n: string, d: string) =>
    page.request.put(`${baseURL}/mock-caldav${COLLECTION}${n}.ics`, { data: d })
  await put('a', ev('a', '20261104', 'Alpha'))
  await put('b', ev('b', '20261105', 'Bravo'))
  await put('c', ev('c', '20261106', 'Charlie'))
  await put('t', todo('t', 'Todo one'))
  await seedAccount(page, {
    id: 'lat-acc', name: 'Mock', serverUrl: `${baseURL}/mock-caldav/dav/`, username: 'user', password: 'pass',
    calendars: [{ id: 'lat-cal', name: 'Due Only', path: 'calendars/user/due-only/', isDefault: true }],
  })
  await page.route('**/mock-caldav/**', async (route) => {
    const req = route.request()
    if (req.url().includes('__test__')) return route.continue()
    const u = new URL(req.url()).pathname.replace('/mock-caldav', '')
    const started = now()
    mark(`→ ${req.method()} ${u}`)
    await new Promise((r) => setTimeout(r, LATENCY))
    await route.continue()
    void route.request().response().then(() => mark(`← ${req.method()} ${u} (sent ${started}ms)`)).catch(() => {})
  })
}

async function openEdit(page: Page, title: string) {
  await page.locator('[data-component="event-card"]').filter({ hasText: title }).first().click()
  await page.locator('[data-component="event-preview"]').getByRole('button', { name: /Open event/i }).click()
  await page.locator('[data-component="event-title-input"]').waitFor()
}

test('profile @ latency', async ({ page, baseURL }) => {
  test.setTimeout(120_000)
  await setup(page, baseURL!)
  t0 = performance.now()
  mark(`=== latency per request: ${LATENCY}ms ===`)
  await page.goto('/month')
  const card = (t: string) => page.locator('[data-component="event-card"]').filter({ hasText: t }).first()
  await card('Alpha').waitFor({ timeout: 30_000 })
  mark('first event rendered (cached? no: initial load)')
  await page.locator('[data-component="sync-all-calendars"]').click()
  await page.waitForTimeout(3000)
  mark('--- idle after sync ---')

  // 1. edit + save two events back to back
  let s = now()
  await openEdit(page, 'Alpha'); mark(`modal A open after ${now() - s}ms`)
  await page.locator('[data-component="event-title-input"]').fill('Alpha 2')
  s = now(); mark('CLICK save A')
  await page.locator('[data-component="modal-save"]').click()
  await page.locator('[data-component="modal-save"]').waitFor({ state: 'hidden' })
  mark(`modal A closed after ${now() - s}ms`)
  await card('Alpha 2').waitFor(); mark(`card shows new title after ${now() - s}ms`)
  s = now()
  await openEdit(page, 'Bravo'); mark(`modal B open after ${now() - s}ms (immediately after save A)`)
  await page.locator('[data-component="event-title-input"]').fill('Bravo 2')
  s = now(); mark('CLICK save B')
  await page.locator('[data-component="modal-save"]').click()
  await page.locator('[data-component="modal-save"]').waitFor({ state: 'hidden' })
  mark(`modal B closed after ${now() - s}ms`)
  await page.waitForTimeout(4000)
  mark('--- idle ---')

  // 2. drag Charlie to the next day
  const from = (await card('Charlie').boundingBox())!
  const cells = page.locator('[data-component="calendar-grid"] [data-date="2026-11-10"]')
  const to = (await cells.first().boundingBox().catch(() => null)) ?? { x: from.x + 140, y: from.y, width: 20, height: 20 }
  s = now(); mark('DRAG start')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + 20, from.y + 10, { steps: 4 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
  await page.mouse.up(); mark(`DRAG released (${now() - s}ms incl. mouse moves)`)
  await page.waitForTimeout(4000)
  mark('--- idle ---')

  // 3. complete a task
  await page.goto('/tasks')
  const row = page.locator('[data-component="task-row"]').filter({ hasText: 'Todo one' }).first()
  await row.waitFor({ timeout: 30_000 })
  await page.waitForTimeout(2500)
  mark('--- tasks view ready ---')
  s = now(); mark('CLICK complete task')
  await row.getByLabel('Mark as complete').click()
  await row.getByLabel(/Mark as (incomplete|not complete)|Reopen/i).waitFor({ timeout: 10_000 }).catch(() => mark('(no reopen label found)'))
  mark(`task UI flipped after ${now() - s}ms`)
  await page.waitForTimeout(4000)
  mark('--- end ---')
  writeFileSync(process.env.OUT ?? '/dev/null', log.join('\n'))
})
