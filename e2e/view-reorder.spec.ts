import { test, expect, type Page } from '@playwright/test'
import { clearState, STORAGE_KEYS } from './fixtures/localstorage'

const SWITCHER = '[data-component="view-switcher"]'

/** Labels of the desktop tabs, in the order they are rendered. */
async function tabOrder(page: Page): Promise<string[]> {
  return page.locator(`${SWITCHER} button[data-view]`).allInnerTexts()
}

/** View ids of the desktop tabs, in the order they are rendered. */
async function tabValues(page: Page): Promise<string[]> {
  return page
    .locator(`${SWITCHER} button[data-view]`)
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-view') ?? ''))
}

/** The arrangement as it was actually persisted. */
async function storedOrder(page: Page, key: string): Promise<string[]> {
  return page.evaluate((storageKey) => {
    const raw = window.localStorage.getItem(storageKey)
    return raw ? (JSON.parse(raw).state?.viewOrder ?? []) : []
  }, key)
}

test.describe('View switcher — reordering', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    // The tab strip collapses into a dropdown when it doesn't fit, and
    // reordering is only offered while the tabs are rendered.
    await page.setViewportSize({ width: 1440, height: 900 })
  })

  test('Alt+Arrow moves a tab and the new order survives a reload', async ({ page }) => {
    await page.goto('/month')
    await expect(page.locator(SWITCHER)).toBeVisible()

    const before = await tabOrder(page)
    expect(before.length).toBeGreaterThan(2)

    // Move the second tab one position to the right.
    const moving = before[1]
    await page.locator(`${SWITCHER} button[data-view]`).nth(1).focus()
    await page.keyboard.press('Alt+ArrowRight')

    const expected = [...before]
    expected.splice(1, 1)
    expected.splice(2, 0, moving)

    await expect.poll(() => tabOrder(page)).toEqual(expected)

    // Persisted, not just held in component state. The stored order covers
    // every view including ones switched off, so it is compared through the
    // subset that is actually on screen.
    const visible = await tabValues(page)
    const stored = await storedOrder(page, STORAGE_KEYS.settings)
    expect(stored.length).toBeGreaterThanOrEqual(visible.length)
    expect(stored.filter((v) => visible.includes(v))).toEqual(visible)

    await page.reload()
    await expect(page.locator(SWITCHER)).toBeVisible()
    await expect.poll(() => tabOrder(page)).toEqual(expected)
  })

  test('moving a tab does not switch to it', async ({ page }) => {
    await page.goto('/month')
    await expect(page.locator(SWITCHER)).toBeVisible()

    await page.locator(`${SWITCHER} button[data-view]`).nth(1).focus()
    await page.keyboard.press('Alt+ArrowRight')

    // Reordering is not navigation — the route must be untouched.
    await expect(page).toHaveURL(/\/month$/)
  })

  test('a tab at the end of the strip cannot be moved past it', async ({ page }) => {
    await page.goto('/month')
    await expect(page.locator(SWITCHER)).toBeVisible()

    const before = await tabOrder(page)
    await page.locator(`${SWITCHER} button[data-view]`).first().focus()
    await page.keyboard.press('Alt+ArrowLeft')

    await expect.poll(() => tabOrder(page)).toEqual(before)
  })

  test('view cycling follows the users arrangement', async ({ page }) => {
    await page.goto('/month')
    await expect(page.locator(SWITCHER)).toBeVisible()

    const before = await tabOrder(page)
    // Put the first tab (Month, the current view) directly before the tab
    // that is currently third, so cycling forward lands somewhere the
    // default order would not have sent us.
    await page.locator(`${SWITCHER} button[data-view]`).first().focus()
    await page.keyboard.press('Alt+ArrowRight')
    await expect.poll(() => tabOrder(page)).not.toEqual(before)

    const reordered = await tabValues(page)
    const monthIndex = reordered.indexOf('month')
    const nextView = reordered[monthIndex + 1]
    expect(nextView).toBeTruthy()

    // '.' steps to the next view in the switcher order — which is now the
    // user's order, not the built-in one.
    await page.keyboard.press('.')

    const ROUTES: Record<string, string> = {
      month: '/month',
      week: '/week',
      agenda: '/agenda',
      year: '/year',
      day: '/day',
      todo: '/tasks',
    }
    await expect(page).toHaveURL(new RegExp(`${ROUTES[nextView]}$`))
  })

  test('the divider is an item in the strip and can be moved', async ({ page }) => {
    await page.goto('/month')
    await expect(page.locator(SWITCHER)).toBeVisible()

    const divider = page.locator('[data-component="view-switcher-divider"]')
    await expect(divider).toHaveCount(1)

    // Index of the divider among all strip children.
    const dividerIndex = async (): Promise<number> =>
      page
        .locator(`${SWITCHER} button`)
        .evaluateAll((els) =>
          els.findIndex((el) => el.getAttribute('data-component') === 'view-switcher-divider')
        )

    const before = await dividerIndex()
    expect(before).toBeGreaterThan(0)

    await divider.focus()
    await page.keyboard.press('Alt+ArrowLeft')

    await expect.poll(dividerIndex).toBe(before - 1)

    // And it stays where it was put.
    await page.reload()
    await expect(page.locator(SWITCHER)).toBeVisible()
    await expect.poll(dividerIndex).toBe(before - 1)
  })

  test('moving a tab across the divider keeps the divider between the same neighbours', async ({
    page,
  }) => {
    await page.goto('/month')
    await expect(page.locator(SWITCHER)).toBeVisible()

    const idsInOrder = async (): Promise<string[]> =>
      page
        .locator(`${SWITCHER} button`)
        .evaluateAll((els) =>
          els.map(
            (el) =>
              el.getAttribute('data-view') ??
              (el.getAttribute('data-component') === 'view-switcher-divider' ? '|' : '?')
          )
        )

    const before = await idsInOrder()
    const dividerAt = before.indexOf('|')
    // The tab immediately before the divider, moved past it.
    await page.locator(`${SWITCHER} button[data-view="${before[dividerAt - 1]}"]`).focus()
    await page.keyboard.press('Alt+ArrowRight')

    const after = await idsInOrder()
    // That tab is now on the far side of the divider.
    expect(after.indexOf(before[dividerAt - 1])).toBeGreaterThan(after.indexOf('|'))
    // And no views were lost in the swap.
    expect([...after].sort()).toEqual([...before].sort())
  })

  test('an unknown view in stored settings is ignored rather than rendered', async ({ page }) => {
    // Simulates a downgrade: settings written by a build that shipped a view
    // this one does not have.
    // Merge rather than overwrite — clearState's init script has already
    // marked onboarding complete in this same key.
    await page.addInitScript(
      ({ key }: { key: string }) => {
        const raw = window.localStorage.getItem(key)
        const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
        parsed.state = {
          ...(parsed.state ?? {}),
          viewOrder: ['agenda', 'not-a-real-view', 'month'],
        }
        parsed.version = 2
        window.localStorage.setItem(key, JSON.stringify(parsed))
      },
      { key: STORAGE_KEYS.settings }
    )

    await page.goto('/month')
    await expect(page.locator(SWITCHER)).toBeVisible()

    const order = await tabOrder(page)
    expect(order).not.toContain('not-a-real-view')
    // The views the stored order did name come first, the rest follow.
    expect(order.slice(0, 2)).toEqual(['Agenda', 'Month'])
  })
})
