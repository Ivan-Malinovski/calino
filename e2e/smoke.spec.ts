/**
 * Smoke suite for the Calino refactor.
 *
 * Goal: catch regressions in the user-visible flows a refactor is most
 * likely to break — render, navigation, persistence, command palette,
 * event creation, and CalDAV account plumbing. Each test stands alone:
 * no shared state, no ordering assumptions.
 *
 * ── READ ME BEFORE ADDING A SPEC ─────────────────────────────────────────
 * If you're touching this file because you changed user-visible behavior,
 * you MUST also add or update a Playwright spec that exercises the
 * changed path. The full policy is in AGENTS.md ("Testing — proactive,
 * not reactive"); the short version:
 *
 *   1. Copy `e2e/templates/user-flow.spec.ts` for a new focused spec
 *      (e.g. `e2e/events.spec.ts`).
 *   2. Reuse `clearState()`, `seedAccount()`, `seedRecurringEvent()`
 *      from `e2e/fixtures/localstorage.ts` — don't reinvent state priming.
 *   3. Prefer `data-component="..."` selectors, then `aria-label`, then
 *      `getByRole('button', { name })`. See the comment block at the
 *      top of `user-flow.spec.ts` for the full selector hierarchy.
 *   4. Run `pnpm test:e2e -- --grep "<your test name>"` to verify it
 *      passes both before and after your change.
 * ──────────────────────────────────────────────────────────────────────────
 */

import { test, expect, type Page } from '@playwright/test'
import { seedAccount, seedRecurringEvent, clearState } from './fixtures/localstorage'

// Real test CalDAV server. Credentials are NEVER hardcoded — tests that
// exercise the live server are skipped when the env vars aren't set, so
// nothing sensitive ever lands in git. Provide locally via a
// `.env.test` (gitignored) or your shell:
//   CALINO_TEST_CALDAV_URL=https://radicale.example/ivan/
//   CALINO_TEST_CALDAV_USER=alice
//   CALINO_TEST_CALDAV_PASS=secret
const TEST_CALDAV_ENV = {
  url: process.env.CALINO_TEST_CALDAV_URL,
  username: process.env.CALINO_TEST_CALDAV_USER,
  password: process.env.CALINO_TEST_CALDAV_PASS,
}
const HAS_LIVE_CALDAV = Boolean(
  TEST_CALDAV_ENV.url && TEST_CALDAV_ENV.username && TEST_CALDAV_ENV.password
)
const TEST_CALDAV_NAME = 'Refactor Test Server'

async function gotoSettingsSync(page: Page): Promise<void> {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await page.getByRole('button', { name: /^\s*Sync\s*$/ }).click()
  await expect(page.locator('[data-component="caldav-settings"]')).toBeVisible()
}

