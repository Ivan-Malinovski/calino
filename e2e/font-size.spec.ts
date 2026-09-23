import { test, expect } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

// Issue #184: the Font Size setting scales text across the whole app.
test.describe('Appearance — font size', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
  })

  test('choosing a larger font size enlarges text and persists across reload', async ({ page }) => {
    await page.goto('/settings?tab=theme')
    const row = page.locator('[data-component="setting-row"][data-setting="font-size"]')
    await expect(row).toHaveAttribute('data-value', 'default')

    const label = row.getByText('Font Size', { exact: true })
    const fontPx = () => label.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    const before = await fontPx()

    await row.getByRole('radio', { name: 'Extra large' }).click()
    await expect(row.getByRole('radio', { name: 'Extra large' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await expect.poll(fontPx).toBeCloseTo(before * 1.3, 1)

    await page.reload()
    await expect(row).toHaveAttribute('data-value', 'xlarge')
    await expect.poll(fontPx).toBeCloseTo(before * 1.3, 1)

    await row.getByRole('radio', { name: 'Small' }).click()
    await expect.poll(fontPx).toBeCloseTo(before * 0.9, 1)
  })

  test('the desktop view switcher is not clipped at extra large', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.addInitScript(() => {
      const raw = localStorage.getItem('calino-settings')
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 4 }
      parsed.state = {
        ...parsed.state,
        fontSize: 'xlarge',
        journalEnabled: true,
        contactsEnabled: true,
      }
      localStorage.setItem('calino-settings', JSON.stringify(parsed))
    })
    await page.goto('/')
    // When the tabs genuinely don't fit, the header falls back to a dropdown;
    // either way no tab may be cut off. The inactive control stays in the DOM
    // at opacity 0, which Playwright still counts as visible.
    const switcher = page.locator('[data-component="view-switcher"]')
    const dropdown = page.locator('[data-component="view-dropdown-trigger"]')
    const shown = async (l: typeof switcher) =>
      (await l.count()) > 0 &&
      (await l.evaluate(
        (el) =>
          getComputedStyle(el.parentElement ?? el).opacity === '1' &&
          getComputedStyle(el).opacity === '1'
      ))
    await expect.poll(async () => (await shown(switcher)) || (await shown(dropdown))).toBe(true)
    if (!(await shown(switcher))) return
    const clipped = await switcher.evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(clipped).toBeLessThanOrEqual(1)
  })
})
