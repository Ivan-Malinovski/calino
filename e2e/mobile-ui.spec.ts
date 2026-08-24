import { test, expect } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

test.describe('mobile UI surfaces', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })

  test('stacks the cookie notice above the floating navigation', async ({ page }) => {
    await clearState(page)
    await page.goto('/month')
    await page.evaluate(() => localStorage.removeItem('calino_cookie_notice'))
    await page.reload()

    const banner = page.locator('[data-component="cookie-consent"]')
    const pill = page.locator('[data-component="floating-nav-pill"]')
    await expect(banner).toBeVisible()
    await expect(pill).toBeVisible()

    const gap = await page.evaluate(() => {
      const banner = document.querySelector('[data-component="cookie-consent"]')
      const pill = document.querySelector('[data-component="floating-nav-pill"]')
      if (!(banner instanceof HTMLElement) || !(pill instanceof HTMLElement)) return -1
      return pill.getBoundingClientRect().top - banner.getBoundingClientRect().bottom
    })

    expect(gap).toBeGreaterThanOrEqual(0)
  })

  test('keeps the ellipsis affordance and marks secondary routes current', async ({ page }) => {
    await clearState(page)
    await page.goto('/tasks')

    const more = page.locator('[data-component="nav-more"]')
    await expect(more.locator('svg')).toBeVisible()
    await expect(more).toHaveAttribute('aria-label', 'Show all views')
    await expect(more).toHaveAttribute('aria-current', 'page')
  })

  test('keeps mobile navigation controls at 44px minimum hit height', async ({ page }) => {
    await clearState(page)
    await page.goto('/month')

    const controls = page.locator(
      '[data-component="nav-pill-switcher"] button, [data-component="floating-nav-pill"] button[aria-label="Create"], [data-component="floating-nav-pill"] button[aria-label="Toggle sidebar"], button[aria-label="Previous"], button[aria-label="Next"]'
    )
    await expect(controls.first()).toBeVisible()

    const heights = await controls.evaluateAll((elements) =>
      elements.map((element) => Math.round(element.getBoundingClientRect().height))
    )

    expect(heights.length).toBeGreaterThan(0)
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(44)
  })

  test('leads onboarding with sample-data activation', async ({ page }) => {
    await page.goto('/month')

    const dialog = page.getByRole('dialog', { name: 'Start with your calendar' })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('details summary')).toHaveText('How your data stays safe')
    await expect(dialog.getByRole('button').nth(0)).toHaveText('Try with sample data')
    await expect(dialog.getByRole('button').nth(1)).toHaveText('Add CalDAV Account')
  })
})

test.describe('narrow mobile UI surfaces', () => {
  test.use({
    viewport: { width: 320, height: 568 },
    hasTouch: true,
    isMobile: true,
  })

  test('keeps bottom surfaces and the ellipsis inside a 320px viewport', async ({ page }) => {
    await clearState(page)
    await page.goto('/tasks')
    await page.evaluate(() => localStorage.removeItem('calino_cookie_notice'))
    await page.reload()

    const bounds = await page.evaluate(() => {
      const banner = document.querySelector('[data-component="cookie-consent"]')
      const pill = document.querySelector('[data-component="floating-nav-pill"]')
      const more = document.querySelector('[data-component="nav-more"]')
      if (
        !(banner instanceof HTMLElement) ||
        !(pill instanceof HTMLElement) ||
        !(more instanceof HTMLElement)
      ) {
        return null
      }

      const bannerRect = banner.getBoundingClientRect()
      const pillRect = pill.getBoundingClientRect()
      const moreRect = more.getBoundingClientRect()
      return {
        cookieAboveNav: pillRect.top >= bannerRect.bottom,
        pillInsideViewport: pillRect.left >= 0 && pillRect.right <= window.innerWidth,
        moreInsideViewport: moreRect.left >= 0 && moreRect.right <= window.innerWidth,
      }
    })

    expect(bounds).toEqual({
      cookieAboveNav: true,
      pillInsideViewport: true,
      moreInsideViewport: true,
    })
  })
})