test.describe('smoke', () => {
  test.beforeEach(async ({ page }) => {
    // Wipes Calino state, dismisses onboarding, dismisses cookie consent.
    await clearState(page)
  })

  test('app boots and the default calendar view renders', async ({ page }) => {
    const exceptions: string[] = []
    page.on('pageerror', (err) => exceptions.push(err.message))

    await page.goto('/month')

    // Header + view switcher are part of the persistent chrome.
    await expect(page.locator('[data-component="header"]')).toBeVisible()
    await expect(page.locator('[data-component="view-switcher"]')).toBeVisible()

    // Month grid renders.
    await expect(page.locator('[data-component="calendar-grid"]').first()).toBeVisible()

    // No uncaught JS exceptions. (Console errors are intentionally NOT
    // asserted — Vite's dev server emits CSP / HMR noise that isn't a
    // signal of an app bug.)
    expect(exceptions, exceptions.join('\n')).toEqual([])
  })

  test('settings page opens and the Sync section is reachable', async ({ page }) => {
    await gotoSettingsSync(page)
    await expect(page.getByText('Add calendar account')).toBeVisible()
  })

  test('add CalDAV account flow: form, discovery, success', async ({ page }) => {
    test.skip(!HAS_LIVE_CALDAV, 'CALINO_TEST_CALDAV_{URL,USER,PASS} not set — skipping live-server test')

    await gotoSettingsSync(page)

    // Click "Add calendar account".
    await page.getByText('Add calendar account').click()

    // Fill the modal.
    const dialog = page.getByRole('dialog', { name: /add caldav calendar/i })
    await expect(dialog).toBeVisible()

    await dialog.getByLabel('Server URL').fill(TEST_CALDAV_ENV.url!)
    await dialog.getByLabel('Username').fill(TEST_CALDAV_ENV.username!)
    await dialog.getByLabel('Password').fill(TEST_CALDAV_ENV.password!)
    await dialog.getByLabel(/account name/i).fill(TEST_CALDAV_NAME)

    // Submit. Calino first does a connection test (PROPFIND), then the
    // success message appears.
    await dialog.getByRole('button', { name: 'Add Calendar' }).click()

    await expect(dialog.getByText('Connection successful')).toBeVisible({ timeout: 30_000 })
    await expect(dialog).toBeHidden({ timeout: 15_000 })

    // The account was written to localStorage. The Settings page's
    // `useCalDAV()` keeps accounts in local React state — a refresh
    // picks the new account up from `calino_caldav_accounts`.
    await page.reload()
    await page.getByRole('button', { name: /^\s*Sync\s*$/ }).click()

    await expect(page.locator('[data-component="account-row"]')).toContainText(TEST_CALDAV_NAME)
  })

  test('settings persist across reload (localStorage round-trip)', async ({ page }) => {
    test.skip(!HAS_LIVE_CALDAV, 'CALINO_TEST_CALDAV_{URL,USER,PASS} not set — skipping live-server test')
    await seedAccount(page, {
      name: 'Persisted Server',
      serverUrl: TEST_CALDAV_ENV.url!,
      username: TEST_CALDAV_ENV.username!,
      password: TEST_CALDAV_ENV.password!,
    })

    await gotoSettingsSync(page)
    await expect(page.locator('[data-component="account-row"]')).toContainText('Persisted Server', {
      timeout: 10_000,
    })

    // Reload — the account should still be there.
    await page.reload()
    await page.getByRole('button', { name: /^\s*Sync\s*$/ }).click()
    await expect(page.locator('[data-component="account-row"]')).toContainText('Persisted Server')
  })

  test('edit a recurring event with "This and following events" splits the series', async ({
    page,
  }) => {
    // Seed a weekly recurring event that started last week and runs into the
    // next month. We seed directly into the calendar store's persistence
    // key so the test is deterministic — no NLP, no real CalDAV.
    const today = new Date()
    const lastWeek = new Date(today)
    lastWeek.setDate(lastWeek.getDate() - 7)
    const nextWeek = new Date(today)
    nextWeek.setDate(nextWeek.getDate() + 7)
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

    await seedRecurringEvent(page, {
      id: 'weekly-meeting',
      title: 'Weekly Meeting',
      startDate: fmt(lastWeek),
      endDate: fmt(nextWeek),
      startTime: '10:00',
      endTime: '11:00',
      frequency: 'weekly',
      interval: 1,
    })

    // Land on the week view for the current week.
    await page.goto('/week')
    await expect(page.locator('[data-component="header"]')).toBeVisible()

    // The seeded event should be visible somewhere in the current week.
    await expect(
      page.getByRole('button', { name: /Weekly Meeting/ }).first()
    ).toBeVisible({ timeout: 10_000 })

    // Open the event (the EventCard is a role=button). This routes through
    // the preview popup, which has an "Open event" button.
    await page.getByRole('button', { name: /Weekly Meeting/ }).first().click()
    await expect(page.locator('[data-component="event-preview"]')).toBeVisible({
      timeout: 5_000,
    })

    // Click "Open event" in the preview to enter edit mode.
    const openInPreview = page
      .locator('[data-component="event-preview"]')
      .getByRole('button', { name: /Open event/i })
      .first()
    await openInPreview.click()

    // Modal opens with the event title.
    const titleInput = page.locator('[data-component="event-title-input"]')
    await expect(titleInput).toBeVisible({ timeout: 5_000 })
    await expect(titleInput).toHaveValue('Weekly Meeting')

    // Change the title to make the edit non-trivial.
    await titleInput.fill('Weekly Meeting (updated)')

    // Save — this triggers the RecurrenceDialog because the event is
    // recurring.
    await page.locator('[data-component="modal-save"]').click()

    const recurrenceDialog = page.getByRole('dialog').filter({ hasText: /Edit recurring event/i })
    await expect(recurrenceDialog).toBeVisible({ timeout: 5_000 })

    // Pick "This and following events" — the future-only edit.
    await recurrenceDialog.getByRole('button', { name: /This and following events/i }).click()

    // Both the modal and the dialog close.
    await expect(recurrenceDialog).toBeHidden({ timeout: 5_000 })

    // The new title should appear in the week view — it's the master for
    // the post-split future series.
    await expect(
      page.getByRole('button', { name: /Weekly Meeting \(updated\)/ }).first()
    ).toBeVisible({ timeout: 5_000 })
  })

  test('delete "This and following events" keeps earlier occurrences', async ({ page }) => {
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const fmt = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

    await seedRecurringEvent(page, {
      id: 'daily-cleanup',
      title: 'Daily Cleanup',
      startDate: fmt(yesterday),
      endDate: fmt(yesterday),
      startTime: '10:00',
      endTime: '11:00',
      frequency: 'daily',
      interval: 1,
    })

    await page.goto('/day')
    const currentOccurrence = page.getByRole('button', { name: /Daily Cleanup/ }).first()
    await expect(currentOccurrence).toBeVisible({ timeout: 10_000 })
    await currentOccurrence.click()
    const preview = page.locator('[data-component="event-preview"]')
    await preview.getByRole('button', { name: /Open event/i }).click()
    await page.locator('[data-component="modal-card"]').getByRole('button', { name: 'Delete' }).click()

    const dialog = page.getByRole('dialog').filter({ hasText: /Delete recurring event/i })
    const futureButton = dialog.getByRole('button', { name: /This and following events/i })
    await expect(futureButton).toBeVisible()
    await futureButton.click()

    await expect(currentOccurrence).toBeHidden()
    await page.getByRole('button', { name: 'Previous', exact: true }).click()
    await expect(page.getByRole('button', { name: /Daily Cleanup/ }).first()).toBeVisible()
  })

  test('command palette opens via search button and a natural-language event is created', async ({
    page,
  }) => {
    await page.goto('/month')
    await expect(page.locator('[data-component="header"]')).toBeVisible()

    // Click the search button (more reliable than Ctrl+K, which the cookie
    // consent banner can shadow if it captures focus first).
    await page.getByRole('button', { name: 'Search or commands' }).click()

    const palette = page.locator('[data-component="command-palette"]')
    await expect(palette).toBeVisible({ timeout: 5_000 })

    // cmdk renders an <input> with [cmdk-input] attribute; fall back to any
    // input inside the dialog if the attribute is renamed.
    const input = page.locator('[data-component="command-palette"] input').first()
    await expect(input).toBeVisible()

    // Natural language input — chrono-node will parse this into a concrete date.
    await input.fill('Lunch tomorrow at 1pm')

    // The palette surfaces an "Events" group with a quick-add result. Press
    // Enter to confirm.
    await page.keyboard.press('Enter')

    // NLP extracts the date and keeps just the title text ("Lunch") for
    // the event. Either the event card or the "Created event:" toast
    // confirms creation — either is enough.
    await expect(
      page
        .locator('[data-component="event-card"]')
        .filter({ hasText: /Lunch/i })
        .first()
    ).toBeVisible({ timeout: 5_000 })
  })

  test('event modal opens, accepts a title, and saves', async ({ page }) => {
    await page.goto('/month')

    // The "c" keyboard shortcut opens the create-event modal.
    await expect(page.locator('[data-component="header"]')).toBeVisible()
    await page.keyboard.press('c')

    const titleInput = page.locator('[data-component="event-title-input"]')
    await expect(titleInput).toBeVisible({ timeout: 5_000 })
    await titleInput.fill('Refactor smoke test event')

    await page.locator('[data-component="modal-save"]').click()

    // Modal closes.
    await expect(page.locator('[data-component="event-title-input"]')).toBeHidden({
      timeout: 5_000,
    })

    // The new event is rendered somewhere in the grid.
    await expect(page.getByText('Refactor smoke test event').first()).toBeVisible({
      timeout: 5_000,
    })
  })

  test('undo/redo keyboard shortcut works for the most recent action', async ({ page }) => {
    await page.goto('/month')
    await expect(page.locator('[data-component="header"]')).toBeVisible()

    // Create an event.
    await page.keyboard.press('c')
    const titleInput = page.locator('[data-component="event-title-input"]')
    await expect(titleInput).toBeVisible()
    await titleInput.fill('Undo me')
    await page.locator('[data-component="modal-save"]').click()
    await expect(page.getByText('Undo me').first()).toBeVisible({ timeout: 5_000 })

    // Undo.
    await page.keyboard.press('Control+Z')
    await expect(page.getByText('Undo me')).toHaveCount(0, { timeout: 5_000 })

    // Redo.
    await page.keyboard.press('Control+Shift+Z')
    await expect(page.getByText('Undo me').first()).toBeVisible({ timeout: 5_000 })
  })

  test('view switcher navigates between month, week, day, agenda', async ({ page }) => {
    await page.goto('/month')
    await expect(page.locator('[data-component="header"]')).toBeVisible()

    const switcher = page.locator('[data-component="view-switcher"]')
    await expect(switcher).toBeVisible()

    // Verify each tab is clickable and the URL changes. Only MonthView has
    // a `data-component="calendar-grid"` attribute, so we use the URL as the
    // source of truth for navigation.
    const expectedRoutes: Record<string, RegExp> = {
      Week: /\/week/,
      Day: /\/day/,
      Agenda: /\/agenda/,
      Month: /\/month/,
    }

    for (const [label, routePattern] of Object.entries(expectedRoutes)) {
      await switcher.getByRole('button', { name: label, exact: true }).click()
      await expect(page).toHaveURL(routePattern)
    }
  })

  test('export & import controls are present in Data settings', async ({ page }) => {
    await page.goto('/settings')

    // The Data nav item is rendered as a <button>.
    await page.getByRole('button', { name: /^\s*Data\s*$/ }).click()

    // We don't actually trigger the file dialog — we just assert the controls
    // are wired up.
    const importInput = page.locator('[data-testid="import-calendar-input"]')
    await expect(importInput).toHaveCount(1)
  })

  test('core routes load without errors', async ({ page }) => {
    const routes = ['/month', '/week', '/day', '/agenda', '/tasks', '/settings']
    for (const route of routes) {
      await page.goto(route)
      // Every route should render either the calendar header (chrome) or
      // the settings heading (settings page). A refactor that breaks the
      // router will fail this assertion immediately.
      await expect(
        page
          .locator('[data-component="header"], [data-component="caldav-settings"], h1:has-text("Settings")')
          .first()
      ).toBeVisible({ timeout: 10_000 })
    }
  })
})
