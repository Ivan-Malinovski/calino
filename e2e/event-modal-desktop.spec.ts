import { test, expect } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

test.describe('desktop event modal', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test.beforeEach(async ({ page }) => {
    await clearState(page)
  })

  test('keeps advanced editing actions reachable while the body scrolls', async ({ page }) => {
    await page.goto('/month')
    await expect(page.locator('[data-component="header"]')).toBeVisible()

    await page.keyboard.press('c')

    const modal = page.locator('[data-component="modal-card"]')
    await expect(modal).toBeVisible()

    const toggle = modal.locator('[data-component="event-advanced-toggle"]')
    const advanced = modal.locator('[data-component="event-advanced-options"]')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(advanced).toHaveAttribute('inert')

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(advanced).not.toHaveAttribute('inert')

    await modal.getByLabel('Recurring').check()
    await modal.getByRole('button', { name: /add description/i }).click()
    await modal.getByPlaceholder('Add description...').fill('A detailed desktop modal test')

    const attendeeInput = modal.getByLabel('Add attendee email')
    const addAttendee = advanced.getByRole('button', { name: 'Add', exact: true })
    for (const email of [
      'one@example.com',
      'two@example.com',
      'three@example.com',
      'four@example.com',
      'five@example.com',
      'six@example.com',
    ]) {
      await attendeeInput.fill(email)
      await addAttendee.click()
    }
    await expect(toggle).toHaveAccessibleName(/6 guests/)

    const modalBounds = await modal.boundingBox()
    expect(modalBounds?.width).toBeLessThanOrEqual(520)

    const scrollMetrics = await modal
      .locator('[data-component="modal-scroll"]')
      .evaluate((node) => ({
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        overflowY: getComputedStyle(node).overflowY,
      }))
    expect(scrollMetrics.overflowY).toBe('auto')
    expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight)

    const footerBounds = await modal.locator('[data-component="modal-footer"]').boundingBox()
    expect(footerBounds).not.toBeNull()
    expect(footerBounds!.y + footerBounds!.height).toBeLessThanOrEqual(800)
  })
})
