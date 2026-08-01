import { test, expect } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

const SCROLL = '[data-component="week-mobile-scroll"]'
const HEADER = '[data-component="week-mobile-header"]'
const TIME_COLUMN = '[data-component="week-mobile-time-column"]'
const DAY_HEADER = '[data-component="week-mobile-day-header"]'
const DAY_COLUMN = '[data-component="week-mobile-day-column"]'

// The mobile week grid scrolls horizontally, which is the only place this
// shows up — the desktop header fits without scrolling.
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
})

test.describe('Week view — mobile day header', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await page.goto('/week')
    await expect(page.locator(SCROLL)).toBeVisible()
  })

  test('the header strip is as wide as the days it labels', async ({ page }) => {
    // The header is a block-level flex row, so its box was only as wide as the
    // scroll container while the day columns overflowed well past it. The
    // background paints across the box and not the overflow, so the part
    // scrolled into view had nothing behind it.
    const { headerWidth, contentWidth } = await page.evaluate(
      ({ scroll, header }) => {
        const scrollEl = document.querySelector(scroll) as HTMLElement
        const headerEl = document.querySelector(header) as HTMLElement
        return {
          headerWidth: headerEl.getBoundingClientRect().width,
          contentWidth: scrollEl.scrollWidth,
        }
      },
      { scroll: SCROLL, header: HEADER }
    )

    // There is something to scroll, otherwise the assertion below is vacuous.
    expect(contentWidth).toBeGreaterThan(400)
    expect(headerWidth).toBeGreaterThanOrEqual(contentWidth - 1)
  })

  test('a day scrolled into view still has a background behind it', async ({ page }) => {
    // Checks what the eye actually catches: after scrolling, the point where
    // the last day header sits must be painted by the header, not by whatever
    // is behind the transparent gap.
    await page.locator(SCROLL).evaluate((el) => {
      el.scrollLeft = el.scrollWidth
    })
    await expect
      .poll(() => page.locator(SCROLL).evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(0)

    // The header's own border box is what carries the background — a day
    // label rendering there is not enough, since the labels overflow the box
    // and `closest()` would find the header either way. The box itself has to
    // still reach the right edge of the visible strip once scrolled to the end.
    const { headerRight, visibleRight } = await page.evaluate(
      ({ scroll, header }) => {
        const scrollEl = document.querySelector(scroll) as HTMLElement
        const headerEl = document.querySelector(header) as HTMLElement
        const box = scrollEl.getBoundingClientRect()
        return {
          headerRight: headerEl.getBoundingClientRect().right,
          visibleRight: box.left + scrollEl.clientWidth,
        }
      },
      { scroll: SCROLL, header: HEADER }
    )

    expect(headerRight).toBeGreaterThanOrEqual(visibleRight - 1)
  })

  test('the time column stays pinned to the left across the whole week', async ({ page }) => {
    // `position: sticky` is clamped to the containing block, and the body row
    // was only as wide as the container while the day columns overflowed it —
    // so the time column came unstuck partway across and scrolled off screen.
    const restingLeft = await page
      .locator(TIME_COLUMN)
      .evaluate((el) => el.getBoundingClientRect().left)

    await page.locator(SCROLL).evaluate((el) => {
      el.scrollLeft = el.scrollWidth
    })
    await expect
      .poll(() => page.locator(SCROLL).evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(0)

    const scrolledLeft = await page
      .locator(TIME_COLUMN)
      .evaluate((el) => el.getBoundingClientRect().left)

    expect(scrolledLeft).toBeCloseTo(restingLeft, 0)
  })
})

test.describe('Week view — pinch to fit more days', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await page.goto('/week')
    await expect(page.locator(SCROLL)).toBeVisible()
  })

  // The pinch gesture itself is @use-gesture's to detect; what is easy to get
  // wrong is the plumbing from the handler's scale value to the two places
  // that size a day column. So this drives `--day-scale` directly, exactly as
  // the pinch handler does, and checks the columns actually respond.
  const setDayScale = (page: import('@playwright/test').Page, value: number) =>
    page.locator(SCROLL).evaluate((el, scale) => {
      ;(el.parentElement as HTMLElement).style.setProperty('--day-scale', String(scale))
    }, value)

  const dayWidths = async (page: import('@playwright/test').Page) => {
    const header = await page
      .locator(DAY_HEADER)
      .first()
      .evaluate((el) => el.getBoundingClientRect().width)
    const column = await page
      .locator(DAY_COLUMN)
      .first()
      .evaluate((el) => el.getBoundingClientRect().width)
    return { header, column }
  }

  test('compressing narrows the day headers and the columns together', async ({ page }) => {
    // Header and body are sized by separate rules; if only one picks up the
    // variable the days stop lining up with their labels.
    const before = await dayWidths(page)
    expect(before.header).toBeGreaterThan(0)
    expect(before.column).toBeCloseTo(before.header, 0)

    await setDayScale(page, 0.6)

    const after = await dayWidths(page)
    expect(after.header).toBeLessThan(before.header)
    expect(after.column).toBeCloseTo(after.header, 0)
    expect(after.header / before.header).toBeCloseTo(0.6, 1)
  })

  test('compressing fits more of the week on screen', async ({ page }) => {
    const visibleDays = async () => {
      const { width, visible } = await page.evaluate((scroll) => {
        const el = document.querySelector(scroll) as HTMLElement
        const day = document.querySelector(
          '[data-component="week-mobile-day-column"]'
        ) as HTMLElement
        return { width: day.getBoundingClientRect().width, visible: el.clientWidth - 45 }
      }, SCROLL)
      return visible / width
    }

    const before = await visibleDays(page)
    await setDayScale(page, 0.6)
    const after = await visibleDays(page)

    expect(after).toBeGreaterThan(before)
    // The point of the feature: enough of the week to be worth the gesture.
    expect(after).toBeGreaterThanOrEqual(4.5)
  })
})
