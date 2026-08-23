import { test, expect } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

const SPLIT_HANDLE = '[data-resize-handle][class*="splitHandleH"]'

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
})

async function splitGeometry(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const top = document.querySelector('[class*="gridTop"]') as HTMLElement
    const container = document.querySelector('[class*="splitContainer"]') as HTMLElement
    if (!top || !container) throw new Error('month split is not rendered')
    return {
      topHeight: top.getBoundingClientRect().height,
      containerHeight: container.getBoundingClientRect().height,
    }
  })
}

async function touchDrag(
  page: import('@playwright/test').Page,
  yStart: number,
  yEnd: number
): Promise<void> {
  await page.locator(SPLIT_HANDLE).evaluate(
    (element, { yStart, yEnd }) => {
      const touchAt = (y: number) =>
        new Touch({ identifier: 1, target: element, clientX: 195, clientY: y })
      const dispatch = (target: EventTarget, type: string, y: number, active: boolean) => {
        const touch = touchAt(y)
        target.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: active ? [touch] : [],
            targetTouches: active ? [touch] : [],
            changedTouches: [touch],
          })
        )
      }

      dispatch(element, 'touchstart', yStart, true)
      dispatch(document, 'touchmove', yEnd, true)
      dispatch(document, 'touchend', yEnd, false)
    },
    { yStart, yEnd }
  )
}

async function touchTap(page: import('@playwright/test').Page): Promise<void> {
  await page.locator(SPLIT_HANDLE).evaluate((element) => {
    const touch = new Touch({ identifier: 2, target: element, clientX: 195, clientY: 400 })
    element.dispatchEvent(
      new TouchEvent('touchstart', {
        bubbles: true,
        cancelable: true,
        touches: [touch],
        targetTouches: [touch],
        changedTouches: [touch],
      })
    )
    document.dispatchEvent(
      new TouchEvent('touchend', {
        bubbles: true,
        cancelable: true,
        touches: [],
        targetTouches: [],
        changedTouches: [touch],
      })
    )
  })
}

test('the mobile month split can be adjusted repeatedly by touch', async ({ page }) => {
  await clearState(page)
  await page.goto('/month')

  const handle = page.locator(SPLIT_HANDLE)
  await expect(handle).toBeVisible()

  const initial = await splitGeometry(page)
  const firstBox = await handle.boundingBox()
  if (!firstBox) throw new Error('split handle has no box')

  await touchDrag(page, firstBox.y + firstBox.height / 2, firstBox.y + firstBox.height / 2 + 90)
  const afterFirstDrag = await splitGeometry(page)
  expect(afterFirstDrag.topHeight).toBeGreaterThan(initial.topHeight + 40)

  const secondBox = await handle.boundingBox()
  if (!secondBox) throw new Error('split handle has no box after first drag')
  await touchDrag(
    page,
    secondBox.y + secondBox.height / 2,
    secondBox.y + secondBox.height / 2 - 160
  )
  const afterSecondDrag = await splitGeometry(page)

  expect(afterSecondDrag.topHeight).toBeLessThan(afterFirstDrag.topHeight - 40)
  expect(afterSecondDrag.topHeight).toBeLessThan(initial.topHeight - 30)
})

test('double-tapping the split resets it to the default position', async ({ page }) => {
  await clearState(page)
  await page.goto('/month')

  const handle = page.locator(SPLIT_HANDLE)
  await expect(handle).toBeVisible()
  const initial = await splitGeometry(page)
  const box = await handle.boundingBox()
  if (!box) throw new Error('split handle has no box')

  await touchDrag(page, box.y + box.height / 2, box.y + box.height / 2 + 100)
  await expect
    .poll(async () => (await splitGeometry(page)).topHeight)
    .toBeGreaterThan(initial.topHeight + 40)

  await touchTap(page)
  await touchTap(page)
  await expect
    .poll(async () => (await splitGeometry(page)).topHeight)
    .toBeCloseTo(initial.topHeight, 0)

  const handleHeight = (await handle.boundingBox())?.height ?? 0
  expect(handleHeight).toBeGreaterThanOrEqual(12)
})
