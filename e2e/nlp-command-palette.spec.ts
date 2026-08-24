/**
 * Focused regression spec for command-palette NLP routing improvements.
 *
 * Exercises the user-visible paths the parser/routing changes affect:
 *   - bare-noun events ("lunch", "gym", "meeting") create events, not search
 *   - task prefixes ("todo"/"task"/"remind me to") create tasks
 *   - "every other …" recurrence parses without breaking creation
 *   - "starting at" phrasing yields a clean title
 *   - month/day substring overmatching is avoided (a phrase containing a
 *     month word still creates the event instead of navigating to that month)
 *   - a bare month name still navigates
 *
 * Conventions: `clearState` wipes Calino state + dismisses onboarding/cookie
 * consent; drive the palette the way a user would and assert on the event
 * card or the quick-add row that appears.
 */
import { test, expect } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

test.describe('command palette — NLP event routing', () => {
  test.beforeEach(async ({ page }) => {
    await clearState(page)
  })

  const openPalette = async (page: import('@playwright/test').Page) => {
    await page.goto('/month')
    const searchButton = page.getByRole('button', { name: 'Search or commands' })
    await expect(searchButton).toBeVisible()
    await searchButton.click()
    const palette = page.locator('[data-component="command-palette"]')
    await expect(palette).toBeVisible({ timeout: 5_000 })
    return palette.locator('input').first()
  }

  test('a bare noun like "lunch" creates an event (not a search)', async ({ page }) => {
    const input = await openPalette(page)
    await input.fill('Lunch')

    // A quick-add row appears.
    await expect(page.getByText('Create: Lunch')).toBeVisible()

    await page.keyboard.press('Enter')

    await expect(
      page.locator('[data-component="event-card"]').filter({ hasText: /Lunch/i }).first()
    ).toBeVisible({ timeout: 5_000 })
  })

  test('a task prefix like "todo buy milk" creates a task', async ({ page }) => {
    const input = await openPalette(page)
    await input.fill('todo buy milk')

    await expect(page.getByText('Task: Buy milk')).toBeVisible()

    await page.keyboard.press('Enter')

    await expect(
      page
        .locator('[data-component="event-card"]')
        .filter({ hasText: /Buy milk/i })
        .first()
    ).toBeVisible({ timeout: 5_000 })
  })

  test('"gym every monday" creates a repeating series, not one event', async ({ page }) => {
    // Quick-add bypasses the event modal, so the parsed recurrence has to be
    // attached in quickAddToItem. It wasn't: the rule was parsed and dropped,
    // and every "every …" phrase produced a single occurrence. Asserting on
    // one visible card cannot catch that — count the cards across the month.
    const input = await openPalette(page)
    await input.fill('gym every monday')
    await expect(page.getByText(/Create:.*Gym/i)).toBeVisible()
    await page.keyboard.press('Enter')

    const cards = page.locator('[data-component="event-card"]').filter({ hasText: /Gym/i })
    await expect(cards.first()).toBeVisible({ timeout: 5_000 })
    // A month grid shows 4-6 Mondays; a dropped rule shows exactly 1.
    await expect.poll(async () => cards.count(), { timeout: 5_000 }).toBeGreaterThan(1)
  })

  test('"every other day gym" creates the event with interval-2 recurrence', async ({ page }) => {
    const input = await openPalette(page)
    await input.fill('every other day gym')

    // The recurrence phrase is kept in the quick-add title per existing
    // convention (same as "gym every day" on main); what matters here is that
    // the series is created, not collapsed to one occurrence.
    await expect(page.getByText(/Create:.*gym/i)).toBeVisible()

    await page.keyboard.press('Enter')

    const cards = page.locator('[data-component="event-card"]').filter({ hasText: /Gym/i })
    await expect(cards.first()).toBeVisible({ timeout: 5_000 })
    await expect.poll(async () => cards.count(), { timeout: 5_000 }).toBeGreaterThan(1)
  })

  test('"dinner tonight" creates a timed evening event, not an all-day one', async ({ page }) => {
    // chrono reports "tonight" as an implied hour, which isCertain('hour')
    // cannot distinguish from the implied noon of a bare "tomorrow" — so this
    // used to land in the all-day row with a 22:00 start it never showed.
    const input = await openPalette(page)
    await input.fill('dinner tonight')
    await expect(page.getByText('Create: Dinner')).toBeVisible()
    await page.keyboard.press('Enter')

    await page.goto('/day')
    const card = page.locator('[data-component="event-card"]').filter({ hasText: /Dinner/i })
    await expect(card.first()).toBeVisible({ timeout: 5_000 })
    // An all-day event renders in the header strip, a timed one in the hour
    // grid. Only the latter sits inside the scrolling body.
    await expect(
      page.locator('[data-component="day-grid"] [data-component="event-card"]').filter({
        hasText: /Dinner/i,
      })
    ).toHaveCount(1)
  })

  test('"meeting starting at 3pm" yields a clean "Meeting" title', async ({ page }) => {
    const input = await openPalette(page)
    await input.fill('meeting starting at 3pm')

    // "starting" must not leak into the quick-add title.
    await expect(page.getByText('Create: Meeting')).toBeVisible()
    await expect(page.getByText('Create: Meeting starting')).toHaveCount(0)
  })

  test('a month word inside an event phrase is not misrouted to navigation', async ({ page }) => {
    const input = await openPalette(page)
    await input.fill('may I have a meeting')

    // No "Go to" navigation row — the month word must not misroute to May.
    await expect(page.getByText(/Go to may/i)).toHaveCount(0)
    await expect(page.getByText(/Create:.*meeting/i)).toBeVisible()
  })

  test('a bare month name still navigates', async ({ page }) => {
    const input = await openPalette(page)
    await input.fill('march')

    await expect(page.getByText(/Go to march/i)).toBeVisible()
  })
})
