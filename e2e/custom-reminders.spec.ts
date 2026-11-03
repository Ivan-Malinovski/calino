/**
 * Custom event reminders.
 *
 * The "+ Add" reminder picker in the event form used to be a closed preset
 * list. It now also carries a "4 hours before" preset and a "Custom…" panel
 * (number + unit) that accepts arbitrary offsets, which round-trip to CalDAV
 * as plain minute values. This spec covers the user-visible flow: picking the
 * new preset, entering a custom value, duplicate rejection, and persistence
 * of both after saving and reopening the event.
 */
import { test, expect } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

test.describe('event form — custom reminders', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test.beforeEach(async ({ page }) => {
    await clearState(page)
  })

  test('adds the 4-hour preset and a custom reminder, then persists both', async ({ page }) => {
    await page.goto('/month')
    await expect(page.locator('[data-component="header"]')).toBeVisible()

    // New event via the keyboard shortcut.
    await page.keyboard.press('c')
    const modal = page.locator('[data-component="modal-card"]')
    await expect(modal).toBeVisible()
    const title = modal.locator('[data-component="event-title-input"]')
    await title.fill('Doctor appointment')

    // Reminders live behind "More options".
    await modal.locator('[data-component="event-advanced-toggle"]').click()

    // ── 4 hours before as a preset ────────────────────────────────────
    await modal.getByRole('button', { name: 'Add reminder' }).click()
    await page.getByRole('option', { name: '4 hours before' }).click()
    await expect(
      modal.locator('[data-component="reminder-chip"]', { hasText: '4 hours before' })
    ).toBeVisible()

    // ── Custom reminder: 2 days before ────────────────────────────────
    await modal.getByRole('button', { name: 'Add reminder' }).click()
    await page.getByRole('button', { name: 'Custom…' }).click()
    await page.locator('[data-component="reminder-custom-input"]').fill('2')
    await page.locator('[data-component="reminder-custom-unit"]').selectOption('days')
    await page.locator('[data-component="reminder-custom-add"]').click()
    await expect(
      modal.locator('[data-component="reminder-chip"]', { hasText: '2 days before' })
    ).toBeVisible()

    // ── A duplicate custom value is rejected ──────────────────────────
    await modal.getByRole('button', { name: 'Add reminder' }).click()
    await page.getByRole('button', { name: 'Custom…' }).click()
    await page.locator('[data-component="reminder-custom-input"]').fill('4')
    await page.locator('[data-component="reminder-custom-unit"]').selectOption('hours')
    await expect(page.locator('[data-component="reminder-custom-add"]')).toBeDisabled()

    // ── Save and reopen: both reminders persisted ─────────────────────
    await title.press('Enter')
    await expect(modal).not.toBeVisible()

    await page
      .locator('[data-component="calendar-grid"]')
      .getByText('Doctor appointment')
      .first()
      .click()
    const preview = page.locator('[data-component="event-preview"]')
    await expect(preview).toBeVisible()
    await preview.getByRole('button', { name: 'Open event' }).click()
    await expect(modal).toBeVisible()
    // The reminder chips live in the "More options" panel, which starts
    // collapsed (max-height 0) — open it before asserting.
    await modal.locator('[data-component="event-advanced-toggle"]').click()
    await expect(
      modal.locator('[data-component="reminder-chip"]', { hasText: '4 hours before' })
    ).toBeVisible()
    await expect(
      modal.locator('[data-component="reminder-chip"]', { hasText: '2 days before' })
    ).toBeVisible()
  })
})
