/**
 * Automated accessibility scans (axe-core) over the main surfaces.
 *
 * Each test boots a clean app state (no onboarding, no cookie banner),
 * renders one surface, and asserts axe finds no serious or critical
 * violations against WCAG 2.0/2.1 A+AA. Anything less severe is tracked
 * but not gating.
 *
 * If a scan fails: fix the app, don't weaken the assertion. The only
 * sanctioned exclusion is `region` (the app intentionally renders
 * sibling <main> landmarks per route), documented inline below.
 */

import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { clearState } from './fixtures/localstorage'

test.describe('accessibility scans', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
    // The app fades views in over ~150ms (and the command palette spawns with
    // a CSS fade). An axe scan landing mid-fade measures every fg/bg pair as
    // blended toward the surface and reports phantom color-contrast failures.
    // Both fades respect prefers-reduced-motion (App.tsx useReducedMotion,
    // index.css global kill switch), so scanning under reduced motion measures
    // settled colours without touching app CSS.
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })

  async function scan(page: import('@playwright/test').Page) {
    return (
      new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        // The app renders one <main> per route (calendar, settings, setup…)
        // rather than a single persistent landmark — a deliberate routing
        // choice, so the "region" best-practice rule would only ever fire on
        // chrome that already has labelled landmarks around it.
        .disableRules(['region'])
        .analyze()
    )
  }

  function seriousOrCritical(results: Awaited<ReturnType<typeof scan>>) {
    return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  }

  test('month view has no serious or critical violations', async ({ page }) => {
    await page.goto('/month')
    await expect(page.locator('[data-component="header"]')).toBeVisible()

    const results = await scan(page)
    expect(seriousOrCritical(results)).toEqual([])
  })

  test('week view has no serious or critical violations', async ({ page }) => {
    await page.goto('/week')
    await expect(page.locator('[data-component="header"]')).toBeVisible()

    const results = await scan(page)
    expect(seriousOrCritical(results)).toEqual([])
  })

  test('day view has no serious or critical violations', async ({ page }) => {
    await page.goto('/day')
    await expect(page.locator('[data-component="header"]')).toBeVisible()

    const results = await scan(page)
    expect(seriousOrCritical(results)).toEqual([])
  })

  test('agenda view has no serious or critical violations', async ({ page }) => {
    await page.goto('/agenda')
    await expect(page.locator('[data-component="header"]')).toBeVisible()

    const results = await scan(page)
    expect(seriousOrCritical(results)).toEqual([])
  })

  test('settings page has no serious or critical violations', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.locator('[data-component="settings-page"]')).toBeVisible()

    const results = await scan(page)
    expect(seriousOrCritical(results)).toEqual([])
  })

  test('event modal has no serious or critical violations', async ({ page }) => {
    await page.goto('/month')
    await expect(page.locator('[data-component="header"]')).toBeVisible()

    await page.keyboard.press('c')
    const titleInput = page.locator('[data-component="event-title-input"]')
    await expect(titleInput).toBeVisible({ timeout: 5_000 })

    const results = await scan(page)
    expect(seriousOrCritical(results)).toEqual([])
  })

  test('command palette has no serious or critical violations', async ({ page }) => {
    await page.goto('/month')
    await expect(page.locator('[data-component="header"]')).toBeVisible()

    await page.getByRole('button', { name: 'Search or commands' }).click()
    await expect(page.locator('[data-component="command-palette"]')).toBeVisible({
      timeout: 5_000,
    })

    const results = await scan(page)
    expect(seriousOrCritical(results)).toEqual([])
  })
})
