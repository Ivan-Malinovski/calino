import { test, expect, type Locator } from '@playwright/test'
import { clearState, STORAGE_KEYS } from './fixtures/localstorage'

// "Today" is Monday 26 October 2026. Weeks run Monday–Sunday, so 28 Sep–25 Oct (four rows) are past and
// 26 Oct–1 Nov is the current week.
const TODAY = '2026-10-26T12:00:00'

interface SeedEvent {
  id: string
  title: string
  date: string
}

async function seedMonth(page: import('@playwright/test').Page, events: SeedEvent[]) {
  await clearState(page)
  await page.addInitScript(
    ({ keys, seeds }) => {
      try {
        if (sessionStorage.getItem('__calino_test_past_weeks')) return
        sessionStorage.setItem('__calino_test_past_weeks', '1')

        // "Auto": how many cards a day shows follows the room it has.
        const settingsRaw = localStorage.getItem(keys.settings)
        const settings = settingsRaw ? JSON.parse(settingsRaw) : { state: {}, version: 1 }
        settings.state = { ...settings.state, monthViewEventLimit: 0, compressPastWeeks: true }
        localStorage.setItem(keys.settings, JSON.stringify(settings))

        const now = new Date().toISOString()
        const raw = localStorage.getItem(keys.calendar)
        const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
        parsed.state = {
          ...(parsed.state ?? {}),
          events: [
            ...(parsed.state?.events ?? []),
            ...seeds.map((seed: SeedEvent) => ({
              id: seed.id,
              title: seed.title,
              type: 'event',
              start: `${seed.date}T10:00:00.000Z`,
              end: `${seed.date}T11:00:00.000Z`,
              allDay: false,
              calendarId: 'default',
              createdAt: now,
              updatedAt: now,
            })),
          ],
        }
        localStorage.setItem(keys.calendar, JSON.stringify(parsed))
      } catch {
        /* noop */
      }
    },
    { keys: STORAGE_KEYS, seeds: events }
  )
  await page.clock.setFixedTime(TODAY)
}

const rowHeight = (row: Locator): Promise<number> =>
  row.evaluate((element) => element.getBoundingClientRect().height)

test.describe('month view — past weeks size to their content', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  // Past weeks: 28 Sep (one event on the 1st), then three busy ones with seven
  // events on a day each. The current week starts on the 26th.
  const events: SeedEvent[] = [
    { id: 'pw-a', title: 'Quiet one', date: '2026-10-01' },
    ...['2026-10-07', '2026-10-14', '2026-10-21'].flatMap((date) =>
      Array.from({ length: 7 }, (_unused, i) => ({
        id: `pw-busy-${date}-${i}`,
        title: `Busy ${i}`,
        date,
      }))
    ),
  ]

  test('a quiet past week is shorter than a busy one and hides nothing', async ({ page }) => {
    await seedMonth(page, events)
    await page.goto('/month')

    const grid = page.locator('[data-component="calendar-grid"]')
    await expect(grid.locator('[data-date="2026-10-14"]')).toBeVisible()
    const rows = grid.locator('[class*="weekRow"]')
    const quiet = rows.nth(0)

    // Everything in the quiet week is drawn, with no roll-up line.
    await expect(quiet.getByText('Quiet one')).toBeVisible()
    await expect(quiet.locator('[class*="moreEvents"]')).toHaveCount(0)

    const [quietH, busyH, currentH] = await Promise.all(
      [rows.nth(0), rows.nth(2), rows.nth(4)].map(rowHeight)
    )
    // The quiet week is just its day number and one pill; a busy one is held
    // at the compressed share but taller than that.
    expect(quietH).toBeLessThan(80)
    expect(busyH).toBeGreaterThan(quietH + 20)
    // What the quiet week gives up goes to the current week.
    expect(currentH).toBeGreaterThan(busyH)
  })

  test('an empty month keeps its rows in proportion', async ({ page }) => {
    await seedMonth(page, [])
    await page.goto('/month')

    const grid = page.locator('[data-component="calendar-grid"]')
    await expect(grid.locator('[data-date="2026-10-14"]')).toBeVisible()
    const rows = grid.locator('[class*="weekRow"]')
    const [pastH, currentH] = await Promise.all([rows.nth(1), rows.nth(4)].map(rowHeight))
    // Past weeks share the spare room instead of collapsing to slivers under
    // one enormous current week.
    expect(currentH).toBeLessThan(pastH * 4)
    expect(currentH).toBeGreaterThan(pastH)
  })

  test('the month still fits the window', async ({ page }) => {
    await seedMonth(page, events)
    await page.goto('/month')

    const grid = page.locator('[data-component="calendar-grid"]')
    await expect(grid.locator('[data-date="2026-10-14"]')).toBeVisible()
    const fit = await grid.evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      lastRowBottom: element.querySelector('[class*="weekRow"]:last-child')?.getBoundingClientRect()
        .bottom,
      gridBottom: element.getBoundingClientRect().bottom,
    }))
    expect(fit.scrollHeight).toBeLessThanOrEqual(fit.clientHeight + 1)
    expect(fit.lastRowBottom ?? 0).toBeLessThanOrEqual(fit.gridBottom + 1)
  })

  test('a week that gains events grows back', async ({ page }) => {
    await seedMonth(page, events)
    await page.goto('/month')

    const grid = page.locator('[data-component="calendar-grid"]')
    const quiet = grid.locator('[class*="weekRow"]').nth(0)
    await expect(quiet.getByText('Quiet one')).toBeVisible()
    const before = await rowHeight(quiet)

    // Same day, one more event: the week now needs two pill rows.
    await page.evaluate(() => {
      const raw = localStorage.getItem('calino-storage')
      const parsed = JSON.parse(raw ?? '{}')
      parsed.state.events.push(
        ...[1].map((n) => ({
          ...parsed.state.events.find((e: { id: string }) => e.id === 'pw-a'),
          id: `pw-extra-${n}`,
          title: `Extra ${n}`,
        }))
      )
      localStorage.setItem('calino-storage', JSON.stringify(parsed))
    })
    await page.reload()
    await expect(quiet.getByText('Extra 1')).toBeVisible()
    expect(await rowHeight(quiet)).toBeGreaterThan(before + 15)
  })
})
