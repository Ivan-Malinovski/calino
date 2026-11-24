import { test, expect, type Page } from '@playwright/test'
import { clearState, seedJournal } from './fixtures/localstorage'

test.use({ reducedMotion: 'reduce' })

const calendars = Array.from({ length: 30 }, (_, i) => ({
  id: `order-${i}`,
  name: `Calendar ${i + 1} ${'LongCalendarName'.repeat(3)}`,
}))
const rows = (page: Page) => page.locator('[data-component="sidebar-calendar"]')
const handle = (page: Page, id: number) =>
  rows(page)
    .filter({
      has: page.locator(
        `[data-calendar-id="order-${id}"][data-component="calendar-visibility-toggle"]`
      ),
    })
    .locator('[data-action="reorder-calendar"]')

async function expand(page: Page, mobile: boolean) {
  if (mobile) await page.getByRole('button', { name: 'Toggle menu' }).click()
  await page.locator('[data-component="calendar-section-toggle"]').click()
  await expect(rows(page)).toHaveCount(30)
}

for (const mobile of [false, true]) {
  test.describe(mobile ? 'mobile sidebar order' : 'desktop sidebar order', () => {
    test.use({ viewport: mobile ? { width: 390, height: 700 } : { width: 1200, height: 700 } })
    test.beforeEach(async ({ page }) => {
      await clearState(page)
      await seedJournal(page, { calendars, entries: [] })
      await page.goto('/month')
      await expand(page, mobile)
    })

    test('dragging a calendar preserves visibility and persists after reload', async ({ page }) => {
      const checkbox = page.locator(
        '[data-component="calendar-visibility-toggle"][data-calendar-id="order-0"]'
      )
      await checkbox.uncheck()
      const from = handle(page, 0)
      const to = handle(page, 2)
      await from.evaluate((element) => element.scrollIntoView({ block: 'center' }))
      const start = await from.boundingBox()
      const end = await to.boundingBox()
      expect(start).not.toBeNull()
      expect(end).not.toBeNull()
      await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2)
      await page.mouse.down()
      await page.mouse.move(end!.x + end!.width / 2, end!.y + end!.height / 2, { steps: 15 })
      await page.mouse.up()
      await expect(rows(page).nth(2)).toHaveAttribute('data-calendar-id', 'order-0')
      await expect(checkbox).not.toBeChecked()
      await page.reload()
      await expand(page, mobile)
      await expect(rows(page).nth(2)).toHaveAttribute('data-calendar-id', 'order-0')
      await expect(checkbox).not.toBeChecked()
      await checkbox.check()
      await expect(checkbox).toBeChecked()
    })

    test('keyboard reorder reaches the end of a long list and Escape cancels', async ({ page }) => {
      const last = handle(page, 29)
      await last.scrollIntoViewIfNeeded()
      await last.focus()
      await page.keyboard.press('Space')
      await expect(last).toHaveAttribute('aria-pressed', 'true')
      await page.keyboard.press('ArrowUp')
      await expect(
        page.getByRole('status').filter({ hasText: 'Draggable item order-29' })
      ).toContainText('was moved over droppable area order-28')
      await page.keyboard.press('Escape')
      await expect(last).not.toHaveAttribute('aria-pressed', 'true')
      await expect(rows(page).last()).toHaveAttribute('data-calendar-id', 'order-29')
      await last.focus()
      await page.keyboard.press('Space')
      await expect(last).toHaveAttribute('aria-pressed', 'true')
      await page.keyboard.press('ArrowUp')
      await expect(
        page.getByRole('status').filter({ hasText: 'Draggable item order-29' })
      ).toContainText('was moved over droppable area order-28')
      await page.keyboard.press('Space')
      await expect(rows(page).nth(28)).toHaveAttribute('data-calendar-id', 'order-29')
      await expect(last).toBeFocused()
      await expect(
        page.locator('[data-component="calendar-visibility-toggle"][data-calendar-id="order-29"]')
      ).toBeChecked()
      await page.reload()
      await expand(page, mobile)
      await expect(rows(page).nth(28)).toHaveAttribute('data-calendar-id', 'order-29')
    })
  })
}

test('handle appears on the left on hover and keyboard focus', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 700 })
  await clearState(page)
  await seedJournal(page, { calendars, entries: [] })
  await page.goto('/month')
  await expand(page, false)
  const grip = handle(page, 0)
  const row = rows(page).first()
  await row.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await page.mouse.move(1100, 100)
  await expect(grip).toHaveCSS('opacity', '0')
  await row.hover()
  await expect(grip).toHaveCSS('opacity', '1')
  const checkbox = row.locator('[data-component="calendar-visibility-toggle"]')
  expect((await grip.boundingBox())!.x).toBeLessThan((await checkbox.boundingBox())!.x)
  await page.mouse.move(1100, 100)
  await expect(grip).toHaveCSS('opacity', '0')
  await grip.focus()
  await expect(grip).toHaveCSS('opacity', '1')
})

test.describe('touch sidebar', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 700 } })
  test('touch handle reorders without dismissing the mobile drawer', async ({
    page,
    browserName,
    context,
  }) => {
    test.skip(browserName !== 'chromium', 'CDP supplies real touch input in Chromium')
    await page.setViewportSize({ width: 390, height: 700 })
    await clearState(page)
    await seedJournal(page, { calendars, entries: [] })
    await page.goto('/month')
    await expand(page, true)
    const from = handle(page, 0)
    await expect(from).toHaveCSS('opacity', '1')
    await from.evaluate((element) => element.scrollIntoView({ block: 'center' }))
    const start = (await from.boundingBox())!
    const end = (await handle(page, 2).boundingBox())!
    const cdp = await context.newCDPSession(page)
    const x = start.x + start.width / 2
    const y = start.y + start.height / 2
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (let step = 1; step <= 12; step++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x - step, y: y + ((end.y - start.y) * step) / 12 }],
      })
      await page.waitForTimeout(20)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(rows(page).nth(2)).toHaveAttribute('data-calendar-id', 'order-0')
    await expect(page.locator('[data-component="sidebar"]')).toBeInViewport()
    await expect(
      page.locator('[data-component="calendar-visibility-toggle"][data-calendar-id="order-0"]')
    ).toBeChecked()
  })
})
