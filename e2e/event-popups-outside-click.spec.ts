import { test, expect, type Page, type Locator } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

/**
 * A click outside the event modal closes it only while it has no unsaved
 * changes. Once a field differs from what the modal opened with, an outside
 * click (a stray one, a text selection released past the edge, or the click
 * that brings the window back after working in another tab) keeps it open;
 * Close, Cancel and Save still close it. Text typed but not yet added (an
 * attendee address, a custom reminder value) counts as a change. The read-only
 * preview keeps closing on an outside click.
 */

/** The click that lands on the page when the user comes back to it. */
async function leaveAndComeBack(page: Page): Promise<void> {
  await page.evaluate(() => {
    const setState = (state: 'hidden' | 'visible'): void => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => state === 'hidden',
      })
      document.dispatchEvent(new Event('visibilitychange'))
    }
    window.dispatchEvent(new Event('blur'))
    setState('hidden')
    setState('visible')
    window.dispatchEvent(new Event('focus'))
  })
  await clickOutside(page)
}

/** Top-left corner: outside any dialog, on its backdrop. */
async function clickOutside(page: Page): Promise<void> {
  await page.mouse.click(5, 5)
}

/**
 * Still open, not merely still on its way out: the modal animates its close
 * (200 ms at most), during which it remains visible. Waiting past that is the
 * only way to tell "kept open" from "closing".
 */
async function expectStillOpen(page: Page, dialog: Locator): Promise<void> {
  await page.waitForTimeout(400)
  await expect(dialog).toBeVisible()
}

async function openNewEvent(page: Page): Promise<{ modal: Locator; titleInput: Locator }> {
  await page.goto('/week')
  await expect(page.locator('[data-component="header"]')).toBeVisible()
  await page.keyboard.press('c')
  const modal = page.locator('[data-component="modal-card"]')
  await expect(modal).toBeVisible()
  return { modal, titleInput: modal.locator('[data-component="event-title-input"]') }
}

test.describe('event popups on an outside click', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test.beforeEach(async ({ page }) => {
    await clearState(page)
  })

  test('a modal without changes closes on an outside click', async ({ page }) => {
    const { modal } = await openNewEvent(page)
    await clickOutside(page)
    await expect(modal).toBeHidden()
  })

  test('a modal with unsaved changes stays open; its Close button closes it', async ({ page }) => {
    const { modal, titleInput } = await openNewEvent(page)
    await titleInput.fill('Half-written event')

    await clickOutside(page)
    await expectStillOpen(page, modal)
    await expect(titleInput).toHaveValue('Half-written event')

    // Escape would throw the change away just as silently.
    await page.keyboard.press('Escape')
    await expectStillOpen(page, modal)
    await expect(titleInput).toHaveValue('Half-written event')

    await modal.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(modal).toBeHidden()
  })

  test('undoing the change makes the modal close on an outside click again', async ({ page }) => {
    const { modal, titleInput } = await openNewEvent(page)
    await titleInput.fill('Changed my mind')
    await clickOutside(page)
    await expectStillOpen(page, modal)

    await titleInput.fill('')
    await clickOutside(page)
    await expect(modal).toBeHidden()
  })

  test('a half-typed attendee keeps the modal open until the field is cleared', async ({
    page,
  }) => {
    const { modal } = await openNewEvent(page)
    await modal.locator('[data-component="event-advanced-toggle"]').click()
    const attendeeInput = modal.getByLabel('Add attendee email')
    await attendeeInput.fill('ali')

    await clickOutside(page)
    await expectStillOpen(page, modal)
    await expect(attendeeInput).toHaveValue('ali')

    await page.keyboard.press('Escape')
    await expectStillOpen(page, modal)
    await expect(attendeeInput).toHaveValue('ali')

    await attendeeInput.fill('')
    await clickOutside(page)
    await expect(modal).toBeHidden()
  })

  test('a half-typed custom reminder keeps the modal open', async ({ page }) => {
    const { modal } = await openNewEvent(page)
    await modal.locator('[data-component="event-advanced-toggle"]').click()
    await modal.getByRole('button', { name: 'Add reminder' }).click()
    await page.getByRole('button', { name: 'Custom…' }).click()
    const customInput = page.locator('[data-component="reminder-custom-input"]')
    await customInput.fill('45')

    await clickOutside(page)
    await expectStillOpen(page, modal)
    await expect(customInput).toHaveValue('45')

    await customInput.fill('')
    await clickOutside(page)
    await expect(modal).toBeHidden()
  })

  test('a text selection released outside a modal with changes keeps it open', async ({ page }) => {
    const { modal, titleInput } = await openNewEvent(page)
    await titleInput.fill('Selected by dragging')
    const box = await titleInput.boundingBox()
    expect(box).not.toBeNull()

    // Press in the title, drag past the card's edge, release on the backdrop.
    await page.mouse.move(box!.x + box!.width - 4, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(5, box!.y + box!.height / 2, { steps: 8 })
    await page.mouse.up()

    await expectStillOpen(page, modal)
    await expect(titleInput).toHaveValue('Selected by dragging')
  })

  test('coming back from another tab keeps the event being edited', async ({ page }) => {
    const { modal, titleInput } = await openNewEvent(page)
    await titleInput.fill('Back from another tab')

    await leaveAndComeBack(page)

    await expectStillOpen(page, modal)
    await expect(titleInput).toHaveValue('Back from another tab')

    await page.locator('[data-component="modal-save"]').click()
    await expect(modal).toBeHidden()
    await expect(page.getByRole('button', { name: /Back from another tab/ }).first()).toBeVisible()
  })

  test('the event preview closes on an outside click', async ({ page }) => {
    await page.goto('/day')
    await expect(page.locator('[data-component="header"]')).toBeVisible()
    await page.keyboard.press('c')
    const modal = page.locator('[data-component="modal-card"]')
    await modal.locator('[data-component="event-title-input"]').fill('Previewed event')
    await page.locator('[data-component="modal-save"]').click()
    await expect(modal).toBeHidden()

    await page
      .getByRole('button', { name: /Previewed event/ })
      .first()
      .click()
    const preview = page.locator('[data-component="event-preview"]')
    await expect(preview).toBeVisible()

    await clickOutside(page)
    await expect(preview).toBeHidden()
  })
})
