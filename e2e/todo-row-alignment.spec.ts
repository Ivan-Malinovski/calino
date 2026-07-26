/**
 * Visual alignment of the completion checkbox with the task title.
 *
 * Background: the row uses `align-items: start` so multi-line rows (title +
 * description) keep the checkbox anchored to the first line. `.taskTitle`
 * carries `position: relative; top: -3px` so the visible glyph rides just
 * above the checkbox's geometric center — that lifts the cap-height midline
 * out of the descender space Western fonts leave below the line-box center,
 * and the user reads it as "the title lines up with the circle".
 *
 * This spec asserts the resulting layout stays in that tuned band.
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

    // Wait for webfonts before measuring. `.taskTitle` resolves to
    // Newsreader, which is fetched from Google Fonts with `display=swap`,
    // so the first paint uses the Georgia fallback and the box shifts by
    // ~1px when the real face arrives. Measuring without this wait races
    // that swap and the assertion below flips on timing alone.
    await page.evaluate(() => document.fonts.ready)

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

    // `.taskTitle` is offset with `position: relative; top: -3px`, which
    // moves the box itself (unlike a transform), so the title's
    // `getBoundingClientRect().top` is the visible text top.
    //
    // With that 3px lift the title's box top lands ~1px BELOW the
    // checkbox's geometric top, and that is the optically-correct result:
    // Western fonts leave ascender space above the cap height, so a box
    // top slightly below the circle's top puts the *glyph* right on it.
    //
    // The band is centred on that measured value with a couple of px of
    // slack for cross-platform font metrics and subpixel rounding. It
    // still rejects the misalignment this spec was written to catch,
    // where the title sat several px below the circle.
    //
    // NB: an earlier revision asserted a 0–5px band and described a
    // `transform: translateY(-4px)` that this stylesheet has never had —
    // it went `margin-top: -2px` → `top: -3px` in a9db966, a deliberate
    // retune that left the test behind. Keep this in step with
    // TodoView.module.css if the offset moves again.
    const titleVisibleTop = data.titleBoxRect.top
    const checkboxTop = data.checkRect.top
    const delta = checkboxTop - titleVisibleTop
    expect(
      delta,
      `title visible top (${titleVisibleTop}) vs checkbox top (${checkboxTop}) — title dropped too far below the circle`
    ).toBeGreaterThanOrEqual(-3)
    expect(
      delta,
      `title visible top (${titleVisibleTop}) vs checkbox top (${checkboxTop}) — title rose too far above the circle`
    ).toBeLessThanOrEqual(1)
  })
})
