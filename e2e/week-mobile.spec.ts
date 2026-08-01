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

test.describe('Week view — swipe paging vs. the day strip', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await page.goto('/week')
    await expect(page.locator(SCROLL)).toBeVisible()
  })

  /** The week number shown in the corner of the grid — a direct read of which
   *  week is displayed, without depending on the header's date formatting. */
  const weekLabel = (page: import('@playwright/test').Page) =>
    page.locator(`${HEADER} > div`).first().innerText()

  /** A horizontal drag on the content area. Paging is a framer-motion pan on
   *  `motion.main`, so this has to be a real pointer drag rather than a
   *  synthetic event — driving the wrong layer is exactly how the first
   *  attempt at this fix ended up in dead code. */
  async function panHorizontally(
    page: import('@playwright/test').Page,
    dx: number
  ): Promise<void> {
    const box = await page.locator(SCROLL).boundingBox()
    if (!box) throw new Error('no scroll box')
    const y = box.y + box.height / 2
    const startX = box.x + box.width / 2
    await page.mouse.move(startX, y)
    await page.mouse.down()
    await page.mouse.move(startX + dx, y, { steps: 12 })
    await page.mouse.up()
  }

  test('a swipe mid-week scrolls the days instead of changing week', async ({ page }) => {
    // The reported bug: any quick flick jumped a whole week.
    await page.locator(SCROLL).evaluate((el) => {
      el.scrollLeft = Math.floor((el.scrollWidth - el.clientWidth) / 2)
    })

    const before = await weekLabel(page)
    await panHorizontally(page, -120)
    await page.waitForTimeout(300)
    expect(await weekLabel(page)).toBe(before)
  })

  test('a swipe from the end of the strip does change week', async ({ page }) => {
    // ...and the feature still has to work once the strip is used up.
    await page.locator(SCROLL).evaluate((el) => {
      el.scrollLeft = el.scrollWidth
    })

    const before = await weekLabel(page)
    await panHorizontally(page, -120)
    await expect.poll(() => weekLabel(page)).not.toBe(before)
  })
})

test.describe('Week view — pinch gesture wiring', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    await page.goto('/week')
    await expect(page.locator(SCROLL)).toBeVisible()
  })

  test('pinching in with two fingers compresses the days', async ({ page }) => {
    // Drives real touch events on the element, because the failure this
    // covers was purely one of binding: the previous pinch went through
    // @use-gesture, which with `pointer: { touch: true }` returns onTouch*
    // handlers that were never spread onto anything — so on a phone the
    // gesture did nothing at all while every unit test still passed.
    const before = await page
      .locator(DAY_COLUMN)
      .first()
      .evaluate((el) => el.getBoundingClientRect().width)

    await page.locator(SCROLL).evaluate((el) => {
      const box = el.getBoundingClientRect()
      const y = box.top + box.height / 2
      const mid = box.left + box.width / 2

      const touch = (id: number, x: number): Touch =>
        new Touch({ identifier: id, target: el, clientX: x, clientY: y })

      const fire = (type: string, xs: [number, number]): void => {
        const touches = [touch(0, xs[0]), touch(1, xs[1])]
        el.dispatchEvent(
          new TouchEvent(type, {
            touches,
            targetTouches: touches,
            changedTouches: touches,
            bubbles: true,
            cancelable: true,
          })
        )
      }

      fire('touchstart', [mid - 100, mid + 100])
      // Fingers coming together — spread halves.
      fire('touchmove', [mid - 50, mid + 50])
      fire('touchend', [mid - 50, mid + 50])
    })

    await expect
      .poll(() =>
        page
          .locator(DAY_COLUMN)
          .first()
          .evaluate((el) => el.getBoundingClientRect().width)
      )
      .toBeLessThan(before)
  })
})
