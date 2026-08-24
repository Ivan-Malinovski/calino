/**
 * Month-view drag-to-create (all-day range).
 *
 * Desktop only: sweep the left mouse button across empty day cells and the
 * event modal must open seeded as an all-day event spanning the inclusive
 * start..end. Single-day click-to-create must remain a timed event, and a
 * drag that starts on an event card must NOT start a create-drag (the dnd-kit
 * move owns that press). Compact mobile / touch is intentionally excluded
 * (tap-to-create lives on the long-press menu there) — see CalendarGrid.
 */
import { test, expect, type Page } from '@playwright/test'
import { clearState, STORAGE_KEYS } from './fixtures/localstorage'

async function seedMonth(page: Page, date: string): Promise<void> {
  await page.addInitScript(
    ({ key, date }: { key: string; date: string }) => {
      try {
        const raw = localStorage.getItem(key)
        const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
        parsed.state = { ...(parsed.state ?? {}), currentDate: date, currentView: 'month' }
        localStorage.setItem(key, JSON.stringify(parsed))
      } catch {
        /* noop */
      }
    },
    { key: STORAGE_KEYS.calendar, date }
  )
}

async function dragAcrossDays(
  page: Page,
  fromDate: string,
  toDate: string,
  opts: { pauseMidDrag?: boolean } = {}
): Promise<void> {
  const from = page.locator(`[data-date="${fromDate}"]`)
  const to = page.locator(`[data-date="${toDate}"]`)
  const fb = (await from.boundingBox())!
  const tb = (await to.boundingBox())!
  await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2)
  await page.mouse.down()
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 12 })
  if (opts.pauseMidDrag) {
    // Visible selection feedback: the swept day cells are marked while dragging.
    await expect(page.locator('[data-create-selection]')).toHaveCount(3)
    await expect(page.locator('[data-create-selection="start"]')).toHaveCount(1)
    await expect(page.locator('[data-create-selection="end"]')).toHaveCount(1)
  }
  await page.mouse.up()
}

test.describe('month drag-to-create', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await seedMonth(page, '2026-08-01')
  })

  test('sweeping across day cells opens an all-day range in the modal', async ({ page }) => {
    await page.goto('/month')
    await expect(page.locator('[data-component="calendar-grid"]').first()).toBeVisible()

    await dragAcrossDays(page, '2026-08-10', '2026-08-12', { pauseMidDrag: true })

    // Modal opens.
    const titleInput = page.locator('[data-component="event-title-input"]')
    await expect(titleInput).toBeVisible()

    // Seeded as an all-day event spanning the inclusive dragged range.
    await expect(page.getByRole('checkbox', { name: 'All day' })).toBeChecked()

    await expect(page.locator('[data-component="event-start-date"]')).toHaveValue('2026-08-10')
    await expect(page.locator('[data-component="event-end-date"]')).toHaveValue('2026-08-12')
  })

  test('single-day click still creates a timed event (not all-day)', async ({ page }) => {
    await page.goto('/month')
    await expect(page.locator('[data-component="calendar-grid"]').first()).toBeVisible()

    const cell = page.locator('[data-date="2026-08-15"]')
    const box = (await cell.boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

    const titleInput = page.locator('[data-component="event-title-input"]')
    await expect(titleInput).toBeVisible()

    await expect(page.getByRole('checkbox', { name: 'All day' })).not.toBeChecked()
  })

  test('drag that starts on an event card does not create an all-day range', async ({ page }) => {
    // Seed one all-day event on 2026-08-08 so a card occupies that cell.
    await page.addInitScript(
      ({ key }: { key: string }) => {
        try {
          const raw = localStorage.getItem(key)
          const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
          const events = parsed.state?.events ?? []
          events.push({
            id: 'seed-allday',
            title: 'Existing',
            type: 'event',
            start: '2026-08-08T00:00:00.000Z',
            end: '2026-08-08T00:00:00.000Z',
            isAllDay: true,
            calendarId: 'default',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          parsed.state = { ...(parsed.state ?? {}), events }
          localStorage.setItem(key, JSON.stringify(parsed))
        } catch {
          /* noop */
        }
      },
      { key: STORAGE_KEYS.calendar }
    )
    await page.goto('/month')
    await expect(page.locator('[data-component="calendar-grid"]').first()).toBeVisible()

    // Drag starting ON the existing event card, sweeping to an empty cell.
    // The center of a day cell may be empty even when its card is present, so
    // use the card's actual bounds for the drag origin.
    const eventCard = page.locator('[data-component="event-card"]').filter({ hasText: 'Existing' })
    const eventBox = (await eventCard.boundingBox())!
    const targetCell = page.locator('[data-date="2026-08-09"]')
    const targetBox = (await targetCell.boundingBox())!
    await page.mouse.move(eventBox.x + eventBox.width / 2, eventBox.y + eventBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height / 2,
      { steps: 12 }
    )
    await page.mouse.up()

    // No modal should open from a create-drag that began on a card; the
    // dnd-kit move (or nothing) owns that press. The modal must stay closed.
    await expect(page.locator('[data-component="event-title-input"]')).toHaveCount(0)
  })
})
