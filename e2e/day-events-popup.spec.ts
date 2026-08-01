/**
 * E2E spec for the month view's "+N more" popup.
 *
 * Regression: clicking an event inside the popup opened the event modal with
 * nothing in it, exactly as though a new event were being created. The popup
 * is portaled into <body>, but React events bubble along the tree the portal
 * was *declared* in — the day cell — so every click inside it also reached the
 * cell's own handler, which opens "new event on this day" and overwrote the
 * event we had just asked for.
 */
import { test, expect, type Page } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

function todayLocal(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** More events than any cell can show, so the day is guaranteed a rollup. */
async function seedBusyDay(page: Page, count: number): Promise<void> {
  const day = todayLocal()
  const events = Array.from({ length: count }, (_, i) => ({
    id: `popup-e${i}`,
    title: `Popup Event ${i}`,
    type: 'event',
    start: `${day}T${String(i + 1).padStart(2, '0')}:00:00`,
    end: `${day}T${String(i + 1).padStart(2, '0')}:30:00`,
    isAllDay: false,
    calendarId: 'default',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }))
  await page.addInitScript((seeded) => {
    const raw = localStorage.getItem('calino-storage')
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
    parsed.state = {
      ...(parsed.state ?? {}),
      events: [...(parsed.state?.events ?? []), ...(seeded as unknown[])],
    }
    localStorage.setItem('calino-storage', JSON.stringify(parsed))
  }, events)
}

test.describe('Month view — "+N more" popup', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await seedBusyDay(page, 9)
  })

  test('clicking an event in the popup opens that event, not a blank modal', async ({ page }) => {
    await page.goto('/month')
    await page
      .locator('button', { hasText: /^\+\d+ more$/ })
      .first()
      .click()

    const popup = page.locator('[data-component="day-events-popup"]')
    await expect(popup).toBeVisible()
    await popup.getByText('Popup Event 8').click()

    const modal = page.locator('[data-component="modal-card"]')
    await expect(modal).toBeVisible()
    await expect(modal.locator('[data-component="event-title-input"]')).toHaveValue('Popup Event 8')
  })

  test('the popup opens inside the window', async ({ page }) => {
    await page.goto('/month')
    await page
      .locator('button', { hasText: /^\+\d+ more$/ })
      .first()
      .click()

    const popup = page.locator('[data-component="day-events-popup"]')
    await expect(popup).toBeVisible()

    const box = await popup.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      return {
        left: rect.left,
        top: rect.top,
        rightOverflow: rect.right - window.innerWidth,
        bottomOverflow: rect.bottom - window.innerHeight,
      }
    })
    expect(box.left).toBeGreaterThanOrEqual(0)
    expect(box.top).toBeGreaterThanOrEqual(0)
    expect(box.rightOverflow).toBeLessThanOrEqual(0)
    expect(box.bottomOverflow).toBeLessThanOrEqual(0)
  })
})
