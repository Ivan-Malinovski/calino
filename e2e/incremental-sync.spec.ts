import { test, expect, type Page } from '@playwright/test'
import { clearState, seedAccount } from './fixtures/localstorage'

/**
 * End-to-end coverage for RFC 6578 incremental sync (Phase 4).
 *
 * These tests are mostly about requests that must NOT happen and resources a
 * time-windowed query would never return — neither is observable from the UI,
 * so they assert against the mock's request log and against the persisted
 * store rather than against rendered pixels alone.
 *
 * The account lives in its own calendar home (`/mock-caldav-inc`, principal
 * `userc`) because every sync walks the whole home: sharing one with the other
 * specs would mean counting their requests too, and Playwright runs
 * `fullyParallel`.
 */

const HOME = '/dav/calendars/userc/'
const INC = `${HOME}inc-sync/`
const NOTOKEN = `${HOME}inc-notoken/`

function ics(uid: string, summary: string, day: string): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Calino Test//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART:${day}T120000Z`,
    `DTEND:${day}T130000Z`,
    `SUMMARY:${summary}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

/** `YYYYMMDD`, `days` from today. */
function dayStamp(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10).replaceAll('-', '')
}

class Mock {
  constructor(
    private readonly page: Page,
    private readonly base: string
  ) {}

  private url(endpoint: string, query: Record<string, string>): string {
    const params = new URLSearchParams(query).toString()
    return `${this.base}/mock-caldav-inc/__test__/${endpoint}?${params}`
  }

  async reset(prefix: string): Promise<void> {
    await this.page.request.post(this.url('reset', { prefix }))
  }

  /** Change a resource the way another CalDAV client would. */
  async put(path: string, data: string): Promise<void> {
    await this.page.request.post(this.url('mutate', { path }), { data })
  }

  async remove(path: string): Promise<void> {
    await this.page.request.post(this.url('mutate', { path, remove: '1' }))
  }

  async requests(prefix: string): Promise<Array<{ method: string; path: string }>> {
    const response = await this.page.request.get(this.url('requests', { prefix }))
    return (await response.json()) as Array<{ method: string; path: string }>
  }
}

/** The calendars Calino has persisted, as the store sees them. */
async function storedCalendars(
  page: Page
): Promise<Array<{ url: string; ctag: string | null; syncToken: string | null }>> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('calino_caldav_calendars')
    return JSON.parse(raw ?? '[]') as Array<{
      url: string
      ctag: string | null
      syncToken: string | null
    }>
  })
}

async function storedEventTitles(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('calino-storage') ?? '{}')
    return ((stored.state?.events ?? []) as Array<{ title: string }>).map((e) => e.title)
  })
}

async function syncAll(page: Page): Promise<void> {
  await page.locator('[data-component="sync-all-calendars"]').click()
  await expect(
    page.getByText(/All calendars synced\.|Calendars are already syncing\./)
  ).toBeVisible({ timeout: 20_000 })
}

test.describe('incremental sync (RFC 6578)', () => {
  // One shared calendar home whose request log is the assertion target — these
  // cannot observe each other's traffic.
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page, baseURL }) => {
    await new Mock(page, baseURL!).reset(HOME)
    await clearState(page)
    await seedAccount(page, {
      id: 'inc-account',
      name: 'Mock Incremental',
      serverUrl: `${baseURL}/mock-caldav-inc/dav/`,
      username: 'userc',
      password: 'pass',
      calendars: [{ name: 'Inc Sync', path: 'calendars/userc/inc-sync/', isDefault: true }],
    })
  })

  test('a first sync stores the collection cursors it will sync against next time', async ({
    page,
    baseURL,
  }) => {
    const mock = new Mock(page, baseURL!)
    await mock.put(`${INC}first.ics`, ics('inc-first', 'First event', dayStamp(1)))

    await page.goto('/month')
    await syncAll(page)

    await expect
      .poll(async () => (await storedCalendars(page)).find((c) => c.url.includes('inc-sync')), {
        timeout: 15_000,
      })
      .toEqual(expect.objectContaining({ ctag: expect.any(String), syncToken: expect.any(String) }))
    expect(await storedEventTitles(page)).toContain('First event')
  })

  test('a second sync over unchanged collections issues no REPORT and fetches no resource', async ({
    page,
    baseURL,
  }) => {
    const mock = new Mock(page, baseURL!)
    await mock.put(`${INC}quiet.ics`, ics('inc-quiet', 'Quiet event', dayStamp(1)))

    await page.goto('/month')
    await syncAll(page)
    await expect.poll(() => storedEventTitles(page), { timeout: 15_000 }).toContain('Quiet event')

    const before = (await mock.requests(INC)).length
    await syncAll(page)
    // Give a stray request time to show up — asserting an absence immediately
    // would pass even if the fetch were merely slow.
    await page.waitForTimeout(1500)

    // A cheap metadata PROPFIND still goes out — that is how the ctag is
    // re-read, and re-reading it is what makes the skip possible. What must
    // not happen is any listing of the collection or fetching of its members.
    const issued = (await mock.requests(INC)).slice(before)
    expect(issued.filter((r) => r.method === 'REPORT' || r.method === 'GET')).toEqual([])
  })

  test('a resource changed on the server is fetched by href and shown', async ({
    page,
    baseURL,
  }) => {
    const mock = new Mock(page, baseURL!)
    const href = `${INC}changed.ics`
    await mock.put(href, ics('inc-changed', 'Original title', dayStamp(1)))

    await page.goto('/month')
    await syncAll(page)
    await expect.poll(() => storedEventTitles(page), { timeout: 15_000 }).toContain('Original title')

    const before = (await mock.requests(INC)).length
    await mock.put(href, ics('inc-changed', 'Renamed remotely', dayStamp(1)))
    await syncAll(page)

    await expect
      .poll(() => storedEventTitles(page), { timeout: 15_000 })
      .toContain('Renamed remotely')
    expect(await storedEventTitles(page)).not.toContain('Original title')

    // The delta was collected by a sync-collection REPORT and the one changed
    // resource pulled by a direct GET — not by re-listing the collection.
    const issued = (await mock.requests(INC)).slice(before)
    expect(issued.filter((r) => r.method === 'GET').map((r) => r.path)).toEqual([href])
    expect(issued.filter((r) => r.method === 'REPORT')).toHaveLength(1)
  })

  test('a resource removed on the server disappears locally', async ({ page, baseURL }) => {
    const mock = new Mock(page, baseURL!)
    await mock.put(`${INC}keep.ics`, ics('inc-keep', 'Survivor event', dayStamp(1)))
    await mock.put(`${INC}gone.ics`, ics('inc-gone', 'Doomed event', dayStamp(1)))

    await page.goto('/month')
    await syncAll(page)
    await expect.poll(() => storedEventTitles(page), { timeout: 15_000 }).toContain('Doomed event')

    await mock.remove(`${INC}gone.ics`)
    await syncAll(page)

    await expect
      .poll(() => storedEventTitles(page), { timeout: 15_000 })
      .not.toContain('Doomed event')
    // The untouched resource is not collateral damage: a deletion sweep scoped
    // to the whole calendar rather than to the reported hrefs would take this
    // one out too, since an incremental pass never re-lists it.
    expect(await storedEventTitles(page)).toContain('Survivor event')
  })

  test('a changed resource outside the query window is still synchronized', async ({
    page,
    baseURL,
  }) => {
    const mock = new Mock(page, baseURL!)
    await mock.put(`${INC}anchor.ics`, ics('inc-anchor', 'Anchor event', dayStamp(1)))

    await page.goto('/month')
    await syncAll(page)
    await expect.poll(() => storedEventTitles(page), { timeout: 15_000 }).toContain('Anchor event')

    // Three years out — far past the end of the time-range a calendar-query
    // asks for, so only a fetch by href can bring it in.
    const href = `${INC}far-future.ics`
    await mock.put(href, ics('inc-far', 'Far future event', dayStamp(1100)))
    await syncAll(page)

    await expect
      .poll(() => storedEventTitles(page), { timeout: 15_000 })
      .toContain('Far future event')
    expect((await mock.requests(INC)).some((r) => r.method === 'GET' && r.path === href)).toBe(true)
  })

  test('a rejected sync token falls back to a full sync instead of losing the change', async ({
    page,
    baseURL,
  }) => {
    const mock = new Mock(page, baseURL!)
    await mock.put(`${NOTOKEN}evt.ics`, ics('inc-notoken', 'Fallback event', dayStamp(1)))

    await page.goto('/month')
    await syncAll(page)

    // The collection advertises a sync-token but 400s every REPORT that uses
    // one, so the events can only have arrived through the full-sync path.
    await expect
      .poll(() => storedEventTitles(page), { timeout: 20_000 })
      .toContain('Fallback event')

    await mock.put(`${NOTOKEN}evt.ics`, ics('inc-notoken', 'Fallback event edited', dayStamp(1)))
    await syncAll(page)

    await expect
      .poll(() => storedEventTitles(page), { timeout: 20_000 })
      .toContain('Fallback event edited')
  })

  test('a read-only calendar is discovered but never offered as a save target', async ({
    page,
  }) => {
    await page.goto('/month')
    await syncAll(page)

    await expect
      .poll(async () => (await storedCalendars(page)).map((c) => c.url).join(','), {
        timeout: 15_000,
      })
      .toContain('inc-readonly')

    await page.locator('[data-component="calendar-section-toggle"]').click()
    await expect(page.getByText('Inc Read Only', { exact: true })).toBeVisible({ timeout: 10_000 })

    // "c" opens the create-event modal (see smoke.spec.ts).
    await page.keyboard.press('c')
    await expect(page.locator('[data-component="event-title-input"]')).toBeVisible({
      timeout: 10_000,
    })
    const select = page.locator('#calendar-select')
    await expect(select).toBeVisible({ timeout: 10_000 })
    const options = await select.locator('option').allTextContents()
    expect(options).toContain('Inc Sync')
    expect(options).not.toContain('Inc Read Only')
  })
})
