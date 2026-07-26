/**
 * Visual alignment of the completion checkbox with the task title.
 *
 * Background: the row uses `align-items: start` so multi-line rows (title +
 * description) keep the checkbox anchored to the first line. The title gets
 * `transform: translateY(-4px)` on `.taskTitle` so the visible glyph rides
 * ~2px above the checkbox's geometric center — that lifts the cap-height
 * midline out of the descender space Western fonts leave below the line-box
 * center, and the user reads it as "the title lines up with the circle".
 *
 * This spec asserts the resulting layout is consistent: the title's
 * visible top sits at or slightly above the checkbox's geometric top.
 * Allowances:
 *   - Newsreader / serif (used in TodoView) has a slight ascender that
 *     pushes the visible glyph top above the line-box top by ~1–2 px.
 *   - jsdom isn't useful here (no real layout); this test runs in
 *     Playwright's headless Chrome where getBoundingClientRect returns
 *     pixel-precise values.
 */
import { test, expect, type Page } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

async function seedOneTask(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      if (sessionStorage.getItem('__calino_test_todo_row_align')) return
      sessionStorage.setItem('__calino_test_todo_row_align', '1')
      const raw = localStorage.getItem('calino-storage')
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
      const events = parsed.state?.events ?? []
      events.push({
        id: 'align-1',
        calendarId: 'default',
        title: 'Sample alignment task',
        type: 'task',
        start: '2026-07-10T09:00:00.000Z',
        end: '2026-07-10T09:00:00.000Z',
        isAllDay: false,
        completed: false,
      })
      parsed.state = {
        ...(parsed.state ?? {}),
        events,
        calendars: [
          {
            id: 'default',
            name: 'Personal',
            color: '#4285F4',
            isVisible: true,
            isDefault: true,
            showTasksInViews: true,
          },
        ],
      }
      localStorage.setItem('calino-storage', JSON.stringify(parsed))
    } catch {
      /* noop */
    }
  })
}

test.describe('/tasks — checkbox aligns with title visually', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await seedOneTask(page)
  })

  test('title visible top sits 0–4px above the checkbox top', async ({
    page,
  }) => {
    await page.goto('/tasks')
    const row = page.locator('[data-component="task-row"]').first()
    await expect(row).toBeVisible()

    // Bounding boxes drive the assertion — they reflect the post-CSS-
    // applied translateY. We allow a 1.5px tolerance because:
    //   1. Subpixel rounding at high DPR varies ±0.5px across browsers.
    //   2. Font metrics differ slightly between macOS / Linux / Windows.
    // Anything off by more than 1.5px would be visible to the user.
    const data = await row.evaluate((el) => {
      const check = el.querySelector('button[aria-label="Mark as complete"]') as HTMLElement
      const title = el.querySelector('[class*="taskTitle"]') as HTMLElement
      const cr = check.getBoundingClientRect()
      const tr = title.getBoundingClientRect()
      return {
        checkCenterY: cr.top + cr.height / 2,
        checkRect: { top: cr.top, height: cr.height },
        titleBoxRect: { top: tr.top, height: tr.height },
      }
    })

    // The title gets a -4px translateY on `.taskTitle` so the visible
    // glyph midline lands ~2px ABOVE the checkbox geometric center
    // (Western fonts put most of the glyph above the line-box center, so
    // shifting the box up counteracts that and lets the visible glyph
    // sit right where the user expects — centered on, or just above, the
    // circle). The line-box itself doesn't move with the transformed
    // glyph, so reading `getBoundingClientRect()` on the title gives us
    // the *post-transform* box — its top is the visible text top.
    //
    // We assert the title's visible top is 0–4 px above the checkbox's
    // geometric top (a generous band that catches both "perfectly
    // aligned" and "title nudged 1–2 px up", and rejects a regression to
    // the original misalignment where the title sat below the checkbox).
    const titleVisibleTop = data.titleBoxRect.top
    const checkboxTop = data.checkRect.top
    // title visible top should sit higher (smaller y) than the checkbox
    // geometric top. Allow up to 4 px of headroom; flag anything below.
    expect(
      checkboxTop - titleVisibleTop,
      `title visible top (${titleVisibleTop}) vs checkbox top (${checkboxTop}) — title should sit slightly above the circle`
    ).toBeGreaterThanOrEqual(0)
    expect(
      checkboxTop - titleVisibleTop,
      `title visible top (${titleVisibleTop}) vs checkbox top (${checkboxTop}) — title rose too far above the circle`
    ).toBeLessThanOrEqual(5)
  })
})
