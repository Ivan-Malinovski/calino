import { test, expect, type Locator, type Page } from '@playwright/test'
import { clearState, seedAccount } from './fixtures/localstorage'

/**
 * The attendee field suggests people already met in meetings, so a team that
 * invites the same colleagues every week types a few letters instead of each
 * address. The list is built from the events in the browser: typing makes no
 * request. Arrow keys and Enter pick, Escape closes the list and nothing else,
 * the user's own address is never offered.
 *
 * Owns `user/attendees/` on the mock (see vite-caldav-mock.ts).
 */

const COLLECTION = '/dav/calendars/user/attendees/'
const COLLEAGUE = 'ann.example@example.com'

async function syncOnce(page: Page, accountId: string): Promise<void> {
  const syncButton = page.locator('[data-component="sync-all-calendars"]')
  await expect(syncButton).toBeEnabled({ timeout: 15_000 })
  await syncButton.click()
  await expect
    .poll(
      () =>
        page.evaluate(
          (id) =>
            (
              JSON.parse(localStorage.getItem('calino_caldav_accounts') ?? '[]') as Array<{
                id: string
                lastSyncAt: string | null
              }>
            ).find((account) => account.id === id)?.lastSyncAt ?? null,
          accountId
        ),
      { timeout: 15_000 }
    )
    .not.toBeNull()
}

/**
 * The suggestion is drawn on top of everything at its centre, the event modal
 * included, so a click there lands on it.
 */
async function expectOnTop(page: Page, option: Locator): Promise<void> {
  const email = await option.getAttribute('data-email')
  // Polled: the form may still be settling from the "More options" animation.
  await expect
    .poll(async () => {
      const box = await option.boundingBox()
      if (!box) return null
      return page.evaluate(
        ({ x, y }) =>
          document
            .elementFromPoint(x, y)
            ?.closest('[data-component="attendee-suggestion"]')
            ?.getAttribute('data-email') ?? null,
        { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      )
    })
    .toBe(email)
}

/** Open a new event's form on the Attendees calendar, advanced options shown. */
async function newEvent(page: Page, title: string, dayIndex: number): Promise<Locator> {
  await page.locator('[data-date]').nth(dayIndex).click()
  const modal = page.locator('[data-component="modal-card"]')
  await expect(modal).toBeVisible()
  await modal.locator('[data-component="event-title-input"]').fill(title)
  await modal
    .locator('[data-component="event-calendar-select"]')
    .selectOption({ label: 'Attendees' })
  await modal.locator('[data-component="event-advanced-toggle"]').click()
  return modal
}

test.describe('attendee suggestions', () => {
  // The setup syncs and saves a first meeting before each test: slow on WebKit.
  test.describe.configure({ timeout: 60_000 })

  test.beforeEach(async ({ page, baseURL }) => {
    await clearState(page)
    await page.request.post(
      `${baseURL!}/mock-caldav/__test__/reset?prefix=${encodeURIComponent(COLLECTION)}`
    )
    await seedAccount(page, {
      id: 'attendees-account',
      name: 'Attendees Mock',
      serverUrl: `${baseURL}/mock-caldav/dav/`,
      username: 'user',
      password: 'pass',
      calendars: [{ name: 'Attendees', path: 'calendars/user/attendees/', isDefault: true }],
    })
    await page.goto('/month')
    await syncOnce(page, 'attendees-account')

    // A first meeting with a colleague, typed in full.
    const modal = await newEvent(page, 'Kickoff', 1)
    const input = modal.getByLabel('Add attendee email')
    await input.fill(COLLEAGUE)
    await input.press('Enter')
    await modal.locator('[data-component="modal-save"]').click()
    await expect(modal).toBeHidden({ timeout: 10_000 })
  })

  test('offers a colleague from an earlier meeting, picked with the keyboard', async ({ page }) => {
    const modal = await newEvent(page, 'Weekly', 2)
    const input = modal.getByLabel('Add attendee email')
    await input.fill('ann')

    const list = page.getByRole('listbox', { name: 'Suggested attendees' })
    await expect(list).toBeVisible()
    const option = list.locator(`[data-email="${COLLEAGUE}"]`)
    await expect(option).toBeVisible()
    await expect(input).toHaveAttribute('aria-expanded', 'true')

    // The best match comes first: the colleague met this week.
    await input.press('ArrowDown')
    await expect(list.getByRole('option').first()).toHaveAttribute('data-email', COLLEAGUE)
    await expect(option).toHaveAttribute('aria-selected', 'true')
    await input.press('Enter')

    await expect(modal.getByText(COLLEAGUE, { exact: true })).toBeVisible()
    await expect(input).toHaveValue('')
    // Added once: no longer offered.
    await input.fill('ann')
    await expect(list.locator(`[data-email="${COLLEAGUE}"]`)).toHaveCount(0)
  })

  test('picks with the mouse, never offers the user, and Escape closes only the list', async ({
    page,
  }) => {
    const modal = await newEvent(page, 'Review', 3)
    const input = modal.getByLabel('Add attendee email')

    // The organizer of the first meeting is the user: not a suggestion.
    await input.fill('user')
    await expect(
      page.locator('[data-component="attendee-suggestion"][data-email="user@example.com"]')
    ).toHaveCount(0)

    await input.fill('exam')
    const option = page.locator(`[data-component="attendee-suggestion"][data-email="${COLLEAGUE}"]`)
    await expect(option).toBeVisible()
    await input.press('Escape')
    await expect(page.locator('[data-component="attendee-suggestions"]')).toHaveCount(0)
    await expect(modal).toBeVisible()

    await input.press('ArrowDown')
    await expect(option).toBeVisible()
    await expectOnTop(page, option)
    await option.click()
    await expect(modal.getByText(COLLEAGUE, { exact: true })).toBeVisible()
  })

  test('shows the list above the modal when editing an event', async ({ page }) => {
    // A saved event without attendees, opened again for editing.
    let modal = await newEvent(page, 'Standup', 2)
    await modal.locator('[data-component="modal-save"]').click()
    await expect(modal).toBeHidden({ timeout: 10_000 })
    await page.locator('[data-component="calendar-grid"]').getByText('Standup').first().click()
    await page
      .locator('[data-component="event-preview"]')
      .getByRole('button', { name: 'Open event' })
      .click()
    modal = page.locator('[data-component="modal-card"]')
    await expect(modal).toBeVisible()
    await modal.locator('[data-component="event-advanced-toggle"]').click()

    const input = modal.getByLabel('Add attendee email')
    await input.fill('ann')
    const option = page.locator(`[data-component="attendee-suggestion"][data-email="${COLLEAGUE}"]`)
    await expect(option).toBeVisible()
    await expectOnTop(page, option)
    await option.click()
    await expect(modal.getByText(COLLEAGUE, { exact: true })).toBeVisible()
    await expect(modal).toBeVisible()
  })
})
