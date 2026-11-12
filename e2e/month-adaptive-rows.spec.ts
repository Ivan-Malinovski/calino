import { test, expect, type Page } from '@playwright/test'
import { clearState, STORAGE_KEYS } from './fixtures/localstorage'

// "Today" is Monday 9 November 2026: the grid runs 26 Oct – 6 Dec, so today sits in the
// third week row (index 2).
const TODAY = '2026-11-09T12:00:00'

interface SeedEvent {
  id: string
  title: string
  date: string
  hour: number
}

const events: SeedEvent[] = [
  { id: 'ar-standup', title: 'Standup', date: '2026-11-09', hour: 9 },
  { id: 'ar-anna', title: '1:1 with Anna', date: '2026-11-09', hour: 10 },
  { id: 'ar-af', title: 'Air France 1232', date: '2026-11-13', hour: 8 },
  { id: 'ar-hotel', title: 'Hotel check-in', date: '2026-11-13', hour: 9 },
  { id: 'ar-dinner', title: 'Dinner with Julie', date: '2026-11-13', hour: 10 },
  { id: 'ar-book', title: 'Book club', date: '2026-11-19', hour: 9 },
  { id: 'ar-thanks', title: 'Thanksgiving dinner', date: '2026-11-26', hour: 9 },
  { id: 'ar-nov3', title: 'Call with Mette', date: '2026-11-03', hour: 9 },
]

async function seedMonth(page: Page): Promise<void> {
  await clearState(page)
  await page.addInitScript(
    ({ keys, seeds }) => {
      try {
        if (sessionStorage.getItem('__calino_test_adaptive_rows')) return
        sessionStorage.setItem('__calino_test_adaptive_rows', '1')

        // "Auto" turns the adaptive row layout on.
        const settingsRaw = localStorage.getItem(keys.settings)
        const settings = settingsRaw ? JSON.parse(settingsRaw) : { state: {}, version: 1 }
        settings.state = { ...settings.state, monthViewEventLimit: 0 }
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
              start: `${seed.date}T${String(seed.hour).padStart(2, '0')}:00:00.000Z`,
              end: `${seed.date}T${String(seed.hour + 1).padStart(2, '0')}:00:00.000Z`,
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

interface RowInfo {
  state: string | null
  top: number
  bottom: number
  height: number
}

async function readRows(page: Page): Promise<{ rows: RowInfo[]; gridBottom: number }> {
  return page.locator('[data-component="calendar-grid"]').evaluate((grid) => ({
    gridBottom: grid.getBoundingClientRect().bottom,
    rows: [...grid.querySelectorAll<HTMLElement>('[data-row-state]')].map((row) => {
      const rect = row.getBoundingClientRect()
      return {
        state: row.getAttribute('data-row-state'),
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
      }
    }),
  }))
}

test.describe('month view — adaptive row heights', () => {
  test('short window: every week stays visible and the grid cannot scroll', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 300 })
    await seedMonth(page)
    await page.goto('/month')

    const grid = page.locator('[data-component="calendar-grid"]')
    await expect(grid).toBeVisible()
    await expect(page.locator('[data-row-state]')).toHaveCount(6)

    const { rows, gridBottom } = await readRows(page)
    // Nothing has room to open: every row is a collapsed summary.
    expect(rows.every((row) => row.state !== 'expanded')).toBe(true)
    expect(rows.at(-1)!.bottom).toBeLessThanOrEqual(gridBottom + 1)
    await expect(grid).toHaveCSS('overflow-y', 'hidden')
  })

  test('tall window: busy weeks open and list their events', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await seedMonth(page)
    await page.goto('/month')

    await expect(page.locator('[data-row-state]')).toHaveCount(6)
    await expect(page.locator('[data-row-state="expanded"]')).toHaveCount(6)
    await expect(page.getByText('Dinner with Julie')).toBeVisible()

    const { rows, gridBottom } = await readRows(page)
    expect(rows.at(-1)!.bottom).toBeLessThanOrEqual(gridBottom + 1)
  })

  test('medium window: the current week opens first, the others stay collapsed', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 430 })
    await seedMonth(page)
    await page.goto('/month')

    await expect(page.locator('[data-row-state]')).toHaveCount(6)
    await expect(page.getByText('1:1 with Anna')).toBeVisible()

    const { rows, gridBottom } = await readRows(page)
    // Week 3 (index 2) holds today and is the first to open.
    expect(rows[2].state).toBe('expanded')
    expect(rows[0].state).not.toBe('expanded')
    expect(rows.at(-1)!.bottom).toBeLessThanOrEqual(gridBottom + 1)
    // The rows tile the grid without gaps.
    for (let i = 1; i < rows.length; i++) {
      expect(Math.abs(rows[i].top - rows[i - 1].bottom)).toBeLessThanOrEqual(1)
    }
  })

  test('moving the keyboard focus to another week gives that week the room', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 430 })
    await seedMonth(page)
    await page.goto('/month')
    await expect(page.locator('[data-row-state]')).toHaveCount(6)

    const before = await readRows(page)
    expect(before.rows[2].state).toBe('expanded')

    // Focus a day in the 4th week (index 3) and step back up to be sure the roving grid has it.
    await page.locator('[data-date="2026-11-16"]').focus()

    await expect.poll(async () => (await readRows(page)).rows[3].state).toBe('expanded')
    const after = await readRows(page)
    expect(after.rows.at(-1)!.bottom).toBeLessThanOrEqual(after.gridBottom + 1)
  })

  test('a short window tightens the top bar', async ({ page }) => {
    await seedMonth(page)
    const header = page.locator('[data-component="header"]')

    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/month')
    await expect(header).toBeVisible()
    const tall = (await header.boundingBox())!.height

    await page.setViewportSize({ width: 1280, height: 400 })
    await expect
      .poll(async () => (await header.boundingBox())!.height, { timeout: 5000 })
      .toBeLessThan(tall - 10)
  })
})
