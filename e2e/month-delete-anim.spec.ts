/**
 * Regression spec for the "delete doesn't animate in month view" bug.
 *
 * Background: when a user deletes an event in month view, the event
 * should fade out over ~180ms (matching the rest of the calendar's
 * subtle enter/exit animations). The bug was that two of the three
 * AnimatePresence wrappers in CalendarGrid.tsx were wrapped in
 * `{dayEvents.length > 0 && ...}` / `{dayTasks.length > 0 && ...}`
 * conditionals. When the LAST event on a day was deleted, the
 * conditional flipped false and the entire <div> (with its
 * AnimatePresence) was unmounted by React before framer-motion could
 * run the exit animation — the card just disappeared.
 *
 * This spec seeds a single event on a day in the current month, then
 * right-clicks → Delete on it in month view, and asserts the motion.div
 * wrapper's computed opacity actually drops below 1 during the exit
 * animation. If the bug recurs, the wrapper is unmounted synchronously
 * and the assertion fails.
 */
import { test, expect, type Page } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

// Seed a deterministic event on today's date so the test doesn't need
// to navigate to a specific month before running.
function todayAtMidday(): string {
  const now = new Date()
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return `${date}T12:00:00.000Z`
}

async function seedSingleEvent(page: Page): Promise<void> {
  await page.addInitScript(
    ({ calendarKey, event }) => {
      try {
        if (sessionStorage.getItem('__calino_test_month_delete')) return
        sessionStorage.setItem('__calino_test_month_delete', '1')
        const raw = localStorage.getItem(calendarKey)
        const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
        const events = parsed.state?.events ?? []
        events.push(event)
        parsed.state = { ...(parsed.state ?? {}), events }
        localStorage.setItem(calendarKey, JSON.stringify(parsed))
      } catch {
        /* noop */
      }
    },
    {
      calendarKey: 'calino-storage',
      event: {
        id: 'month-delete-anim-event',
        title: 'Delete Animation Test',
        type: 'event',
        start: todayAtMidday(),
        end: todayAtMidday(),
        allDay: false,
        calendarId: 'default',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }
  )
}

test.describe('month-view — event delete animation', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await seedSingleEvent(page)
  })

  test('deleting the only event on a day in month view animates it out (not pops)', async ({ page }) => {
    await page.goto('/month')

    // The event card. Right-click to open the context menu.
    const card = page.locator('[data-component="event-card"]', {
      hasText: 'Delete Animation Test',
    })
    await expect(card).toBeVisible()
    await card.click({ button: 'right' })

    // The context menu is portaled to document.body. Its items are
    // plain <button>s with the label as accessible name. We scope the
    // Delete query to the menu container by class so other Delete
    // buttons elsewhere on the page (e.g. inside the EventPreviewPopup)
    // don't satisfy the locator. Vite generates CSS-module class names
    // as `_menu_<hash>` — match that pattern with `[class*="_menu_"]`.
    const contextMenu = page.locator('[class*="_menu_"]')
    await expect(contextMenu).toBeVisible()
    const menuDeleteButton = contextMenu.getByRole('button', { name: /^Delete$/ })
    await expect(menuDeleteButton).toBeVisible()

    // The motion.div wrapper is the parent of the EventCard. Use
    // xpath to walk up one level.
    const wrapper = card.locator('xpath=..')

    // Sample the wrapper's computed opacity across the exit animation.
    // With the fix, the animation runs and opacity drops below 1 for at
    // least one frame. Without the fix, the motion.div is unmounted
    // synchronously and we never see an intermediate opacity.
    //
    // The sampling loop lives in the page and is driven by rAF rather than
    // by per-sample round-trips from the test: under parallel workers a
    // round-trip can take longer than the whole ~200ms animation, so the
    // old version could miss every intermediate frame and fail spuriously.
    // It is armed *before* the click so no frames are lost to click latency,
    // and it stops as soon as the element leaves the DOM.
    await wrapper.evaluate((el) => {
      const samples: number[] = []
      ;(window as unknown as { __exitOpacitySamples: number[] }).__exitOpacitySamples = samples
      const deadline = performance.now() + 2000
      const tick = (): void => {
        if (!el.isConnected || performance.now() > deadline) return
        const v = parseFloat(window.getComputedStyle(el as HTMLElement).opacity)
        if (Number.isFinite(v)) samples.push(v)
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })

    await menuDeleteButton.click()
    // Wait for the element to actually leave the DOM, which is what ends the
    // sampling loop — no fixed sleep, so a slow machine just samples longer.
    await expect(wrapper).toHaveCount(0, { timeout: 5000 })

    const liveSamples = await page.evaluate(
      () => (window as unknown as { __exitOpacitySamples: number[] }).__exitOpacitySamples
    )
    expect(
      liveSamples.some((o) => o < 0.99),
      `expected exit animation to drop opacity below 1; samples: ${JSON.stringify(liveSamples)}`
    ).toBe(true)
  })
})