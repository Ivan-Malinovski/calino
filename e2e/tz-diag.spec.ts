import { test, expect, type Page } from '@playwright/test'
import { clearState, seedAccount } from './fixtures/localstorage'
const FIXED_INSTANT = new Date('2026-02-10T12:00:00Z')
const COLLECTION = '/dav/calendars/user/tz-correct/'
test.use({ timezoneId: 'America/New_York' })
async function seedStore(page: Page, events: Record<string, unknown>[]): Promise<void> {
  await page.addInitScript(({ calendarKey, events, calendars }) => {
    try {
      if (sessionStorage.getItem('__calino_diag')) return
      sessionStorage.setItem('__calino_diag', '1')
      const raw = localStorage.getItem(calendarKey)
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
      parsed.state = { ...(parsed.state ?? {}), calendars, events }
      localStorage.setItem(calendarKey, JSON.stringify(parsed))
    } catch { /* noop */ }
  }, {
    calendarKey: 'calino-storage',
    calendars: [{ id: 'tzc', name: 'Timezone', isVisible: true, isDefault: true, showTasksInViews: true, supportedComponents: ['VEVENT'] }],
    events,
  })
}
const singleEvent = {
  id: 'tz-single', uid: 'tz-single', type: 'event', calendarId: 'tzc',
  title: 'Copenhagen Standup', start: '2026-02-10T10:00:00', end: '2026-02-10T11:00:00',
  isAllDay: false, timezone: 'Europe/Copenhagen',
}
const card = (page: Page) => page.locator('[data-component="event-card"]', { hasText: 'Copenhagen Standup' }).first()
test('diag drag', async ({ page, baseURL }) => {
  await clearState(page)
  await page.clock.setFixedTime(FIXED_INSTANT)
  await seedAccount(page, {
    id: 'tz-account', name: 'Mock',
    serverUrl: `${baseURL}/mock-caldav/dav/`,
    username: 'user', password: 'pass',
    calendars: [{ id: 'tzc', name: 'Timezone', path: 'calendars/user/tz-correct/', isDefault: true }],
  })
  await seedStore(page, [singleEvent])
  await page.goto('/week')
  await expect(card(page)).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(3000)
  const before = await page.evaluate(() => {
    const raw = localStorage.getItem('calino-storage')
    return raw ? raw.slice(0, 600) : 'NO KEY'
  })
  console.log('BEFORE drag store start:', before)
  const box = await card(page).boundingBox()
  console.log('CARD box:', JSON.stringify(box))
  if (!box) throw new Error('no box')
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.waitForTimeout(30)
  await page.mouse.down()
  for (let i = 1; i <= 5; i++) { await page.mouse.move(x + i * 3, y, { steps: 1 }); await page.waitForTimeout(15) }
  await page.mouse.move(x, y + 120, { steps: 20 })
  await page.waitForTimeout(50)
  await page.mouse.up()
  await page.waitForTimeout(3000)
  const after = await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('calino-storage') ?? '{}')
    const ev = (p.state?.events ?? []).find((e: any) => e.id === 'tz-single')
    return ev ? ev.start + ' | href=' + ev.resourceHref + ' | status=' + ev.syncStatus : 'NOT FOUND'
  })
  console.log('AFTER drag store start:', after)
  const dump = await page.request.get(`${baseURL}/mock-caldav/__test__/dump?prefix=${encodeURIComponent(COLLECTION)}`)
  console.log('DUMP:', JSON.stringify(await dump.json()))
  expect(true).toBe(true)
})