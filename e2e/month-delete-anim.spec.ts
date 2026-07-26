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

    // Sample the wrapper's computed opacity over a 300ms window
    // starting immediately after the click. With the fix, the exit
    // animation runs and opacity drops below 1 for at least one
    // frame. Without the fix, the motion.div is unmounted
    // synchronously and we never see an intermediate opacity.
    const opacities: number[] = []
    const stopAt = Date.now() + 300
    const sampling = (async (): Promise<void> => {
      while (Date.now() < stopAt) {
        const opacity = await wrapper
          .evaluate((el) => {
            // If the element is still in the DOM, read the computed
            // style (framer-motion animates opacity via inline style).
            const cs = window.getComputedStyle(el as HTMLElement)
            const v = parseFloat(cs.opacity)
            return Number.isFinite(v) ? v : -1
          })
          .catch(() => -1)
        opacities.push(opacity)
        await page.waitForTimeout(16)
      }
    })()
    await menuDeleteButton.click()
    await sampling

    // Filter to samples taken while the element was still in the DOM
    // (opacity is a number 0..1, -1 means "element gone").
    const liveSamples = opacities.filter((o) => o >= 0)
    expect(
      liveSamples.some((o) => o < 0.99),
      `expected exit animation to drop opacity below 1; samples: ${JSON.stringify(liveSamples)}`
    ).toBe(true)

    // Eventually the motion.div should be gone entirely (after the
    // exit animation completes).
    await expect(wrapper).toHaveCount(0, { timeout: 1000 })
  })
})